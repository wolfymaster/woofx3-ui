/**
 * Rules for viewer sign-in on user pages, kept free of Convex imports so they
 * can be tested directly (validators only from `convex/values`).
 *
 * Viewers are not Convex Auth users. They sign in with their platform account
 * on a streamer's public page, and get a session token of their own that no
 * dashboard authorization (`getAuthUserId`, `requireInstanceRole`) accepts.
 *
 * A page can live on a custom domain, which cannot share cookies with this
 * deployment, so sign-in is a redirect round trip:
 *
 *   1. The page sends the browser to the login start route with the absolute
 *      URL to come back to and a nonce it keeps for itself.
 *   2. The start route checks the return origin against the allowlist, records
 *      the login under a hash of its OAuth state, and redirects to the platform.
 *   3. The callback consumes that state once, exchanges the code, upserts the
 *      viewer, and redirects back to the page with a one-time handoff code.
 *   4. The page exchanges handoff code and nonce for a session token, which it
 *      stores for its own origin.
 *
 * Every secret here (state, handoff code, session token) is stored only as a
 * SHA-256 hash, and every one-time value is deleted on first use.
 */

import { v } from "convex/values";
import { HANDOFF_TTL_MS, signInNonceMatches } from "./oauthHandoff";
import { safeRelativePath } from "./safeRedirect";

/** How long a login may sit on the platform's consent page before its state is refused. */
export const VIEWER_LOGIN_STATE_TTL_MS = 10 * 60 * 1000;

/** How long the page has to exchange a handoff code; the same window as dashboard handoffs. */
export const VIEWER_HANDOFF_TTL_MS = HANDOFF_TTL_MS;

/** How long a viewer stays signed in on one origin without signing in again. */
export const VIEWER_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * How long a viewer's follower and subscriber status is trusted before it is
 * asked of the platform again. Short enough that a new follow unlocks a gated
 * section within minutes, long enough that a busy page does not call the
 * platform on every view.
 */
export const VIEWER_ROLES_TTL_MS = 10 * 60 * 1000;

/** Query parameters the callback adds to the page URL it returns to. */
export const VIEWER_RETURN_PARAMS = {
  code: "viewer_code",
  error: "viewer_auth_error",
} as const;

/** Why a sign-in did not finish, as the page receives it. The page maps each code to its own text. */
export type ViewerAuthErrorCode =
  | "access_denied"
  | "missing_params"
  | "token_exchange_failed"
  | "profile_fetch_failed"
  | "rate_limited";

/** Why a handoff exchange was refused. */
export type ViewerHandoffRefusal = "handoff_invalid" | "handoff_expired" | "nonce_mismatch";

/** Platforms a viewer can sign in with. Each has a client in lib/viewerPlatforms.ts. */
export const VIEWER_PLATFORMS = ["twitch"] as const;
export type ViewerPlatform = (typeof VIEWER_PLATFORMS)[number];
export const viewerPlatformValidator = v.literal("twitch");

export function isViewerPlatform(value: unknown): value is ViewerPlatform {
  return typeof value === "string" && (VIEWER_PLATFORMS as readonly string[]).includes(value);
}

/** Platform-neutral subscriber tier; null means not subscribed. */
export type SubscriberTier = 1 | 2 | 3;
export const subscriberTierValidator = v.union(v.literal(1), v.literal(2), v.literal(3), v.null());

export interface ViewerRoles {
  follower: boolean;
  subscriberTier: SubscriberTier | null;
  /** Milliseconds since the epoch. */
  checkedAt: number;
}

export interface ViewerReturnTarget {
  /** A bare origin from the allowlist, such as `https://woofx3.tv`. */
  origin: string;
  /** A same-site path with its query, clamped by `safeRelativePath`. */
  path: string;
}

/**
 * The origins a sign-in may return to. Today only the public user-pages
 * origin; verified custom domains join this list once they exist.
 */
export function allowedReturnOrigins(userPagesBaseUrl: string | undefined): string[] {
  if (!userPagesBaseUrl) {
    throw new Error("USER_PAGES_BASE_URL is not set");
  }
  const origin = new URL(userPagesBaseUrl).origin;
  if (!origin.startsWith("https://") && !origin.startsWith("http://localhost")) {
    throw new Error(`USER_PAGES_BASE_URL must be https (or localhost), got ${origin}`);
  }
  return [origin];
}

/**
 * Where a sign-in started with `returnTo` may send the browser back to, or
 * null when it may not: not an absolute URL, credentials in it, or an origin
 * off the allowlist. Only the origin is compared; the path is clamped so it
 * cannot climb out of that origin.
 */
export function viewerReturnTarget(
  returnTo: string | null | undefined,
  allowedOrigins: readonly string[]
): ViewerReturnTarget | null {
  if (typeof returnTo !== "string" || returnTo.length === 0) {
    return null;
  }
  let url: URL;
  try {
    url = new URL(returnTo);
  } catch {
    return null;
  }
  if (url.username !== "" || url.password !== "" || !allowedOrigins.includes(url.origin)) {
    return null;
  }
  return { origin: url.origin, path: safeRelativePath(`${url.pathname}${url.search}`) };
}

/** The page URL a callback redirects to, carrying either a handoff code or an error code. */
export function viewerReturnUrl(
  target: ViewerReturnTarget,
  result: { code: string } | { error: ViewerAuthErrorCode }
): string {
  const url = new URL(target.path, target.origin);
  url.searchParams.delete(VIEWER_RETURN_PARAMS.code);
  url.searchParams.delete(VIEWER_RETURN_PARAMS.error);
  if ("code" in result) {
    url.searchParams.set(VIEWER_RETURN_PARAMS.code, result.code);
  } else {
    url.searchParams.set(VIEWER_RETURN_PARAMS.error, result.error);
  }
  return url.toString();
}

/** Whether a consumed login state row may still finish its sign-in. */
export function viewerLoginStateUsable(row: { createdAt: number } | null, now: number): boolean {
  return row !== null && now - row.createdAt <= VIEWER_LOGIN_STATE_TTL_MS;
}

/**
 * Why a consumed handoff must not become a session, or null when it may. The
 * row is deleted either way, so a code is never tried twice.
 */
export function viewerHandoffRefusal(
  row: { createdAt: number; nonceHash: string } | null,
  presentedNonceHash: string,
  now: number
): ViewerHandoffRefusal | null {
  if (row === null) {
    return "handoff_invalid";
  }
  if (now - row.createdAt > VIEWER_HANDOFF_TTL_MS) {
    return "handoff_expired";
  }
  if (!signInNonceMatches(row.nonceHash, presentedNonceHash)) {
    return "nonce_mismatch";
  }
  return null;
}

/** Whether a session row still signs its viewer in. */
export function viewerSessionLive(row: { expiresAt: number } | null, now: number): boolean {
  return row !== null && now < row.expiresAt;
}

/** Whether cached roles are recent enough to use without asking the platform again. */
export function viewerRolesFresh(roles: { checkedAt: number } | null, now: number): boolean {
  return roles !== null && now - roles.checkedAt < VIEWER_ROLES_TTL_MS;
}
