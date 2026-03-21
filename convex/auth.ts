import { convexAuth } from "@convex-dev/auth/server";
import { Password } from "@convex-dev/auth/providers/Password";
import Twitch from "@auth/core/providers/twitch";

export const { auth, signIn, signOut, store } = convexAuth({
  providers: [
    Password,
    Twitch({
      clientId: process.env.AUTH_TWITCH_ID,
      clientSecret: process.env.AUTH_TWITCH_SECRET,
    }),
  ],
});
