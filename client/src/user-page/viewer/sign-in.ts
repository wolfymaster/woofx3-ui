import type { VIEWER_RETURN_PARAMS, ViewerAuthErrorCode, ViewerPlatform } from "@convex/lib/viewerAuth";
import type { ExchangeHandoffResult } from "@convex/viewerSession";

/**
 * The page's half of viewer sign-in (docs/ui/viewer-sign-in.md): build the
 * start URL, read what the callback put on the page URL, and say what went
 * wrong in words a viewer understands. Kept free of React and of the browser
 * globals so each step can be tested on its own.
 */

/** Must match VIEWER_RETURN_PARAMS in convex/lib/viewerAuth.ts; the type holds it to that. */
export const SIGN_IN_RETURN_PARAMS: typeof VIEWER_RETURN_PARAMS = {
  code: "viewer_code",
  error: "viewer_auth_error",
};

/** The only platform a viewer can sign in with today. */
export const SIGN_IN_PLATFORM: ViewerPlatform = "twitch";

/**
 * Where a sign-in starts: the edge route on the user-pages origin, which
 * limits starts per address before Convex sees them. Never the Convex site,
 * whose start route refuses requests that did not come through the edge.
 * `pageBase` is the page build's base ("/u/"); `_` can never be a slug.
 */
export function signInStartUrl(origin: string, pageBase: string, returnTo: string, nonce: string): string {
  const url = new URL(`${pageBase}_/viewer-auth/${SIGN_IN_PLATFORM}/start`, origin);
  url.searchParams.set("return_to", returnTo);
  url.searchParams.set("nonce", nonce);
  return url.toString();
}

/** The canonical address of the page for `slug` on the user-pages origin. */
export function canonicalPageUrl(origin: string, pageBase: string, slug: string): string {
  return new URL(`${pageBase}${encodeURIComponent(slug)}`, origin).toString();
}

/** What the sign-in callback left on the page URL. */
export type SignInReturn =
  | { kind: "none" }
  | { kind: "code"; code: string }
  /** `code` is null when the error is not one the callback sends. */
  | { kind: "error"; code: ViewerAuthErrorCode | null };

const AUTH_ERROR_CODES: readonly ViewerAuthErrorCode[] = [
  "access_denied",
  "missing_params",
  "token_exchange_failed",
  "profile_fetch_failed",
  "rate_limited",
];

function isAuthErrorCode(value: string): value is ViewerAuthErrorCode {
  return (AUTH_ERROR_CODES as readonly string[]).includes(value);
}

/**
 * The sign-in result on `href`, and `href` without it, so the one-time code
 * does not stay in the address bar, the history or a shared link. An error
 * wins over a code if both are present, since nothing should be redeemed
 * from a URL that also says the sign-in failed.
 */
export function readSignInReturn(href: string): { signInReturn: SignInReturn; cleanHref: string } {
  const url = new URL(href);
  const code = url.searchParams.get(SIGN_IN_RETURN_PARAMS.code);
  const error = url.searchParams.get(SIGN_IN_RETURN_PARAMS.error);
  url.searchParams.delete(SIGN_IN_RETURN_PARAMS.code);
  url.searchParams.delete(SIGN_IN_RETURN_PARAMS.error);
  const cleanHref = url.toString();
  if (error !== null) {
    return { signInReturn: { kind: "error", code: isAuthErrorCode(error) ? error : null }, cleanHref };
  }
  if (code !== null && code !== "") {
    return { signInReturn: { kind: "code", code }, cleanHref };
  }
  return { signInReturn: { kind: "none" }, cleanHref };
}

/** Every way a sign-in can fail, from the callback, the handoff exchange or the page itself. */
export type SignInFailure =
  | ViewerAuthErrorCode
  | Extract<ExchangeHandoffResult, { ok: false }>["error"]
  /** The page came back with a code but holds no nonce: another tab or browser started it. */
  | "nonce_missing"
  /** The callback sent an error this page does not know. */
  | "unknown"
  /** The exchange could not reach Convex. */
  | "exchange_failed";

const SIGN_IN_FAILURE_MESSAGES: Record<SignInFailure, string> = {
  access_denied: "Sign-in was cancelled on Twitch.",
  missing_params: "Twitch didn't finish the sign-in. Try again.",
  token_exchange_failed: "Twitch didn't accept the sign-in. Try again.",
  profile_fetch_failed: "We couldn't read your Twitch profile. Try again.",
  rate_limited: "Too many sign-ins from your network just now. Wait a minute, then try again.",
  handoff_invalid: "That sign-in was already used. Sign in again.",
  handoff_expired: "The sign-in took too long to finish. Sign in again.",
  nonce_mismatch: "Sign-in has to finish in the tab it started in. Sign in again here.",
  nonce_missing: "Sign-in has to finish in the tab it started in. Sign in again here.",
  unknown: "Sign-in didn't finish. Try again.",
  exchange_failed: "We couldn't finish signing you in. Check your connection and try again.",
};

export function signInFailureMessage(failure: SignInFailure): string {
  return SIGN_IN_FAILURE_MESSAGES[failure];
}

/** Where the page keeps sign-in state: the nonce for one tab, the session token for the origin. */
export interface ViewerStorage {
  /** Returns the nonce and forgets it, so a code is never redeemed with it twice. */
  takeNonce(): string | null;
  putNonce(nonce: string): void;
  sessionToken(): string | null;
  putSessionToken(token: string): void;
  clearSessionToken(): void;
}

export type SignInOutcome = { kind: "signed_in"; sessionToken: string } | { kind: "failed"; failure: SignInFailure };

/**
 * Finishes the sign-in `signInReturn` describes: redeems the code with the
 * nonce this tab kept and stores the session token. Null when the page URL
 * carried no sign-in.
 */
export async function finishSignIn(
  signInReturn: SignInReturn,
  storage: ViewerStorage,
  exchange: (args: { code: string; nonce: string }) => Promise<ExchangeHandoffResult>
): Promise<SignInOutcome | null> {
  if (signInReturn.kind === "none") {
    return null;
  }
  const nonce = storage.takeNonce();
  if (signInReturn.kind === "error") {
    return { kind: "failed", failure: signInReturn.code ?? "unknown" };
  }
  if (nonce === null) {
    return { kind: "failed", failure: "nonce_missing" };
  }
  let result: ExchangeHandoffResult;
  try {
    result = await exchange({ code: signInReturn.code, nonce });
  } catch (error: unknown) {
    console.warn("Could not exchange the viewer sign-in code", error);
    return { kind: "failed", failure: "exchange_failed" };
  }
  if (!result.ok) {
    return { kind: "failed", failure: result.error };
  }
  storage.putSessionToken(result.sessionToken);
  return { kind: "signed_in", sessionToken: result.sessionToken };
}

const NONCE_KEY = "woofx3.viewerSignInNonce";
const SESSION_TOKEN_KEY = "woofx3.viewerSession";

/**
 * Browser storage for sign-in: the nonce in sessionStorage, so only the tab
 * that started a sign-in can finish it, and the session token in
 * localStorage, which the browser already keeps per origin. Storage can be
 * blocked (private modes, site settings); the page then behaves as signed
 * out, which is the only safe reading of a store it cannot use.
 */
export function browserViewerStorage(session: Storage | null, local: Storage | null): ViewerStorage {
  const read = (store: Storage | null, key: string): string | null => {
    try {
      return store?.getItem(key) ?? null;
    } catch (error: unknown) {
      console.warn(`Could not read ${key}; treating it as unset`, error);
      return null;
    }
  };
  const write = (store: Storage | null, key: string, value: string | null): void => {
    try {
      if (value === null) {
        store?.removeItem(key);
      } else {
        store?.setItem(key, value);
      }
    } catch (error: unknown) {
      console.warn(`Could not write ${key}; sign-in will not survive a reload`, error);
    }
  };
  return {
    takeNonce: () => {
      const nonce = read(session, NONCE_KEY);
      write(session, NONCE_KEY, null);
      return nonce;
    },
    putNonce: (nonce) => write(session, NONCE_KEY, nonce),
    sessionToken: () => read(local, SESSION_TOKEN_KEY),
    putSessionToken: (token) => write(local, SESSION_TOKEN_KEY, token),
    clearSessionToken: () => write(local, SESSION_TOKEN_KEY, null),
  };
}
