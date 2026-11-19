import { beforeEach, describe, expect, test } from "bun:test";
import { makeFunctionReference } from "convex/server";
import type { Id } from "../_generated/dataModel";
import { newBackend } from "../lib/convexTest.testing";
import { callerSecretEnv } from "../lib/ops/callers";

type Backend = ReturnType<typeof newBackend>;

const capture = makeFunctionReference<"mutation", { code: string }, null>("referrals:capture");
const SECRET = "o".repeat(43);
const HEADER_ACTOR = "backoffice-session";
const BODY_ACTOR = "ops@example.com";

beforeEach(() => {
  process.env[callerSecretEnv("backoffice")] = SECRET;
});

function call(t: Backend, method: string, path: string, body?: unknown) {
  return t.fetch(path, {
    method,
    headers: {
      Authorization: `Bearer ${SECRET}`,
      "X-Woofx3-Actor": HEADER_ACTOR,
      "X-Woofx3-Reason": "test",
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

interface CodeData {
  code: string;
  userId: string;
  email: string | null;
  rewardCents: number;
  issuedBy: string;
  issuedAt: number;
  revokedAt: number | null;
  referralCount: number;
}

async function data<T>(response: Response): Promise<T> {
  return ((await response.json()) as { data: T }).data;
}

async function errorCode(response: Response): Promise<string> {
  return ((await response.json()) as { error: { code: string } }).error.code;
}

const newUser = (t: Backend, email: string) => t.run((ctx) => ctx.db.insert("users", { name: "P", email }));
const auditRows = (t: Backend) => t.run((ctx) => ctx.db.query("opsAuditLog").collect());

async function issue(t: Backend, email: string, rewardCents = 2500): Promise<CodeData> {
  const response = await call(t, "POST", "/api/ops/referral-codes", { email, rewardCents, actor: BODY_ACTOR });
  expect(response.status).toBe(201);
  return data<CodeData>(response);
}

describe("issuing a referral code", () => {
  test("creates one code with the terms, matching the email case-insensitively", async () => {
    const t = newBackend();
    const userId = await newUser(t, "streamer@example.com");
    const code = await issue(t, " Streamer@Example.com ");
    expect(code).toMatchObject({
      userId,
      email: "streamer@example.com",
      rewardCents: 2500,
      issuedBy: BODY_ACTOR,
      revokedAt: null,
      referralCount: 0,
    });
    expect(code.code).toMatch(/^[a-z2-9]{10}$/);
    expect(code.code).not.toContain(userId);
    expect(await auditRows(t)).toMatchObject([
      { action: "referralCodes.issue", target: code.code, caller: "backoffice", actor: HEADER_ACTOR, result: "ok" },
    ]);
  });

  test("an unknown email is 404 user_not_found, and audited", async () => {
    const t = newBackend();
    const response = await call(t, "POST", "/api/ops/referral-codes", {
      email: "nobody@example.com",
      rewardCents: 100,
      actor: BODY_ACTOR,
    });
    expect(response.status).toBe(404);
    expect(await errorCode(response)).toBe("user_not_found");
    expect(await auditRows(t)).toMatchObject([{ action: "referralCodes.issue", result: "user_not_found" }]);
  });

  test("a second code for the same user is 409 code_exists", async () => {
    const t = newBackend();
    await newUser(t, "a@example.com");
    await issue(t, "a@example.com");
    const response = await call(t, "POST", "/api/ops/referral-codes", {
      email: "a@example.com",
      rewardCents: 100,
      actor: BODY_ACTOR,
    });
    expect(response.status).toBe(409);
    expect(await errorCode(response)).toBe("code_exists");
  });

  test("a revoked code does not block a new one", async () => {
    const t = newBackend();
    await newUser(t, "a@example.com");
    const first = await issue(t, "a@example.com");
    await call(t, "POST", `/api/ops/referral-codes/${first.code}/revoke`, { actor: BODY_ACTOR });
    const second = await issue(t, "a@example.com");
    expect(second.code).not.toBe(first.code);
  });

  test.each([
    ["zero", 0],
    ["negative", -5],
    ["fractional", 10.5],
    ["too large", 1_000_001],
    ["a string", "100"],
  ])("a %s amount is 400 validation_failed", async (_name, rewardCents) => {
    const t = newBackend();
    await newUser(t, "a@example.com");
    const response = await call(t, "POST", "/api/ops/referral-codes", {
      email: "a@example.com",
      rewardCents,
      actor: BODY_ACTOR,
    });
    expect(response.status).toBe(400);
    expect(await errorCode(response)).toBe("validation_failed");
  });

  test("the largest amount is accepted", async () => {
    const t = newBackend();
    await newUser(t, "a@example.com");
    expect((await issue(t, "a@example.com", 1_000_000)).rewardCents).toBe(1_000_000);
  });
});

describe("listing, editing and revoking", () => {
  test("lists newest first with each code's referral count", async () => {
    const t = newBackend();
    await newUser(t, "a@example.com");
    await newUser(t, "b@example.com");
    const first = await issue(t, "a@example.com");
    const second = await issue(t, "b@example.com");
    const referred: Id<"users"> = await t.run((ctx) => ctx.db.insert("users", { name: "New" }));
    await t.withIdentity({ subject: `${referred}|s` }).mutation(capture, { code: first.code });

    const body = await data<{ codes: CodeData[] }>(await call(t, "GET", "/api/ops/referral-codes"));
    expect(body.codes.map((row) => [row.code, row.referralCount])).toEqual([
      [second.code, 0],
      [first.code, 1],
    ]);
  });

  test("an edit changes later captures only, never an existing referral", async () => {
    const t = newBackend();
    await newUser(t, "a@example.com");
    const { code } = await issue(t, "a@example.com", 2500);
    const early: Id<"users"> = await t.run((ctx) => ctx.db.insert("users", { name: "Early" }));
    await t.withIdentity({ subject: `${early}|s` }).mutation(capture, { code });

    const response = await call(t, "PATCH", `/api/ops/referral-codes/${code}`, {
      rewardCents: 5000,
      actor: BODY_ACTOR,
    });
    expect(response.status).toBe(200);
    expect((await data<CodeData>(response)).rewardCents).toBe(5000);

    const late: Id<"users"> = await t.run((ctx) => ctx.db.insert("users", { name: "Late" }));
    await t.withIdentity({ subject: `${late}|s` }).mutation(capture, { code });
    const rows = await t.run((ctx) => ctx.db.query("referrals").collect());
    expect(rows.map((row) => [row.referredUserId, row.rewardCents])).toEqual([
      [early, 2500],
      [late, 5000],
    ]);
    expect((await auditRows(t)).map((row) => row.action)).toEqual(["referralCodes.issue", "referralCodes.update"]);
  });

  test("editing an unknown code is 404, a bad amount is 400, a revoked code is 409 code_revoked", async () => {
    const t = newBackend();
    await newUser(t, "a@example.com");
    const { code } = await issue(t, "a@example.com");
    const edit = (path: string, rewardCents: number) =>
      call(t, "PATCH", `/api/ops/referral-codes/${path}`, { rewardCents, actor: BODY_ACTOR });
    expect((await edit("nosuchcode", 100)).status).toBe(404);
    expect((await edit(code, 0)).status).toBe(400);
    await call(t, "POST", `/api/ops/referral-codes/${code}/revoke`, { actor: BODY_ACTOR });
    const revoked = await edit(code, 100);
    expect(revoked.status).toBe(409);
    expect(await errorCode(revoked)).toBe("code_revoked");
  });

  test("revoking is idempotent, keeps the first time, and blocks capture", async () => {
    const t = newBackend();
    await newUser(t, "a@example.com");
    const { code } = await issue(t, "a@example.com");
    const first = await call(t, "POST", `/api/ops/referral-codes/${code}/revoke`, { actor: BODY_ACTOR });
    expect(first.status).toBe(200);
    const { revokedAt } = await data<CodeData>(first);
    expect(revokedAt).not.toBeNull();
    const again = await call(t, "POST", `/api/ops/referral-codes/${code}/revoke`, { actor: BODY_ACTOR });
    expect((await data<CodeData>(again)).revokedAt).toBe(revokedAt);

    const referred: Id<"users"> = await t.run((ctx) => ctx.db.insert("users", { name: "New" }));
    await t.withIdentity({ subject: `${referred}|s` }).mutation(capture, { code });
    expect(await t.run((ctx) => ctx.db.query("referrals").collect())).toEqual([]);
  });

  test("revoking an unknown code is 404", async () => {
    const t = newBackend();
    const response = await call(t, "POST", "/api/ops/referral-codes/nosuchcode/revoke", { actor: BODY_ACTOR });
    expect(response.status).toBe(404);
  });

  test("a request without an actor is 400", async () => {
    const t = newBackend();
    const response = await call(t, "POST", "/api/ops/referral-codes/abc/revoke", {});
    expect(response.status).toBe(400);
  });
});
