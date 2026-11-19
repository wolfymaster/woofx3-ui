import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { ENSURE_SWEEP, runEnsureSweep } from "./billingCommands";
import { billingErr } from "./lib/billingClient";
import { FakeBillingClient } from "./lib/billingClient.fakes";
import { newBackend } from "./lib/convexTest.testing";
import { insertProjection } from "./lib/orgBilling.testing";

type Backend = ReturnType<typeof newBackend>;

const realFetch = globalThis.fetch;
const saved = { url: process.env.MAINTENANCE_API_URL, key: process.env.MAINTENANCE_API_KEY };
let requests: { path: string; body: unknown }[] = [];
let failEnsureFor: string[] = [];

beforeEach(() => {
  requests = [];
  failEnsureFor = [];
  process.env.MAINTENANCE_API_URL = "https://plane.test";
  process.env.MAINTENANCE_API_KEY = "key";
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    requests.push({ path, body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined });
    if (path.endsWith("/ensure") && failEnsureFor.some((id) => path.includes(`/${id}/`))) {
      return new Response(JSON.stringify({ error: { code: "payment_unavailable", message: "down" } }), {
        status: 503,
      });
    }
    return new Response(JSON.stringify({ accountId: "x", version: 1, attempts: 1 }), { status: 200 });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  process.env.MAINTENANCE_API_URL = saved.url;
  process.env.MAINTENANCE_API_KEY = saved.key;
});

async function seedOrg(
  t: Backend,
  options: { hosting?: "managed" | "external"; projection?: boolean; deleted?: boolean } = {}
): Promise<Id<"accounts">> {
  return t.run(async (ctx) => {
    const ownerId = await ctx.db.insert("users", { name: "Owner" });
    const accountId = await ctx.db.insert("accounts", { name: "Org", ownerId, createdAt: 1 });
    const instanceId = await ctx.db.insert("instances", {
      accountId,
      name: "engine",
      url: "https://e.test",
      hosting: options.hosting ?? "managed",
      createdAt: 1,
    });
    if (options.deleted === true) {
      await ctx.db.insert("engineProvisioning", {
        instanceId,
        accountId,
        requestedBy: ownerId,
        slug: "s",
        status: "deleted",
        steps: [],
        registrationToken: "t",
        createdAt: 1,
        updatedAt: 1,
      });
    }
    if (options.projection === true) {
      await insertProjection(ctx, accountId);
    }
    return accountId;
  });
}

const ensured = () => requests.filter((r) => r.path.endsWith("/ensure")).map((r) => r.path.split("/")[4]);

describe("ensureSweep", () => {
  test("ensures managed orgs with no projection and skips the rest", async () => {
    const t = newBackend();
    const missing = await seedOrg(t);
    await seedOrg(t, { projection: true });
    await seedOrg(t, { hosting: "external" });
    await seedOrg(t, { deleted: true });
    await t.action(internal.billingCommands.ensureSweep, {});
    expect(ensured()).toEqual([missing]);
    expect(requests.filter((r) => r.path.endsWith("/ensure-miss"))).toEqual([]);
  });

  test("one failing org gets a miss reported and does not block the others", async () => {
    const t = newBackend();
    const bad = await seedOrg(t);
    const good = await seedOrg(t);
    failEnsureFor = [bad];
    await t.action(internal.billingCommands.ensureSweep, {});
    expect(ensured().sort()).toEqual([bad, good].sort());
    const misses = requests.filter((r) => r.path.endsWith("/ensure-miss"));
    expect(misses).toEqual([
      { path: `/v1/billing/accounts/org/${bad}/ensure-miss`, body: { reason: "payment_unavailable: down" } },
    ]);
  });
});

describe("runEnsureSweep", () => {
  const ids = (n: number) => Array.from({ length: n }, (_, i) => `acc${i}` as Id<"accounts">);

  test("stops at the per-run cap and reports it", async () => {
    const client = new FakeBillingClient();
    let tick = 0;
    const summary = await runEnsureSweep(
      client,
      async () => ({ accountIds: ids(5), continueCursor: "c", isDone: false }),
      () => {
        tick += 10;
        return tick;
      },
      { batchSize: 5, maxOrgsPerRun: 3 }
    );
    expect(client.calls.map((c) => c.args[0])).toEqual(["acc0", "acc1", "acc2"]);
    expect(summary).toEqual({ scanned: 3, ensured: 3, missed: 0, reportFailed: 0, capped: true, elapsedMs: 10 });
  });

  test("walks pages to the end and visits an org once", async () => {
    const client = new FakeBillingClient();
    const pages = [
      { accountIds: ids(2), continueCursor: "a", isDone: false },
      { accountIds: ids(3), continueCursor: "b", isDone: true },
    ];
    const cursors: (string | null)[] = [];
    const summary = await runEnsureSweep(
      client,
      async (cursor) => {
        cursors.push(cursor);
        return pages.shift() as (typeof pages)[number];
      },
      () => 0,
      ENSURE_SWEEP
    );
    expect(cursors).toEqual([null, "a"]);
    expect(summary.scanned).toBe(3);
    expect(summary.capped).toBe(false);
  });

  test("a failed miss report is counted, not thrown", async () => {
    const client = new FakeBillingClient();
    client.ensureAnswer = billingErr("payment_unavailable", "down");
    client.reportEnsureMiss = async () => billingErr("unreachable", "no");
    const summary = await runEnsureSweep(
      client,
      async () => ({ accountIds: ids(2), continueCursor: "", isDone: true }),
      () => 0
    );
    expect(summary).toMatchObject({ missed: 2, reportFailed: 2 });
  });
});
