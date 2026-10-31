import { oauthErrorMessage } from "@convex/lib/oauthErrors";
import { CheckCircle2, XCircle } from "lucide-react";
import { useState } from "react";

/**
 * Where the system browser lands after a desktop app's Twitch sign-in. The
 * app finishes the sign-in itself, so this page only says to go back to it.
 * It reads nothing but an error code, shown as fixed text
 * (lib/oauthErrors.ts) because anyone can put anything in this query string.
 */
function readErrorCode(): string | null {
  return new URLSearchParams(window.location.search).get("error");
}

export default function TwitchDesktopSignIn() {
  const [errorCode] = useState(readErrorCode);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="max-w-md text-center space-y-3">
        {errorCode === null ? (
          <>
            <CheckCircle2 className="h-10 w-10 mx-auto text-primary" />
            <h1 className="text-lg font-semibold">You're signed in with Twitch</h1>
            <p className="text-sm text-muted-foreground">
              Return to the woofx3 app to continue. You can close this tab.
            </p>
          </>
        ) : (
          <>
            <XCircle className="h-10 w-10 mx-auto text-destructive" />
            <h1 className="text-lg font-semibold">Twitch sign-in didn't finish</h1>
            <p className="text-sm text-destructive">{oauthErrorMessage(errorCode, "Twitch")}</p>
            <p className="text-sm text-muted-foreground">Return to the woofx3 app and try again.</p>
          </>
        )}
      </div>
    </div>
  );
}
