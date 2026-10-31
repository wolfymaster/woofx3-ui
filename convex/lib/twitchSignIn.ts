import { type Infer, v } from "convex/values";
import { OAUTH_ERROR_CODES } from "./oauthErrors";

/**
 * The two ways a Twitch sign-in is finished.
 *
 * A web sign-in returns to the SPA tab that started it, which presents its
 * nonce with the one-time token from the callback URL.
 *
 * A desktop sign-in runs in the system browser, which the desktop app cannot
 * follow. The app opens the start route with only its nonce's hash and keeps
 * the nonce. The callback never puts the token in a URL: it holds the
 * outcome under the nonce hash and shows a page that says to return to the
 * app, and the app claims the outcome with the nonce
 * (`twitchAuth.claimDesktopSignIn`). Whoever holds that browser therefore
 * never sees anything that could sign them in.
 *
 * Shared by Convex and the client, so it imports nothing from Convex but its
 * validators.
 */

/** How long a started sign-in waits for Twitch to answer before its state is dropped. */
export const TWITCH_SIGN_IN_STATE_TTL_MS = 10 * 60 * 1000;

/** How long a finished sign-in, or a desktop sign-in's outcome, waits to be claimed. */
export const TWITCH_PENDING_SIGN_IN_TTL_MS = 5 * 60 * 1000;

export const signInClientValidator = v.union(v.literal("web"), v.literal("desktop"));

export type SignInClient = Infer<typeof signInClientValidator>;

/**
 * The start route's `client` marker. Absent means the web app, whose start
 * URL has never carried one; any other value is null and refused.
 */
export function parseSignInClient(raw: string | null): SignInClient | null {
  if (raw === null || raw === "web") {
    return "web";
  }
  if (raw === "desktop") {
    return "desktop";
  }
  return null;
}

/** The web app's page a desktop sign-in's browser lands on; it holds nothing that signs anyone in. */
export const DESKTOP_SIGN_IN_PAGE_PATH = "/auth/twitch/desktop";

const NONCE_HASH_PATTERN = /^[0-9a-f]{64}$/;

/** Whether a value has the shape `hashOpaqueToken` produces: lowercase hex SHA-256. */
export function isNonceHash(value: unknown): value is string {
  return typeof value === "string" && NONCE_HASH_PATTERN.test(value);
}

export const oauthErrorCodeValidator = v.union(...OAUTH_ERROR_CODES.map((code) => v.literal(code)));

/** How a desktop sign-in ended, as the callback records it. */
export const desktopSignInOutcomeValidator = v.union(
  v.object({ kind: v.literal("signed_in"), token: v.string() }),
  v.object({ kind: v.literal("failed"), error: oauthErrorCodeValidator })
);

export type DesktopSignInOutcome = Infer<typeof desktopSignInOutcomeValidator>;

/**
 * What claiming a desktop sign-in found. "pending" also answers a nonce that
 * started no sign-in, or one already claimed, so a guess learns nothing.
 */
export const desktopSignInClaimValidator = v.union(
  v.object({ status: v.literal("pending") }),
  v.object({ status: v.literal("signed_in"), token: v.string() }),
  v.object({ status: v.literal("failed"), error: oauthErrorCodeValidator }),
  v.object({ status: v.literal("expired") })
);

export type DesktopSignInClaim = Infer<typeof desktopSignInClaimValidator>;
