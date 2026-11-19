import { ConvexCredentials } from "@convex-dev/auth/providers/ConvexCredentials";
import { Password } from "@convex-dev/auth/providers/Password";
import { type ConvexCredentialsConfig, convexAuth, createAccount } from "@convex-dev/auth/server";
import { internal } from "./_generated/api";
import { hashOpaqueToken, isOpaqueToken } from "./lib/oauthHandoff";
import { requireSignUpChallenge } from "./lib/signUpChallenge";
import { logger } from "./logger";

/**
 * `Password`, with a Turnstile check before a sign-up creates the user. Its
 * `profile` hook is synchronous, so the check wraps the provider's own
 * `authorize` instead. `ConvexCredentials` keeps a provider's callbacks under
 * `options`, which Convex Auth merges over the provider as it loads it; the
 * throw below stops the deployment from loading if that ever changes. Sign-in
 * and the Twitch provider are not checked.
 */
function passwordWithSignUpChallenge(): ConvexCredentialsConfig {
  const password = (Password() as ConvexCredentialsConfig & { options?: ConvexCredentialsConfig }).options;
  if (password === undefined) {
    throw new Error("Convex Auth's Password provider no longer keeps its callbacks under options");
  }
  return ConvexCredentials({
    ...password,
    authorize: async (params, ctx) => {
      if (params.flow === "signUp") {
        await requireSignUpChallenge(params.turnstileToken);
      }
      return password.authorize(params, ctx);
    },
  });
}

export const { auth, signIn, signOut, store } = convexAuth({
  providers: [
    passwordWithSignUpChallenge(),
    ConvexCredentials({
      id: "twitch",
      authorize: async (credentials, ctx) => {
        const token = credentials.token;
        const nonce = credentials.nonce;
        if (typeof token !== "string" || token.length === 0 || !isOpaqueToken(nonce)) {
          logger.warn("twitch sign-in refused: missing token or nonce");
          return null;
        }

        const profile = await ctx.runMutation(internal.twitchAuth.lookupPendingAuth, {
          token,
          nonceHash: await hashOpaqueToken(nonce),
        });
        if (!profile) {
          logger.warn("twitch sign-in refused: pending sign-in not found, expired, or started elsewhere");
          return null;
        }

        let result: Awaited<ReturnType<typeof createAccount>>;
        try {
          result = await createAccount(ctx, {
            provider: "twitch",
            account: { id: profile.twitchId },
            profile: {
              name: profile.displayName,
              email: profile.email,
              image: profile.profileImage,
            },
          });
        } catch (err) {
          logger.error("createAccount threw", { error: String(err) });
          return null;
        }

        if (!result.user) {
          // Orphaned authAccounts record from a previous failed run — the linked
          // user document was never committed or was deleted. Remove it and retry.
          logger.warn("orphaned account detected, repairing");
          await ctx.runMutation(internal.twitchAuth.deleteOrphanedAuthAccount, {
            providerAccountId: profile.twitchId,
          });

          try {
            result = await createAccount(ctx, {
              provider: "twitch",
              account: { id: profile.twitchId },
              profile: {
                name: profile.displayName,
                email: profile.email,
                image: profile.profileImage,
              },
            });
          } catch (err) {
            logger.error("createAccount retry threw", { error: String(err) });
            return null;
          }

          if (!result.user) {
            logger.error("createAccount still returned null user after repair");
            return null;
          }
        }

        return { userId: result.user._id };
      },
    }),
  ],
  callbacks: {
    afterUserCreatedOrUpdated: async (ctx, { userId, existingUserId, type, provider }) => {
      if (existingUserId === null && type === "credentials" && provider.id === "password") {
        await ctx.scheduler.runAfter(0, internal.emailVerification.sendAtSignUp, { userId });
      }
    },
  },
});
