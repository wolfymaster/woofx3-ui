import { beforeEach, describe, expect, test } from "bun:test";
import { makeFunctionReference } from "convex/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { newBackend } from "./lib/convexTest.testing";
import { callerSecretEnv } from "./lib/ops/callers";
import { CAPTURE_WINDOW_MS } from "./referrals";

type Backend = ReturnType<typeof newBackend>;

const capture = makeFunctionReference<"mutation", { code: string }, null>("referrals:capture");
const ensureMyAccount = makeFunctionReference<"mutation", Record<string, never>, Id<"accounts">>(
  "accounts:ensureMyAccount"
);

const as = (t: Backend, userId: Id<"users">) => t.withIdentity({ subject: `${userId}|s` });
const newUser = (t: Backend, name: string) => t.run((ctx) => ctx.db.insert("users", { name }));
const REWARD_CENTS = 2500;
const issueCode = (t: Backend, userId: Id<"users">, rewardCents = REWARD_CENTS, code = `code${userId}`.slice(0, 10)) =>
  t.run(async (ctx) => {
    await ctx.db.insert("referralCodes", {
      userId,
      code,
      createdAt: Date.now(),
      rewardCents,
      issuedBy: "ops@example.com",
    });
    return code;
  });
const referrals = (t: Backend) => t.run((ctx) => ctx.db.query("referrals").collect());

describe("referral capture", () => {
  let t: Backend;
  let referrerId: Id<"users">;
  let code: string;
  beforeEach(async () => {
    t = newBackend();
    referrerId = await newUser(t, "Referrer");
    code = await issueCode(t, referrerId);
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

  test("snapshots the code's terms, which a later edit does not touch", async () => {
    const referredId = await newUser(t, "New");
    await as(t, referredId).mutation(capture, { code });
    await t.run(async (ctx) => {
      const row = await ctx.db
        .query("referralCodes")
        .withIndex("by_code", (q) => q.eq("code", code))
        .first();
      await ctx.db.patch(row?._id as Id<"referralCodes">, { rewardCents: 9999 });
    });
    const laterId = await newUser(t, "Later");
    await as(t, laterId).mutation(capture, { code });
    const rows = await referrals(t);
    expect(rows.find((row) => row.referredUserId === referredId)?.rewardCents).toBe(REWARD_CENTS);
    expect(rows.find((row) => row.referredUserId === laterId)?.rewardCents).toBe(9999);
  });

  test("a revoked code is ignored like an unknown one", async () => {
    await t.run(async (ctx) => {
      const row = await ctx.db
        .query("referralCodes")
        .withIndex("by_code", (q) => q.eq("code", code))
        .first();
      await ctx.db.patch(row?._id as Id<"referralCodes">, { revokedAt: Date.now() });
    });
    const referredId = await newUser(t, "New");
    expect(await as(t, referredId).mutation(capture, { code })).toBeNull();
    expect(await referrals(t)).toEqual([]);
  });

  test("the first capture wins", async () => {
    const otherId = await newUser(t, "Other");
    const otherCode = await issueCode(t, otherId);
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

  const VERIFIED = { emailVerificationTime: 1 };

  async function seed(
    t: Backend,
    opts: { referrerVerified: boolean; referredVerified: boolean; referrerOrg: boolean }
  ) {
    const referrerId = await t.run((ctx) =>
      ctx.db.insert("users", { name: "Referrer", ...(opts.referrerVerified ? VERIFIED : {}) })
    );
    const referrerAccountId = opts.referrerOrg ? await as(t, referrerId).mutation(ensureMyAccount, {}) : null;
    const code = await issueCode(t, referrerId);
    const referredId = await t.run((ctx) =>
      ctx.db.insert("users", { name: "New", ...(opts.referredVerified ? VERIFIED : {}) })
    );
    await as(t, referredId).mutation(capture, { code });
    const accountId = await as(t, referredId).mutation(ensureMyAccount, {});
    return { referrerId, referredId, referrerAccountId, accountId, code };
  }

  const body = async (response: Response) => ((await response.json()) as { data: Record<string, unknown> }).data;

  test("returns the referral shape without leaking user identity", async () => {
    const t = newBackend();
    const { referrerId, referredId, referrerAccountId, accountId, code } = await seed(t, {
      referrerVerified: true,
      referredVerified: true,
      referrerOrg: true,
    });

    const response = await read(t, accountId);
    expect(response.status).toBe(200);
    const data = await body(response);
    expect(Object.keys(data).sort()).toEqual([
      "capturedAt",
      "code",
      "eligible",
      "referralId",
      "referrerAccountId",
      "rewardCents",
      "status",
    ]);
    const [row] = await referrals(t);
    expect(data).toMatchObject({
      referralId: row._id,
      referrerAccountId,
      code,
      rewardCents: REWARD_CENTS,
      status: "org_created",
      eligible: true,
    });
    const text = JSON.stringify(data);
    expect(text).not.toContain(referredId);
    expect(text).not.toContain(referrerId);
    const audit = await t.run((ctx) => ctx.db.query("opsAuditLog").collect());
    expect(audit).toMatchObject([{ action: "accounts.referral", target: accountId, caller: "billing" }]);
  });

  test.each([
    ["the referrer is unverified", { referrerVerified: false, referredVerified: true, referrerOrg: true }],
    ["the referred user is unverified", { referrerVerified: true, referredVerified: false, referrerOrg: true }],
  ])("not eligible when %s", async (_name, opts) => {
    const t = newBackend();
    const { accountId } = await seed(t, opts);
    expect((await body(await read(t, accountId))).eligible).toBe(false);
  });

  test("not eligible, and no referrer account, when the referrer has no org", async () => {
    const t = newBackend();
    const { accountId } = await seed(t, { referrerVerified: true, referredVerified: true, referrerOrg: false });
    expect(await body(await read(t, accountId))).toMatchObject({ referrerAccountId: null, eligible: false });
  });

  test("not eligible when the referrer's org is the referred org", async () => {
    const t = newBackend();
    const { accountId } = await seed(t, { referrerVerified: true, referredVerified: true, referrerOrg: true });
    await t.run(async (ctx) => {
      const [row] = await ctx.db.query("referrals").collect();
      await ctx.db.patch(row.referrerUserId, {});
      const account = await ctx.db.get(row.referredAccountId as Id<"accounts">);
      await ctx.db.patch(row.referredAccountId as Id<"accounts">, {});
      await ctx.db.patch(row._id, { referrerUserId: account?.ownerId as Id<"users"> });
    });
    expect(await body(await read(t, accountId))).toMatchObject({ eligible: false });
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
