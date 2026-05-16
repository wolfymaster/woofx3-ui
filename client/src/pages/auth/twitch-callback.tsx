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
  const [message, setMessage] = useState("Processing...");
  const redirectTo = useRef(new URLSearchParams(window.location.search).get("redirect_to") ?? "/");
  const mode = useRef(new URLSearchParams(window.location.search).get("mode") ?? "login");

  useEffect(() => {
    if (isLoading) {
      return;
    }
    if (mode.current === "connect") {
      setMessage("Twitch connected successfully! Redirecting...");
      const timer = setTimeout(() => {
        window.location.href = redirectTo.current;
      }, 1500);
      return () => clearTimeout(timer);
    }
    if (isAuthenticated) {
      navigate(redirectTo.current);
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
  }, [signIn, isLoading, isAuthenticated, navigate]);

  if (error) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <pre className="text-destructive text-sm whitespace-pre-wrap">{error}</pre>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="text-center">
        <Loader2 className="h-8 w-8 mx-auto animate-spin text-muted-foreground mb-4" />
        <p className="text-sm text-muted-foreground">{message}</p>
      </div>
    </div>
  );
}
