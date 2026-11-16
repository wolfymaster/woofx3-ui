import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { ConvexError } from "convex/values";
import { api } from "./_generated/api";
import { newBackend } from "./lib/convexTest.testing";
import { signUpTurnstileSecret, TURNSTILE_ALWAYS_PASSES_SECRET } from "./lib/signUpChallenge";

type Backend = ReturnType<typeof newBackend>;

const EMAIL = "sponsor@example.com";
const PASSWORD = "correct horse battery";

/** What a fake siteverify was asked, and the answer it gives. */
function fakeSiteverify(success: boolean) {
  const asked: Array<{ secret: string; response: string }> = [];
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    asked.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ success }), { status: 200 });
  }) as typeof fetch;
  return asked;
}

function signUp(t: Backend, turnstileToken?: string) {
  return t.action(api.auth.signIn, {
    provider: "password",
    params: { email: EMAIL, password: PASSWORD, flow: "signUp", turnstileToken },
  });
}

async function passwordAccounts(t: Backend) {
  return t.run((ctx) => ctx.db.query("authAccounts").take(10));
}

async function challengeCode(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error instanceof ConvexError ? error.data.code : String(error);
  }
  return "no error";
}

describe("password sign-up's bot check", () => {
  const realFetch = globalThis.fetch;
  const saved = {
    secret: process.env.TURNSTILE_SECRET_KEY,
    preview: process.env.PREVIEW_DEPLOYMENT,
    jwt: process.env.JWT_PRIVATE_KEY,
    site: process.env.CONVEX_SITE_URL,
  };

  beforeEach(() => {
    process.env.TURNSTILE_SECRET_KEY = "real-secret";
    delete process.env.PREVIEW_DEPLOYMENT;
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    process.env.JWT_PRIVATE_KEY = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    process.env.CONVEX_SITE_URL = "https://site.test";
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    for (const [key, value] of Object.entries({
      TURNSTILE_SECRET_KEY: saved.secret,
      PREVIEW_DEPLOYMENT: saved.preview,
      JWT_PRIVATE_KEY: saved.jwt,
      CONVEX_SITE_URL: saved.site,
    })) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  test("a sign-up without a token is refused before any user exists", async () => {
    const asked = fakeSiteverify(true);
    const t = newBackend();
    expect(await challengeCode(signUp(t))).toBe("sign_up_challenge_failed");
    expect(asked).toEqual([]);
    expect(await passwordAccounts(t)).toEqual([]);
  });

  test("a token Cloudflare refuses is refused", async () => {
    fakeSiteverify(false);
    const t = newBackend();
    expect(await challengeCode(signUp(t, "token"))).toBe("sign_up_challenge_failed");
    expect(await passwordAccounts(t)).toEqual([]);
  });

  test("a token Cloudflare passes creates the user", async () => {
    const asked = fakeSiteverify(true);
    const t = newBackend();
    await signUp(t, "token");
    expect(asked).toEqual([{ secret: "real-secret", response: "token" }]);
    expect((await passwordAccounts(t)).map((account) => account.providerAccountId)).toEqual([EMAIL]);
  });

  test("signing in asks for no token", async () => {
    fakeSiteverify(true);
    const t = newBackend();
    await signUp(t, "token");
    const asked = fakeSiteverify(false);
    await t.action(api.auth.signIn, {
      provider: "password",
      params: { email: EMAIL, password: PASSWORD, flow: "signIn" },
    });
    expect(asked).toEqual([]);
  });
});

describe("signUpTurnstileSecret", () => {
  test("a preview always uses the test secret that passes", () => {
    expect(signUpTurnstileSecret({ PREVIEW_DEPLOYMENT: "true", TURNSTILE_SECRET_KEY: "real" })).toBe(
      TURNSTILE_ALWAYS_PASSES_SECRET
    );
  });

  test("elsewhere it is the configured secret", () => {
    expect(signUpTurnstileSecret({ TURNSTILE_SECRET_KEY: " real " })).toBe("real");
  });

  test("a deployment without one fails loudly", () => {
    expect(() => signUpTurnstileSecret({})).toThrow("TURNSTILE_SECRET_KEY is not set");
    expect(() => signUpTurnstileSecret({ TURNSTILE_SECRET_KEY: " " })).toThrow("TURNSTILE_SECRET_KEY is not set");
  });
});
