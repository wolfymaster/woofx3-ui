import { describe, expect, test } from "bun:test";
import { api, type internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { issueVerificationCode } from "./emailVerification";
import { newBackend } from "./lib/convexTest.testing";
import { EMAIL_VERIFICATION, newVerificationCode, type VerificationMailer } from "./lib/emailVerification";
import { isEmailVerified } from "./org/identity";

type Backend = ReturnType<typeof newBackend>;

class RecordingMailer implements VerificationMailer {
  readonly sent: { to: string; code: string }[] = [];
  async sendCode(request: { to: string; code: string }) {
    this.sent.push({ to: request.to, code: request.code });
  }
}

async function addUser(t: Backend): Promise<Id<"users">> {
  return t.run((ctx) => ctx.db.insert("users", { name: "u", email: "User@Example.com" }));
}

/** Issues a code through the real storage path with a scripted digit source and returns it. */
async function issue(t: Backend, userId: Id<"users">, digit = 4): Promise<string> {
  const mailer = new RecordingMailer();
  await issueVerificationCode(
    { runMutation: (ref, args) => t.mutation(ref as typeof internal.emailVerification.storeCode, args) },
    { randomInt: () => digit, mailer },
    { userId, email: "User@Example.com" }
  );
  return mailer.sent[0].code;
}

function as(t: Backend, userId: Id<"users">) {
  return t.withIdentity({ subject: `${userId}|session` });
}

describe("newVerificationCode", () => {
  test("is six digits drawn from the injected source", () => {
    let next = 0;
    expect(newVerificationCode(() => next++ % 10)).toBe("012345");
  });
});

describe("emailVerification.confirm", () => {
  test("the mailed code verifies the address once", async () => {
    const t = newBackend();
    const userId = await addUser(t);
    const code = await issue(t, userId);
    expect(code).toBe("444444");
    expect(await as(t, userId).mutation(api.emailVerification.confirm, { code })).toEqual({ status: "verified" });
    const user = await t.run((ctx) => ctx.db.get(userId));
    expect(user !== null && isEmailVerified(user)).toBe(true);
    expect(await as(t, userId).mutation(api.emailVerification.confirm, { code })).toEqual({ status: "no_code" });
  });

  test("a wrong code is invalid and a fifth miss voids the code", async () => {
    const t = newBackend();
    const userId = await addUser(t);
    const code = await issue(t, userId);
    for (let miss = 0; miss < EMAIL_VERIFICATION.maxFailedAttempts; miss += 1) {
      expect(await as(t, userId).mutation(api.emailVerification.confirm, { code: "000000" })).toEqual({
        status: "invalid",
      });
    }
    expect(await as(t, userId).mutation(api.emailVerification.confirm, { code })).toEqual({
      status: "too_many_attempts",
    });
  });

  test("an expired code is refused", async () => {
    const t = newBackend();
    const userId = await addUser(t);
    const code = await issue(t, userId);
    await t.run(async (ctx) => {
      const row = await ctx.db.query("emailVerificationCodes").first();
      await ctx.db.patch(row?._id as Id<"emailVerificationCodes">, { expiresAt: Date.now() - 1 });
    });
    expect(await as(t, userId).mutation(api.emailVerification.confirm, { code })).toEqual({ status: "expired" });
  });

  test("a new request replaces the old code", async () => {
    const t = newBackend();
    const userId = await addUser(t);
    const first = await issue(t, userId, 1);
    const second = await issue(t, userId, 2);
    expect(await as(t, userId).mutation(api.emailVerification.confirm, { code: first })).toEqual({ status: "invalid" });
    expect(await as(t, userId).mutation(api.emailVerification.confirm, { code: second })).toEqual({
      status: "verified",
    });
  });

  test("someone else's code does not verify the caller", async () => {
    const t = newBackend();
    const owner = await addUser(t);
    const other = await addUser(t);
    const code = await issue(t, owner);
    expect(await as(t, other).mutation(api.emailVerification.confirm, { code })).toEqual({ status: "no_code" });
  });
});
