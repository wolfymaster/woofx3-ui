import type { OAuthErrorCode } from "@convex/lib/oauthErrors";
import { generateOpaqueToken, hashOpaqueToken } from "@convex/lib/oauthHandoff";
import { type DesktopSignInClaim, TWITCH_SIGN_IN_STATE_TTL_MS } from "@convex/lib/twitchSignIn";
import type { Cancel, Clock, Logger } from "@/lib/engine-session/deps";

/**
 * Twitch sign-in for the desktop app. The system browser does the Twitch
 * part, since the window cannot follow it there; the app keeps the nonce in
 * memory, hands the browser only its hash, and asks Convex with the nonce how
 * the sign-in ended (convex/lib/twitchSignIn.ts).
 */

/** How often Convex is asked whether the sign-in in the browser has ended. Each ask is one indexed mutation. */
export const DESKTOP_SIGN_IN_POLL_MS = 2000;

/**
 * How long the app waits. Convex drops a started sign-in's state after
 * `TWITCH_SIGN_IN_STATE_TTL_MS`, after which Twitch's answer can no longer
 * finish it, so no outcome appears later than that, plus one ask to collect it.
 */
export const DESKTOP_SIGN_IN_TIME_LIMIT_MS = TWITCH_SIGN_IN_STATE_TTL_MS + DESKTOP_SIGN_IN_POLL_MS;

export type DesktopSignInEnd =
  | { kind: "signed_in" }
  | { kind: "failed"; error: OAuthErrorCode }
  | { kind: "timed_out" }
  | { kind: "browser_not_opened"; reason: string };

export interface DesktopSignInDeps {
  clock: Clock;
  logger: Logger;
  /** Opens the system browser at Convex's start route for the nonce behind `nonceHash`. */
  openBrowser(nonceHash: string): Promise<void>;
  claim(nonce: string): Promise<DesktopSignInClaim>;
  /** Resolves true when Convex Auth accepted the sign-in. */
  signIn(token: string, nonce: string): Promise<boolean>;
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Starts a sign-in in the system browser and waits for it to end, calling
 * `onEnd` once, unless the returned cancel runs first. A cancel after the
 * outcome was claimed leaves the sign-in unfinished; its token then expires
 * unused.
 */
export function startDesktopTwitchSignIn(deps: DesktopSignInDeps, onEnd: (end: DesktopSignInEnd) => void): Cancel {
  const nonce = generateOpaqueToken();
  const deadline = deps.clock.now() + DESKTOP_SIGN_IN_TIME_LIMIT_MS;
  let stopped = false;
  let cancelNext: Cancel | null = null;

  const end = (result: DesktopSignInEnd) => {
    if (stopped) {
      return;
    }
    stopped = true;
    onEnd(result);
  };

  const askLater = () => {
    if (stopped) {
      return;
    }
    if (deps.clock.now() >= deadline) {
      end({ kind: "timed_out" });
      return;
    }
    cancelNext = deps.clock.schedule(DESKTOP_SIGN_IN_POLL_MS, ask);
  };

  const finish = (token: string) => {
    deps.signIn(token, nonce).then(
      (accepted) => end(accepted ? { kind: "signed_in" } : { kind: "failed", error: "sign_in_failed" }),
      (error: unknown) => {
        deps.logger.error("Twitch sign-in was not accepted", { reason: reasonOf(error) });
        end({ kind: "failed", error: "sign_in_failed" });
      }
    );
  };

  const settle = (claim: DesktopSignInClaim) => {
    if (stopped) {
      return;
    }
    switch (claim.status) {
      case "pending": {
        askLater();
        return;
      }
      case "expired": {
        end({ kind: "timed_out" });
        return;
      }
      case "failed": {
        end({ kind: "failed", error: claim.error });
        return;
      }
      case "signed_in": {
        finish(claim.token);
        return;
      }
    }
  };

  const ask = () => {
    cancelNext = null;
    deps.claim(nonce).then(settle, (error: unknown) => {
      // Most often the connection dropped; the outcome waits in Convex, so ask again.
      deps.logger.warn("could not ask how the Twitch sign-in ended", { reason: reasonOf(error) });
      askLater();
    });
  };

  hashOpaqueToken(nonce)
    .then((nonceHash) => deps.openBrowser(nonceHash))
    .then(askLater, (error: unknown) => end({ kind: "browser_not_opened", reason: reasonOf(error) }));

  return () => {
    stopped = true;
    cancelNext?.();
    cancelNext = null;
  };
}
