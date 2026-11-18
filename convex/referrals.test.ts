import { beforeEach, describe, expect, test } from "bun:test";
import { makeFunctionReference } from "convex/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { newBackend } from "./lib/convexTest.testing";
import { callerSecretEnv } from "./lib/ops/callers";
import { CAPTURE_WINDOW_MS } from "./referrals";

type Backend = ReturnType<typeof newBackend>;

const myCode = makeFunctionReference<"mutation", Record<string, never>, string>("referrals:myCode");
const capture = makeFunctionReference<"mutation", { code: string }, null>("referrals:capture");
const ensureMyAccount = makeFunctionReference<"mutation", Record<string, never>, Id<"accounts">>(
  "accounts:ensureMyAccount"
);

const as = (t: Backend, userId: Id<"users">) => t.withIdentity({ subject: `${userId}|s` });
const newUser = (t: Backend, name: string) => t.run((ctx) => ctx.db.insert("users", { name }));
const referrals = (t: Backend) => t.run((ctx) => ctx.db.query("referrals").collect());

describe("referral codes", () => {
  test("a user keeps one code, and it is not their id", async () => {
    const t = newBackend();
    const userId = await newUser(t, "Ref");
    const first = await as(t, userId).mutation(myCode, {});
    expect(await as(t, userId).mutation(myCode, {})).toBe(first);
    expect(first).toMatch(/^[a-z2-9]{10}$/);
    expect(first).not.toContain(userId);
  });

  test("two users get different codes", async () => {
    const t = newBackend();
    const a = await as(t, await newUser(t, "A")).mutation(myCode, {});
    const b = await as(t, await newUser(t, "B")).mutation(myCode, {});
    expect(a).not.toBe(b);
  });
});

describe("referral capture", () => {
  let t: Backend;
  let referrerId: Id<"users">;
  let code: string;
  beforeEach(async () => {
    t = newBackend();
    referrerId = await newUser(t, "Referrer");
    code = await as(t, referrerId).mutation(myCode, {});
  });

  test("records the referrer, then the org once it exists", async () => {
    const referredId = await newUser(t, "New");
    await as(t, referredId).mutation(capture, { code });
    expect(await referrals(t)).toMatchObject([
      { referredUserId: referredId, referrerUserId: referrerId, status: "captured" },
    ]);

    const accountId = await as(t, referredId).mutation(ensureMyAccount, {});
    expect(await referrals(t)).toMatchObject([{ referredAccountId: accountId, status: "org_created" }]);
  });

  test("a capture after the org exists is attached at once", async () => {
    const referredId = await newUser(t, "New");
    const accountId = await as(t, referredId).mutation(ensureMyAccount, {});
    await as(t, referredId).mutation(capture, { code });
    expect(await referrals(t)).toMatchObject([{ referredAccountId: accountId, status: "org_created" }]);
  });

  test("the first capture wins", async () => {
    const otherId = await newUser(t, "Other");
    const otherCode = await as(t, otherId).mutation(myCode, {});
    const referredId = await newUser(t, "New");
    await as(t, referredId).mutation(capture, { code });
    await as(t, referredId).mutation(capture, { code: otherCode });
    await as(t, referredId).mutation(capture, { code });
    expect(await referrals(t)).toMatchObject([{ referrerUserId: referrerId }]);
  });

  test.each([
    ["an unknown code", "nosuchcode1"],
    ["an empty code", ""],
    ["an oversized code", "x".repeat(500)],
  ])("%s is ignored without an error", async (_name, bad) => {
    const referredId = await newUser(t, "New");
    expect(await as(t, referredId).mutation(capture, { code: bad })).toBeNull();
    expect(await referrals(t)).toEqual([]);
  });

  test("a self-referral is ignored without an error", async () => {
    expect(await as(t, referrerId).mutation(capture, { code })).toBeNull();
    expect(await referrals(t)).toEqual([]);
  });

  test("an established user cannot claim a referrer", async () => {
    const referredId = await newUser(t, "Old");
    const realNow = Date.now;
    Date.now = () => realNow() + CAPTURE_WINDOW_MS + 1;
    try {
      expect(await as(t, referredId).mutation(capture, { code })).toBeNull();
    } finally {
      Date.now = realNow;
    }
    expect(await referrals(t)).toEqual([]);
  });

  test("an unauthenticated capture is refused", async () => {
    await expect(t.mutation(capture, { code })).rejects.toThrow("Not authenticated");
  });
});

describe("ops referral read", () => {
  const SECRET = "b".repeat(43);
  const ENV = callerSecretEnv("billing");
  const read = (t: Backend, accountId: string, secret = SECRET) =>
    t.fetch(`/api/ops/accounts/${accountId}/referral`, {
      headers: { Authorization: `Bearer ${secret}`, "X-Woofx3-Actor": "billing-plane" },
    });

  beforeEach(() => {
    process.env[ENV] = SECRET;
  });

  test("returns the referral without leaking the referred or referrer identity", async () => {
    const t = newBackend();
    const referrerId = await newUser(t, "Referrer");
    const code = await as(t, referrerId).mutation(myCode, {});
    const referredId = await newUser(t, "New");
    await as(t, referredId).mutation(capture, { code });
    const accountId = await as(t, referredId).mutation(ensureMyAccount, {});

    const response = await read(t, accountId);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: Record<string, unknown> };
    expect(Object.keys(body.data).sort()).toEqual(["capturedAt", "code", "referrerUserId", "status"]);
    expect(body.data).toMatchObject({ referrerUserId: referrerId, code, status: "org_created" });
    expect(JSON.stringify(body)).not.toContain(referredId);
    const audit = await t.run((ctx) => ctx.db.query("opsAuditLog").collect());
    expect(audit).toMatchObject([{ action: "accounts.referral", target: accountId, caller: "billing" }]);
  });

  test("an org with no referral answers 404", async () => {
    const t = newBackend();
    const accountId = await t.run(async (ctx) => {
      const ownerId = await ctx.db.insert("users", { name: "Owner" });
      return ctx.db.insert("accounts", { name: "Org", ownerId, createdAt: 1 });
    });
    expect((await read(t, accountId)).status).toBe(404);
  });

  test("a wrong secret is 401 and says nothing about the account", async () => {
    const t = newBackend();
    const response = await read(t, "anything", "x".repeat(43));
    expect(response.status).toBe(401);
  });

  test("the query answers null for an id that is not an account", async () => {
    const t = newBackend();
    expect(await t.query(internal.ops.referrals.forAccount, { accountId: "nope" })).toBeNull();
  });
});
