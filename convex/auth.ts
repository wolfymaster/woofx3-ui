import { ConvexCredentials } from "@convex-dev/auth/providers/ConvexCredentials";
import { Password } from "@convex-dev/auth/providers/Password";
import { convexAuth, createAccount } from "@convex-dev/auth/server";
import { internal } from "./_generated/api";

export const { auth, signIn, signOut, store } = convexAuth({
  providers: [
    Password,
    ConvexCredentials({
      id: "twitch",
      authorize: async (credentials, ctx) => {
        const token = credentials.token as string | undefined;

        console.log("the token is:", token);

        if (!token) {
          console.log("token not found");
          return null;
        }

        const profile = await ctx.runMutation(internal.twitchAuth.lookupPendingAuth, { token });

        console.log("profile", profile);

        if (!profile) {
          console.log("no profile found");
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

        console.log("result", result);

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

        // Do NOT delete the token here — if the WebSocket drops before the JWT
        // is delivered to the client, the frontend retries signIn with the same
        // token. The token expires naturally after 5 minutes via lookupPendingAuth.

        console.log("account created, userId:", result.user._id);

        return { userId: result.user._id };
      },
    }),
  ],
});
