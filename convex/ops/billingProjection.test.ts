import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { newBackend } from "../lib/convexTest.testing";
import { OPS_SECRET_ENV } from "../lib/ops/auth";
import { MAX_PROJECTION_VERSION, parseBillingProjectionRequest } from "../lib/ops/billingProjectionRequest";

type Backend = ReturnType<typeof newBackend>;

const SECRET = "s".repeat(64);

const wire = (accountId: string, version: number, overrides: object = {}) => ({
  accountId,
  version,
  tier: "pro",
  addOns: [],
  standing: "active",
  reason: null,
  trialEndsAt: null,
  graceEndsAt: null,
  periodEnd: 1_800_000_000_000,
  interval: null,
  exemptUntil: null,
  spinDownAt: null,
  hasProviderSubscription: false,
  discount: null,
  overrides: { addFeatures: [], removeFeatures: [], limits: { "org.members": 9 } },
  ...overrides,
});

async function org(t: Backend): Promise<Id<"accounts">> {
  return t.run(async (ctx) => {
    const ownerId = await ctx.db.insert("users", { name: "Owner" });
    return ctx.db.insert("accounts", { name: "Org", ownerId, createdAt: 1 });
  });
}

function parsed(body: object) {
  const result = parseBillingProjectionRequest(body);
  if (!result.ok) {
    throw new Error(result.message);
  }
  return { ...result.value, actor: "billing-plane", auditReason: "projection push" };
}

const rows = (t: Backend) => t.run((ctx) => ctx.db.query("orgBilling").collect());

describe("applyBillingProjection", () => {
  test("upserts one row per org, keeping the newest version", async () => {
    const t = newBackend();
    const accountId = await org(t);
    const push = (version: number, tier: "starter" | "pro") =>
      t.mutation(internal.ops.billingProjection.applyBillingProjection, parsed(wire(accountId, version, { tier })));

    expect(await push(2, "pro")).toEqual({ ok: true, result: { applied: true, version: 2 } });
    expect(await push(1, "starter")).toEqual({ ok: true, result: { applied: false, version: 2 } });
    expect(await push(3, "starter")).toEqual({ ok: true, result: { applied: true, version: 3 } });
    expect((await rows(t)).map((row) => [row.version, row.tier])).toEqual([[3, "starter"]]);
  });

  test("a repeat of the same push replays the first answer, even after a newer one", async () => {
    const t = newBackend();
    const accountId = await org(t);
    const push = (version: number) =>
      t.mutation(internal.ops.billingProjection.applyBillingProjection, parsed(wire(accountId, version)));
    const first = await push(1);
    await push(2);
    expect(await push(1)).toEqual(first);
    expect((await rows(t))[0]?.version).toBe(2);
  });

  test("the same version with another body is a 409 and changes nothing", async () => {
    const t = newBackend();
    const accountId = await org(t);
    const push = (tier: string) =>
      t.mutation(internal.ops.billingProjection.applyBillingProjection, parsed(wire(accountId, 1, { tier })));
    await push("pro");
    expect(await push("starter")).toMatchObject({ ok: false, status: 409, code: "idempotency_mismatch" });
    expect((await rows(t))[0]?.tier).toBe("pro");
  });

  test("an unknown org is not found and stores nothing", async () => {
    const t = newBackend();
    const accountId = await org(t);
    await t.run((ctx) => ctx.db.delete(accountId));
    const outcome = await t.mutation(internal.ops.billingProjection.applyBillingProjection, parsed(wire(accountId, 1)));
    expect(outcome).toMatchObject({ ok: false, status: 404, code: "not_found" });
    expect(await rows(t)).toEqual([]);
  });
});

describe("parseBillingProjectionRequest", () => {
  const valid = wire("acct", 1);
  test.each<[string, object]>([
    ["version zero", { ...valid, version: 0 }],
    ["a fractional version", { ...valid, version: 1.5 }],
    ["a version above the plane's counter", { ...valid, version: MAX_PROJECTION_VERSION + 1 }],
    ["an unknown tier", { ...valid, tier: "gold" }],
    ["an unknown standing", { ...valid, standing: "paused" }],
    ["suspended with no reason", { ...valid, standing: "suspended" }],
    ["a negative limit", { ...valid, overrides: { ...valid.overrides, limits: { "org.members": -1 } } }],
    ["a missing overrides", { ...valid, overrides: undefined }],
    ["an extra field", { ...valid, price: 1 }],
    ["a string time", { ...valid, periodEnd: "soon" }],
    ["trialing with no trial end", { ...valid, standing: "trialing", trialEndsAt: null }],
    ["an unknown interval", { ...valid, interval: "week" }],
    ["a non-boolean hasProviderSubscription", { ...valid, hasProviderSubscription: "yes" }],
    ["a discount with no label", { ...valid, discount: {} }],
    ["a discount with extra keys", { ...valid, discount: { label: "x", percent: 5 } }],
    ["the retired discountLabel field", { ...valid, discountLabel: null }],
    ["an unknown added feature", { ...valid, overrides: { ...valid.overrides, addFeatures: ["nope"] } }],
    ["an unknown removed feature", { ...valid, overrides: { ...valid.overrides, removeFeatures: ["nope"] } }],
    ["an unknown limit", { ...valid, overrides: { ...valid.overrides, limits: { nope: 1 } } }],
    [
      "a feature both added and removed",
      { ...valid, overrides: { addFeatures: ["business"], removeFeatures: ["business"], limits: {} } },
    ],
  ])("rejects %s", (_name, body) => {
    expect(parseBillingProjectionRequest(body).ok).toBe(false);
  });

  test("accepts the largest version the plane can hold", () => {
    expect(parseBillingProjectionRequest({ ...valid, version: MAX_PROJECTION_VERSION }).ok).toBe(true);
  });

  test("accepts the portal fields, a trialing standing with its end, and null (unlimited) limits", () => {
    expect(
      parsed({
        ...valid,
        standing: "trialing",
        trialEndsAt: 5,
        interval: "year",
        exemptUntil: 6,
        spinDownAt: 7,
        hasProviderSubscription: true,
        discount: { label: "50% off" },
        overrides: { ...valid.overrides, limits: { "org.members": null } },
      })
    ).toMatchObject({
      interval: "year",
      exemptUntil: 6,
      spinDownAt: 7,
      hasProviderSubscription: true,
      discount: { label: "50% off" },
      overrides: { limits: [{ key: "org.members", value: null }] },
    });
  });

  test("accepts a null tier and turns limits into a list", () => {
    expect(parsed({ ...valid, tier: null })).toMatchObject({
      tier: null,
      overrides: { limits: [{ key: "org.members", value: 9 }] },
    });
  });
});

describe("POST /api/ops/accounts/:id/billing-projection", () => {
  let previous: string | undefined;
  beforeEach(() => {
    previous = process.env[OPS_SECRET_ENV];
    process.env[OPS_SECRET_ENV] = SECRET;
  });
  afterEach(() => {
    if (previous === undefined) {
      delete process.env[OPS_SECRET_ENV];
    } else {
      process.env[OPS_SECRET_ENV] = previous;
    }
  });

  function post(t: Backend, accountId: string, body: unknown, headers: Record<string, string | undefined> = {}) {
    const all: Record<string, string | undefined> = {
      Authorization: `Bearer ${SECRET}`,
      "X-Woofx3-Actor": "billing-plane",
      "X-Woofx3-Reason": encodeURIComponent("projection push"),
      "Content-Type": "application/json",
      "Idempotency-Key": `${accountId}:${(body as { version?: number }).version}`,
      ...headers,
    };
    const defined = Object.fromEntries(Object.entries(all).filter(([, value]) => value !== undefined)) as Record<
      string,
      string
    >;
    return t.fetch(`/api/ops/accounts/${accountId}/billing-projection`, {
      method: "POST",
      headers: defined,
      body: JSON.stringify(body),
    });
  }

  test.each([
    ["POST", "plan"],
    ["POST", "exemption"],
    ["POST", "suspend"],
    ["POST", "discount"],
  ])("%s /api/ops/accounts/:id/%s is no longer served", async (method, write) => {
    const t = newBackend();
    const accountId = await org(t);
    const response = await t.fetch(`/api/ops/accounts/${accountId}/${write}`, {
      method,
      headers: {
        Authorization: `Bearer ${SECRET}`,
        "X-Woofx3-Actor": "ops@woofx3.tv",
        "X-Woofx3-Reason": encodeURIComponent("support ticket 12"),
        "Idempotency-Key": "key-removed-route-1",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ reason: "chargeback" }),
    });
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: { code: "not_found" } });
  });

  test("the stray payments read is no longer served", async () => {
    const t = newBackend();
    const response = await t.fetch("/api/ops/payments/strays", {
      headers: { Authorization: `Bearer ${SECRET}`, "X-Woofx3-Actor": "ops@woofx3.tv" },
    });
    expect(response.status).toBe(404);
  });

  test("an unknown override key is a 400, not dropped", async () => {
    const t = newBackend();
    const accountId = await org(t);
    const response = await post(
      t,
      accountId,
      wire(accountId, 1, { overrides: { addFeatures: ["nope"], removeFeatures: [], limits: {} } })
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "invalid_billing_projection" } });
    expect(await rows(t)).toEqual([]);
  });

  test("an applied push is audited with the operator; a replay and a stale push are not", async () => {
    const t = newBackend();
    const accountId = await org(t);
    await post(t, accountId, wire(accountId, 2));
    await post(t, accountId, wire(accountId, 2));
    await post(t, accountId, wire(accountId, 1));
    const audit = await t.run((ctx) => ctx.db.query("opsAuditLog").collect());
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actor: "billing-plane",
      action: "accounts.billingProjection",
      target: accountId,
      reason: "projection push",
      result: "ok",
    });
  });

  test("applies a push, then replays it", async () => {
    const t = newBackend();
    const accountId = await org(t);
    const first = await post(t, accountId, wire(accountId, 4));
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ data: { applied: true, version: 4 } });
    const again = await post(t, accountId, wire(accountId, 4));
    expect(await again.json()).toEqual({ data: { applied: true, version: 4 } });
    expect(await rows(t)).toHaveLength(1);
  });

  test.each<[string, string | undefined, number, string]>([
    ["missing", undefined, 400, "invalid_idempotency_key"],
    ["malformed", "short", 400, "invalid_idempotency_key"],
    ["not accountId:version", "another-key-entirely", 400, "invalid_idempotency_key"],
  ])("a %s Idempotency-Key is refused", async (_name, key, status, code) => {
    const t = newBackend();
    const accountId = await org(t);
    const response = await post(t, accountId, wire(accountId, 1), { "Idempotency-Key": key });
    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ error: { code } });
    expect(await rows(t)).toEqual([]);
  });

  test("another body under the same key is a 409", async () => {
    const t = newBackend();
    const accountId = await org(t);
    await post(t, accountId, wire(accountId, 1));
    const response = await post(t, accountId, wire(accountId, 1, { tier: "starter" }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "idempotency_mismatch" } });
  });

  test("an invalid body, or an account that differs from the path, is a 400", async () => {
    const t = newBackend();
    const accountId = await org(t);
    expect((await post(t, accountId, wire(accountId, 1, { standing: "paused" }))).status).toBe(400);
    const other = await org(t);
    expect((await post(t, accountId, wire(other, 1), { "Idempotency-Key": `${accountId}:1` })).status).toBe(400);
  });

  test("an unknown org is the standard not-found", async () => {
    const t = newBackend();
    const accountId = await org(t);
    await t.run((ctx) => ctx.db.delete(accountId));
    const response = await post(t, accountId, wire(accountId, 1));
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: { code: "not_found" } });
  });

  test.each<[string, Record<string, string | undefined>, number]>([
    ["no bearer secret", { Authorization: undefined }, 401],
    ["a wrong secret", { Authorization: `Bearer ${"x".repeat(64)}` }, 401],
    ["no actor", { "X-Woofx3-Actor": undefined }, 400],
    ["no reason", { "X-Woofx3-Reason": undefined }, 400],
  ])("%s is refused before anything is written", async (_name, headers, status) => {
    const t = newBackend();
    const accountId = await org(t);
    expect((await post(t, accountId, wire(accountId, 1), headers)).status).toBe(status);
    expect(await rows(t)).toEqual([]);
  });
});

describe("resetBillingProjection", () => {
  const push = (t: Backend, accountId: Id<"accounts">, version: number, overrides: object = {}) =>
    t.mutation(internal.ops.billingProjection.applyBillingProjection, parsed(wire(accountId, version, overrides)));
  const reset = (t: Backend, accountId: string) =>
    t.mutation(internal.ops.billingProjection.resetBillingProjection, {
      accountId,
      actor: "ops@woofx3.tv",
      auditReason: "plane counter rebuilt",
    });

  test("a poisoned version blocks later pushes until the reset, and not after", async () => {
    const t = newBackend();
    const accountId = await org(t);
    await push(t, accountId, MAX_PROJECTION_VERSION);
    expect(await push(t, accountId, 1, { tier: "starter" })).toEqual({
      ok: true,
      result: { applied: false, version: MAX_PROJECTION_VERSION },
    });

    expect(await reset(t, accountId)).toEqual({
      ok: true,
      result: { previousVersion: MAX_PROJECTION_VERSION, version: 0 },
    });
    expect(await push(t, accountId, 1, { tier: "starter" })).toEqual({
      ok: true,
      result: { applied: true, version: 1 },
    });
    expect((await rows(t)).map((row) => [row.version, row.tier])).toEqual([[1, "starter"]]);
  });

  test("changes no entitlement field by itself and is audited with the operator and reason", async () => {
    const t = newBackend();
    const accountId = await org(t);
    await push(t, accountId, 5);
    const [before] = await rows(t);
    await reset(t, accountId);
    const [after] = await rows(t);
    expect(after).toEqual({ ...before, version: 0 });
    const audit = await t.run((ctx) => ctx.db.query("opsAuditLog").collect());
    expect(audit.filter((entry) => entry.action === "accounts.billingProjectionReset")).toMatchObject([
      { actor: "ops@woofx3.tv", target: accountId, reason: "plane counter rebuilt", result: "ok" },
    ]);
  });

  test("an account with no projection, or an unknown one, is a 404 and writes nothing", async () => {
    const t = newBackend();
    const accountId = await org(t);
    expect(await reset(t, accountId)).toMatchObject({ ok: false, status: 404, code: "no_projection" });
    await t.run((ctx) => ctx.db.delete(accountId));
    expect(await reset(t, accountId)).toMatchObject({ ok: false, status: 404, code: "not_found" });
    expect(await t.run((ctx) => ctx.db.query("opsAuditLog").collect())).toEqual([]);
  });
});

describe("POST /api/ops/accounts/:id/billing-projection-reset", () => {
  let previous: string | undefined;
  beforeEach(() => {
    previous = process.env[OPS_SECRET_ENV];
    process.env[OPS_SECRET_ENV] = SECRET;
  });
  afterEach(() => {
    if (previous === undefined) {
      delete process.env[OPS_SECRET_ENV];
    } else {
      process.env[OPS_SECRET_ENV] = previous;
    }
  });

  const reset = (t: Backend, accountId: string, headers: Record<string, string> = {}) =>
    t.fetch(`/api/ops/accounts/${accountId}/billing-projection-reset`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SECRET}`,
        "X-Woofx3-Actor": "ops@woofx3.tv",
        "X-Woofx3-Reason": encodeURIComponent("plane counter rebuilt"),
        ...headers,
      },
    });

  test("resets the stored version so the same version is applied again", async () => {
    const t = newBackend();
    const accountId = await org(t);
    await t.mutation(internal.ops.billingProjection.applyBillingProjection, parsed(wire(accountId, 7)));
    const response = await reset(t, accountId);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { previousVersion: 7, version: 0 } });
    expect(await t.mutation(internal.ops.billingProjection.applyBillingProjection, parsed(wire(accountId, 7)))).toEqual(
      { ok: true, result: { applied: true, version: 7 } }
    );
  });

  test("an unknown org is the standard not-found", async () => {
    const t = newBackend();
    const accountId = await org(t);
    await t.run((ctx) => ctx.db.delete(accountId));
    const response = await reset(t, accountId);
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: { code: "not_found" } });
  });

  test.each<[string, Record<string, string>, number]>([
    ["a wrong secret", { Authorization: `Bearer ${"x".repeat(64)}` }, 401],
    ["no reason", { "X-Woofx3-Reason": "" }, 400],
  ])("%s is refused and nothing changes", async (_name, headers, status) => {
    const t = newBackend();
    const accountId = await org(t);
    await t.mutation(internal.ops.billingProjection.applyBillingProjection, parsed(wire(accountId, 3)));
    expect((await reset(t, accountId, headers)).status).toBe(status);
    expect((await rows(t))[0]?.version).toBe(3);
  });
});
