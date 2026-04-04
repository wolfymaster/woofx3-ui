import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth } from "convex/react";
import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";

export default function TwitchCallback() {
  const [, navigate] = useLocation();
  const { signIn } = useAuthActions();
  const { isAuthenticated, isLoading } = useConvexAuth();
  const called = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const redirectTo = useRef(new URLSearchParams(window.location.search).get("redirect_to") ?? "/");

  // If already authenticated (e.g. page refreshed), skip sign-in and navigate
  useEffect(() => {
    if (isAuthenticated) {
      navigate(redirectTo.current);
    }
  }, [isAuthenticated, navigate]);

  // Wait for Convex to finish its initial connection before calling signIn.
  // After signIn succeeds, hard-navigate so the page reloads with the JWT
  // that was just written to localStorage — this ensures the standard
  // readStateFromStorage path confirms auth cleanly.
  useEffect(() => {
    if (isLoading) {
      return;
    }
    if (isAuthenticated) {
      return;
    }
    if (called.current) {
      return;
    }

    called.current = true;

    const token = new URLSearchParams(window.location.search).get("token");

    if (!token) {
      setError("No token in callback URL");
      return;
    }

    let cancelled = false;

    const attempt = (retriesLeft: number) => {
      if (cancelled) {
        return;
      }

      signIn("twitch", { token })
        .then((result) => {
          if (cancelled) {
            return;
          }
          cancelled = true;
          if (result.signingIn) {
            // JWT and refresh token are now in localStorage.
            // Hard-navigate so the page reloads with a clean Convex connection
            // and auth is confirmed via the standard page-load flow.
            window.location.href = redirectTo.current;
          } else {
            setError("Sign-in did not complete — please try again");
          }
        })
        .catch((err: unknown) => {
          if (cancelled) {
            return;
          }
          const msg = String(err);
          console.error("[twitch-callback] signIn error:", msg);
          if (msg.includes("Connection lost") && retriesLeft > 0) {
            console.log("[twitch-callback] WebSocket dropped, retrying in 1.5s...");
            setTimeout(() => {
              attempt(retriesLeft - 1);
            }, 1500);
          } else {
            setError(msg);
          }
        });
    };

    attempt(3);

    return () => {
      cancelled = true;
    };
  }, [signIn, isLoading, isAuthenticated]);

  if (error) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <pre className="text-destructive text-sm whitespace-pre-wrap">{error}</pre>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
    </div>
  );
}
