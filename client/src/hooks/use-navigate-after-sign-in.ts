import { useConvexAuth } from "convex/react";
import { useEffect, useState } from "react";
import { useLocation } from "wouter";

/** How long Convex may take to accept a token the auth client already holds before the page reloads into it. */
export const AFTER_SIGN_IN = { settleTimeoutMs: 15_000 } as const;

export type AfterSignInStep = "idle" | "wait" | "navigate" | "reload";

/**
 * What to do once a sign-in has produced a token. Convex accepting it is what makes the destination's guard let
 * the person in; if that does not happen in time, a full load of the destination starts from the stored token
 * instead of leaving the form spinning.
 */
export function afterSignInStep(
  pendingPath: string | null,
  isAuthenticated: boolean,
  timedOut: boolean
): AfterSignInStep {
  if (pendingPath === null) {
    return "idle";
  }
  if (isAuthenticated) {
    return "navigate";
  }
  return timedOut ? "reload" : "wait";
}

/**
 * Navigate to a page behind AuthGuard once a sign-in has taken effect.
 *
 * `signIn` resolves when the auth client holds the new token, but Convex
 * accepts it a round trip later, and in between useConvexAuth reports signed
 * out and not loading. AuthGuard would read that as signed out and send the
 * user back to the sign-in form, so the navigation waits for Convex, for at
 * most `AFTER_SIGN_IN.settleTimeoutMs`.
 */
export function useNavigateAfterSignIn(): (path: string) => void {
  const { isAuthenticated } = useConvexAuth();
  const [, navigate] = useLocation();
  const [pendingPath, setPendingPath] = useState<string | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const step = afterSignInStep(pendingPath, isAuthenticated, timedOut);

  useEffect(() => {
    if (step !== "wait") {
      return;
    }
    const timer = setTimeout(() => setTimedOut(true), AFTER_SIGN_IN.settleTimeoutMs);
    return () => clearTimeout(timer);
  }, [step]);

  useEffect(() => {
    if (step === "navigate" && pendingPath !== null) {
      navigate(pendingPath);
    }
    if (step === "reload" && pendingPath !== null) {
      window.location.assign(pendingPath);
    }
  }, [step, pendingPath, navigate]);

  return setPendingPath;
}
