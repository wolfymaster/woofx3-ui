import { describe, expect, test } from "bun:test";
import { api, internal } from "./_generated/api";
import { newBackend } from "./lib/convexTest.testing";
import { generateOpaqueToken, hashOpaqueToken } from "./lib/oauthHandoff";
import { type SignInClient, TWITCH_PENDING_SIGN_IN_TTL_MS } from "./lib/twitchSignIn";

type Backend = ReturnType<typeof newBackend>;

const PROFILE = {
  twitchId: "T1",
  displayName: "Wolfy",
  email: "wolfy@example.com",
  profileImage: "https://static-cdn.jtvnw.net/wolfy.png",
};

/** A sign-in the app started with a fresh nonce, and the state Convex stored for it. */
async function startSignIn(t: Backend, signInClient: SignInClient) {
  const nonce = generateOpaqueToken();
  const nonceHash = await hashOpaqueToken(nonce);
  const state = generateOpaqueToken();
  const stored = await t.mutation(internal.twitchAuth.storeState, { state, redirectTo: "/", nonceHash, signInClient });
  return { nonce, nonceHash, state, stored };
}

/** The callback's success path: the state consumed, then the Twitch profile held for the sign-in. */
async function finishSignIn(t: Backend, signIn: { state: string }) {
  const consumed = await t.mutation(internal.twitchAuth.validateAndConsumeState, { state: signIn.state });
  if (consumed === null || consumed.nonceHash === null || consumed.signInClient === null) {
    throw new Error("the sign-in state was not stored");
  }
  return t.mutation(internal.twitchAuth.storePendingAuth, {
    ...PROFILE,
    nonceHash: consumed.nonceHash,
    signInClient: consumed.signInClient,
  });
}

describe("desktop sign-in", () => {
  test("the app claims the token once with its nonce, and the token then signs in with the same nonce", async () => {
    const t = newBackend();
    const signIn = await startSignIn(t, "desktop");
    expect(signIn.stored).toBe("stored");
    expect(await t.mutation(api.twitchAuth.claimDesktopSignIn, { nonce: signIn.nonce })).toEqual({
      status: "pending",
    });

    const token = await finishSignIn(t, signIn);

    expect(await t.mutation(api.twitchAuth.claimDesktopSignIn, { nonce: signIn.nonce })).toEqual({
      status: "signed_in",
      token,
    });
    expect(await t.mutation(api.twitchAuth.claimDesktopSignIn, { nonce: signIn.nonce })).toEqual({
      status: "pending",
    });
    expect(
      await t.mutation(internal.twitchAuth.lookupPendingAuth, { token, nonceHash: signIn.nonceHash })
    ).toMatchObject({ twitchId: "T1" });
  });

  test("another nonce learns only that the sign-in is pending, and does not use up the outcome", async () => {
    const t = newBackend();
    const signIn = await startSignIn(t, "desktop");
    const token = await finishSignIn(t, signIn);

    for (const nonce of [generateOpaqueToken(), "not-a-nonce", "", signIn.nonceHash]) {
      expect(await t.mutation(api.twitchAuth.claimDesktopSignIn, { nonce })).toEqual({ status: "pending" });
    }
    expect(await t.mutation(api.twitchAuth.claimDesktopSignIn, { nonce: signIn.nonce })).toEqual({
      status: "signed_in",
      token,
    });
  });

  test("a refused sign-in is reported to the app once", async () => {
    const t = newBackend();
    const signIn = await startSignIn(t, "desktop");
    await t.mutation(internal.twitchAuth.validateAndConsumeState, { state: signIn.state });
    await t.mutation(internal.twitchAuth.storeDesktopSignInFailure, {
      nonceHash: signIn.nonceHash,
      error: "access_denied",
    });

    expect(await t.mutation(api.twitchAuth.claimDesktopSignIn, { nonce: signIn.nonce })).toEqual({
      status: "failed",
      error: "access_denied",
    });
    expect(await t.mutation(api.twitchAuth.claimDesktopSignIn, { nonce: signIn.nonce })).toEqual({
      status: "pending",
    });
  });

  test("an outcome past its time is reported as expired and removed", async () => {
    const t = newBackend();
    const signIn = await startSignIn(t, "desktop");
    await finishSignIn(t, signIn);
    await t.run(async (ctx) => {
      const row = await ctx.db
        .query("twitchDesktopSignIns")
        .withIndex("by_nonce_hash", (q) => q.eq("nonceHash", signIn.nonceHash))
        .unique();
      if (row === null) {
        throw new Error("no desktop outcome stored");
      }
      await ctx.db.patch(row._id, { createdAt: Date.now() - TWITCH_PENDING_SIGN_IN_TTL_MS - 1 });
    });

    expect(await t.mutation(api.twitchAuth.claimDesktopSignIn, { nonce: signIn.nonce })).toEqual({
      status: "expired",
    });
    const left = await t.run((ctx) => ctx.db.query("twitchDesktopSignIns").collect());
    expect(left).toEqual([]);
  });

  test("a second sign-in with a nonce hash already in use is refused until the first is claimed", async () => {
    const t = newBackend();
    const signIn = await startSignIn(t, "desktop");
    const again = () =>
      t.mutation(internal.twitchAuth.storeState, {
        state: generateOpaqueToken(),
        redirectTo: "/",
        nonceHash: signIn.nonceHash,
        signInClient: "desktop",
      });

    expect(await again()).toBe("nonce_in_use");
    await finishSignIn(t, signIn);
    expect(await again()).toBe("nonce_in_use");
    await t.mutation(api.twitchAuth.claimDesktopSignIn, { nonce: signIn.nonce });
    expect(await again()).toBe("stored");
  });
});

describe("web sign-in", () => {
  test("leaves nothing for a desktop claim: the token goes back in the callback URL", async () => {
    const t = newBackend();
    const signIn = await startSignIn(t, "web");
    const token = await finishSignIn(t, signIn);

    expect(await t.mutation(api.twitchAuth.claimDesktopSignIn, { nonce: signIn.nonce })).toEqual({
      status: "pending",
    });
    expect(
      await t.mutation(internal.twitchAuth.lookupPendingAuth, { token, nonceHash: signIn.nonceHash })
    ).toMatchObject({ twitchId: "T1" });
  });

  test("a state stored without a client finishes as a web sign-in", async () => {
    const t = newBackend();
    const nonceHash = await hashOpaqueToken(generateOpaqueToken());
    await t.run((ctx) =>
      ctx.db.insert("twitchOAuthState", { state: "s1", redirectTo: "/", nonceHash, createdAt: Date.now() })
    );

    expect(await t.mutation(internal.twitchAuth.validateAndConsumeState, { state: "s1" })).toEqual({
      redirectTo: "/",
      instanceId: null,
      userId: null,
      nonceHash,
      signInClient: "web",
    });
  });

  test("a sign-in must name its client", async () => {
    const t = newBackend();
    const nonceHash = await hashOpaqueToken(generateOpaqueToken());
    await expect(
      t.mutation(internal.twitchAuth.storeState, { state: generateOpaqueToken(), redirectTo: "/", nonceHash })
    ).rejects.toThrow("names the client");
  });
});
