import { useConvexAuth } from "convex/react";
import { useEffect } from "react";
import { IS_DESKTOP } from "@/lib/desktop";
import { writeSessionHint } from "@/lib/session-hint";

/** Keeps the marketing site's "View Dashboard" hint in step with this browser's sign-in. Renders nothing. */
export function SessionHint() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  useEffect(() => {
    if (!IS_DESKTOP && !isLoading) {
      writeSessionHint(isAuthenticated);
    }
  }, [isAuthenticated, isLoading]);
  return null;
}
