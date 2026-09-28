import { ConvexCredentials } from "@convex-dev/auth/providers/ConvexCredentials";
import { Password } from "@convex-dev/auth/providers/Password";
import { convexAuth, createAccount } from "@convex-dev/auth/server";
import { internal } from "./_generated/api";
import { hashOpaqueToken, isOpaqueToken } from "./lib/oauthHandoff";

export const { auth, signIn, signOut, store } = convexAuth({
  providers: [
    Password,
    ConvexCredentials({
      id: "twitch",
      authorize: async (credentials, ctx) => {
        const token = credentials.token;
        const nonce = credentials.nonce;
        if (typeof token !== "string" || token.length === 0 || !isOpaqueToken(nonce)) {
          console.log("twitch sign-in refused: missing token or nonce");
          return null;
        }

        const profile = await ctx.runMutation(internal.twitchAuth.lookupPendingAuth, {
          token,
          nonceHash: await hashOpaqueToken(nonce),
        });
        if (!profile) {
          console.log("twitch sign-in refused: pending sign-in not found, expired, or started elsewhere");
          return null;
        }

        console.log("creating account");

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
          console.error("createAccount threw:", String(err));
          return null;
        }

        if (!result.user) {
          // Orphaned authAccounts record from a previous failed run — the linked
          // user document was never committed or was deleted. Remove it and retry.
          console.log("orphaned account detected, repairing...");
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
            console.error("createAccount retry threw:", String(err));
            return null;
          }

          if (!result.user) {
            console.error("createAccount still returned null user after repair");
            return null;
          }
        }

        console.log("account created, userId:", result.user._id);

        return { userId: result.user._id };
      },
    }),
  ],
});
