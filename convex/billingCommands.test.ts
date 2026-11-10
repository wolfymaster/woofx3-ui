import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { ConvexError } from "convex/values";
import { api } from "./_generated/api";
import { ensureOrgBilling } from "./billingCommands";
import { billingErr } from "./lib/billingClient";
import { FakeBillingClient } from "./lib/billingClient.fakes";
import { newBackend } from "./lib/convexTest.testing";

type Backend = ReturnType<typeof newBackend>;

const realFetch = globalThis.fetch;
const saved = { url: process.env.MAINTENANCE_API_URL, key: process.env.MAINTENANCE_API_KEY };

interface Seen {
  path: string;
  method: string;
  idempotencyKey: string | null;
  body: unknown;
}

let seen: Seen[] = [];
let answers: Record<string, { status: number; body: unknown }> = {};

beforeEach(() => {
  seen = [];
  answers = {};
  process.env.MAINTENANCE_API_URL = "https://plane.test";
  process.env.MAINTENANCE_API_KEY = "key";
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    const headers = new Headers(init?.headers);
    seen.push({
      path,
      method: init?.method ?? "GET",
      idempotencyKey: headers.get("idempotency-key"),
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    });
    const answer = Object.entries(answers).find(([suffix]) => path.endsWith(suffix))?.[1];
    return new Response(JSON.stringify(answer?.body ?? {}), { status: answer?.status ?? 404 });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  process.env.MAINTENANCE_API_URL = saved.url;
  process.env.MAINTENANCE_API_KEY = saved.key;
});

async function seedOrg(t: Backend) {
  return t.run(async (ctx) => {
    const ownerId = await ctx.db.insert("users", { name: "Owner" });
    const adminId = await ctx.db.insert("users", { name: "Admin" });
    const accountId = await ctx.db.insert("accounts", { name: "Org", ownerId, createdAt: 1 });
    await ctx.db.insert("accountMembers", { accountId, userId: ownerId, role: "owner", createdAt: 1 });
    await ctx.db.insert("accountMembers", { accountId, userId: adminId, role: "admin", createdAt: 1 });
    return { ownerId, adminId, accountId };
  });
}

const as = (t: Backend, userId: string) => t.withIdentity({ subject: `${userId}|s` });
const errorData = (promise: Promise<unknown>) =>
  promise.then(
    () => null,
    (error: unknown) => (error instanceof ConvexError ? error.data : error)
  );

describe("startCheckout", () => {
  test("the owner gets the plane's url and checkout id, with a derived Idempotency-Key", async () => {
    const t = newBackend();
    const { ownerId, accountId } = await seedOrg(t);
    answers["/checkouts"] = { status: 200, body: { url: "https://pay.example/1", checkoutId: "c1" } };
    const args = { accountId, plan: "pro", interval: "year", promotionCode: " SAVE " } as const;
    expect(await as(t, ownerId).action(api.billingCommands.startCheckout, args)).toEqual({
      url: "https://pay.example/1",
      checkoutId: "c1",
    });
    await as(t, ownerId).action(api.billingCommands.startCheckout, args);
    expect(seen[0]?.body).toEqual({ plan: "pro", interval: "year", promotionCode: "SAVE" });
    expect(seen[0]?.idempotencyKey).toMatch(new RegExp(`^checkout:${accountId}:pro:year:SAVE:\\d+$`));
    expect(seen[1]?.idempotencyKey).toBe(seen[0]?.idempotencyKey ?? "");
  });

  test("an admin is refused before the plane is asked", async () => {
    const t = newBackend();
    const { adminId, accountId } = await seedOrg(t);
    await expect(
      as(t, adminId).action(api.billingCommands.startCheckout, { accountId, plan: "starter", interval: "month" })
    ).rejects.toThrow("Your organization role doesn't allow this");
    expect(seen).toEqual([]);
  });

  test.each([
    ["already_subscribed", "This organization already has a subscription. Change it in Manage billing."],
    ["subscription_exists", "Your payment method needs attention. Update it in the billing portal."],
    ["suspended_by_operator", "Your organization's account is suspended. Contact woofx3 support."],
    [
      "checkout_in_progress",
      "A checkout for this organization is already open. Finish it, or start again in half an hour.",
    ],
  ])("%s reaches the portal with its code and wording", async (code, message) => {
    const t = newBackend();
    const { ownerId, accountId } = await seedOrg(t);
    answers["/checkouts"] = { status: 409, body: { error: { code, message: "plane words" } } };
    expect(
      await errorData(
        as(t, ownerId).action(api.billingCommands.startCheckout, { accountId, plan: "pro", interval: "month" })
      )
    ).toEqual({ code, message });
  });

  test("an unconfigured deployment says so", async () => {
    process.env.MAINTENANCE_API_URL = "";
    const t = newBackend();
    const { ownerId, accountId } = await seedOrg(t);
    expect(
      await errorData(
        as(t, ownerId).action(api.billingCommands.startCheckout, { accountId, plan: "pro", interval: "month" })
      )
    ).toMatchObject({ code: "not_configured" });
  });
});

describe("openPortal", () => {
  test("owner only; a customerless org keeps the no_customer wording", async () => {
    const t = newBackend();
    const { ownerId, adminId, accountId } = await seedOrg(t);
    await expect(as(t, adminId).action(api.billingCommands.openPortal, { accountId })).rejects.toThrow(
      "Your organization role doesn't allow this"
    );
    answers["/portal-sessions"] = { status: 409, body: { error: { code: "no_customer", message: "x" } } };
    expect(await errorData(as(t, ownerId).action(api.billingCommands.openPortal, { accountId }))).toEqual({
      code: "no_customer",
      message: "Choose a plan first; there is nothing to manage yet.",
    });
    answers["/portal-sessions"] = { status: 200, body: { url: "https://pay.example/portal" } };
    expect(await as(t, ownerId).action(api.billingCommands.openPortal, { accountId })).toEqual({
      url: "https://pay.example/portal",
    });
  });
});

describe("invoices", () => {
  test("null for an admin without asking the plane; the owner's come from it", async () => {
    const t = newBackend();
    const { ownerId, adminId, accountId } = await seedOrg(t);
    expect(await as(t, adminId).action(api.billingCommands.invoices, { accountId })).toBeNull();
    expect(seen).toEqual([]);
    answers["/invoices"] = { status: 200, body: { invoices: [] } };
    expect(await as(t, ownerId).action(api.billingCommands.invoices, { accountId })).toEqual([]);
  });

  test("a plane outage surfaces as an error the page can show", async () => {
    const t = newBackend();
    const { ownerId, accountId } = await seedOrg(t);
    answers["/invoices"] = { status: 503, body: { error: { code: "payment_unavailable", message: "later" } } };
    expect(await errorData(as(t, ownerId).action(api.billingCommands.invoices, { accountId }))).toEqual({
      code: "payment_unavailable",
      message: "later",
    });
  });
});

describe("previewPromotionCode", () => {
  test("owner only; blank is null without a call; unknown is null", async () => {
    const t = newBackend();
    const { ownerId, adminId, accountId } = await seedOrg(t);
    await expect(
      as(t, adminId).action(api.billingCommands.previewPromotionCode, { accountId, code: "X" })
    ).rejects.toThrow("doesn't allow this");
    expect(await as(t, ownerId).action(api.billingCommands.previewPromotionCode, { accountId, code: "  " })).toBeNull();
    expect(seen).toEqual([]);
    answers["/promotion-codes/X"] = {
      status: 404,
      body: { error: { code: "promotion_code_not_found", message: "m" } },
    };
    expect(await as(t, ownerId).action(api.billingCommands.previewPromotionCode, { accountId, code: "X" })).toBeNull();
  });
});

describe("checkoutState", () => {
  test("the owner of the checkout's org reads the state; anyone else is refused", async () => {
    const t = newBackend();
    const { ownerId, adminId, accountId } = await seedOrg(t);
    answers["/checkouts/c1"] = {
      status: 200,
      body: { id: "c1", accountId, purposeKind: "subscription", state: "complete" },
    };
    expect(await as(t, ownerId).action(api.billingCommands.checkoutState, { checkoutId: "c1" })).toEqual({
      state: "complete",
    });
    expect(
      await errorData(as(t, adminId).action(api.billingCommands.checkoutState, { checkoutId: "c1" }))
    ).toMatchObject({
      code: "not_authorized",
    });
  });
});

describe("ensure", () => {
  test("a plane failure is logged and never thrown", async () => {
    const client = new FakeBillingClient();
    client.ensureAnswer = billingErr("payment_unavailable", "down");
    await ensureOrgBilling(client, "acc1" as never);
    expect(client.calls).toEqual([{ command: "ensure", args: ["acc1"] }]);
  });

  test("creating an org schedules ensure and an ensure failure leaves the org in place", async () => {
    const t = newBackend();
    const userId = await t.run((ctx) => ctx.db.insert("users", { name: "New" }));
    answers["/ensure"] = { status: 503, body: { error: { code: "payment_unavailable", message: "down" } } };
    const accountId = await as(t, userId).mutation(api.accounts.ensureMyAccount, {});
    await Bun.sleep(100);
    expect(seen.map((call) => call.path)).toEqual([`/v1/billing/accounts/${accountId}/ensure`]);
    expect(await t.run((ctx) => ctx.db.get(accountId))).not.toBeNull();
  });
});
