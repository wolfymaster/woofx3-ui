import { api } from "@convex/_generated/api";
import { oauthErrorMessage } from "@convex/lib/oauthErrors";
import { safeRelativePath } from "@convex/lib/safeRedirect";
import { useAuthActions } from "@convex-dev/auth/react";
import { useAction, useConvexAuth } from "convex/react";
import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { takeTwitchSignInNonce } from "@/lib/twitch-sign-in";

/**
 * What the Convex Twitch callback handed this page, read once on mount. The
 * one-time `token` and `code` are then dropped from the address bar so they
 * do not stay in history.
 */
function readCallbackParams() {
  const params = new URLSearchParams(window.location.search);
  return {
    mode: params.get("mode") === "connect" ? ("connect" as const) : ("login" as const),
    // Only ever a code: the text shown for it is fixed (lib/oauthErrors.ts),
    // because anyone can put anything in this query string.
    errorCode: params.get("error"),
    token: params.get("token"),
    connectCode: params.get("code"),
    // Anything but a path on this site is dropped: this page navigates to it.
    redirectTo: safeRelativePath(params.get("redirect_to")),
  };
}

/** `detail` is text from our own server's response, never from the URL. */
type Failure = { code: string; detail?: string };

export default function TwitchCallback() {
  const [, navigate] = useLocation();
  const { signIn } = useAuthActions();
  const finishConnect = useAction(api.twitchIntegration.finishConnect);
  const { isAuthenticated, isLoading } = useConvexAuth();
  const [callback] = useState(readCallbackParams);
  const called = useRef(false);
  const [failure, setFailure] = useState<Failure | null>(() =>
    callback.errorCode === null ? null : { code: callback.errorCode }
  );
  const [message, setMessage] = useState("Processing...");

  useEffect(() => {
    if (callback.token !== null || callback.connectCode !== null) {
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, [callback]);

  useEffect(() => {
    if (isLoading || failure || callback.mode !== "connect" || called.current) {
      return;
    }
    called.current = true;
    if (!callback.connectCode) {
      setFailure({ code: "connect_code_invalid" });
      return;
    }
    if (!isAuthenticated) {
      setFailure({ code: "not_signed_in" });
      return;
    }
    setMessage("Finishing the Twitch connection...");
    finishConnect({ code: callback.connectCode })
      .then((result) => {
        if (!result.ok) {
          setFailure({ code: result.error, detail: result.detail });
          return;
        }
        setMessage("Twitch connected successfully! Redirecting...");
        window.location.href = safeRelativePath(result.redirectTo);
      })
      .catch((err: unknown) => {
        console.error("[twitch-callback] finishConnect failed:", String(err));
        setFailure({ code: "unexpected" });
      });
  }, [callback, failure, finishConnect, isAuthenticated, isLoading]);

  useEffect(() => {
    if (isLoading || failure || callback.mode !== "login") {
      return;
    }
    if (isAuthenticated) {
      navigate(callback.redirectTo);
      return;
    }
    if (called.current) {
      return;
    }
    called.current = true;

    const token = callback.token;
    if (!token) {
      setFailure({ code: "missing_params" });
      return;
    }
    const nonce = takeTwitchSignInNonce();
    if (!nonce) {
      setFailure({ code: "sign_in_not_started_here" });
      return;
    }

    // Set when this effect is cleaned up (its dependencies changed, or the
    // page unmounted). It stops further retries only: the effect does not run
    // the sign-in again (`called`), so the outcome of the request already in
    // flight is always reported, or the page would spin forever.
    let stopRetrying = false;

    const attempt = (retriesLeft: number) => {
      // The server consumes the pending sign-in on the first attempt that
      // reaches it, so a retry helps only when the connection dropped before
      // the request was delivered.
      signIn("twitch", { token, nonce })
        .then((result) => {
          if (result.signingIn) {
            window.location.href = callback.redirectTo;
          } else {
            setFailure({ code: "sign_in_failed" });
          }
        })
        .catch((err: unknown) => {
          const msg = String(err);
          console.error("[twitch-callback] signIn error:", msg);
          if (msg.includes("Connection lost") && retriesLeft > 0 && !stopRetrying) {
            setTimeout(() => {
              if (stopRetrying) {
                setFailure({ code: "sign_in_failed" });
                return;
              }
              attempt(retriesLeft - 1);
            }, 1500);
          } else {
            setFailure({ code: "sign_in_failed" });
          }
        });
    };

    attempt(3);

    return () => {
      stopRetrying = true;
    };
  }, [callback, signIn, isLoading, isAuthenticated, navigate, failure]);

  if (failure) {
    const back = callback.mode === "connect" ? callback.redirectTo : "/auth/login";
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4 p-4">
        <p className="text-destructive text-sm max-w-md text-center">
          {failure.detail ?? oauthErrorMessage(failure.code, "Twitch")}
        </p>
        <a href={back} className="text-sm underline">
          Back
        </a>
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
