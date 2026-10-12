import { useConvexAuth } from "convex/react";
import { useEffect, useState } from "react";
import { useLocation } from "wouter";

/**
 * Navigate to a page behind AuthGuard once a sign-in has taken effect.
 *
 * `signIn` resolves when the auth client holds the new token, but Convex
 * accepts it a round trip later, and in between useConvexAuth reports signed
 * out and not loading. AuthGuard would read that as signed out and send the
 * user back to the sign-in form, so the navigation waits for Convex.
 */
export function useNavigateAfterSignIn(): (path: string) => void {
  const { isAuthenticated } = useConvexAuth();
  const [, navigate] = useLocation();
  const [pendingPath, setPendingPath] = useState<string | null>(null);

  useEffect(() => {
    if (pendingPath !== null && isAuthenticated) {
      navigate(pendingPath);
    }
  }, [pendingPath, isAuthenticated, navigate]);

  return setPendingPath;
}
