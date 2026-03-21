import Twitch from "@auth/core/providers/twitch";
import { Password } from "@convex-dev/auth/providers/Password";
import { convexAuth } from "@convex-dev/auth/server";

export const { auth, signIn, signOut, store } = convexAuth({
  providers: [
    Password,
    Twitch({
      clientId: process.env.AUTH_TWITCH_ID,
      clientSecret: process.env.AUTH_TWITCH_SECRET,
    }),
  ],
});
