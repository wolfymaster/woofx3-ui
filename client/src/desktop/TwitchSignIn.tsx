import { api } from "@convex/_generated/api";
import { oauthErrorMessage } from "@convex/lib/oauthErrors";
import { useAuthActions } from "@convex-dev/auth/react";
import { useMutation } from "convex/react";
import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { TwitchGlyph } from "@/components/twitch/twitch-glyph";
import { Button } from "@/components/ui/button";
import { useNavigateAfterSignIn } from "@/hooks/use-navigate-after-sign-in";
import type { Cancel } from "@/lib/engine-session/deps";
import { consoleLogger, systemClock } from "@/lib/engine-session/system";
import { openTwitchSignIn } from "./host";
import { type DesktopSignInEnd, startDesktopTwitchSignIn } from "./twitch-sign-in";

const logger = consoleLogger("desktop-twitch-sign-in");

type Phase = { kind: "idle"; error: string | null } | { kind: "waiting" } | { kind: "signing_in" };

function endMessage(end: Exclude<DesktopSignInEnd, { kind: "signed_in" }>): string {
  switch (end.kind) {
    case "failed": {
      return oauthErrorMessage(end.error, "Twitch");
    }
    case "timed_out": {
      return "The Twitch sign-in took too long. Please start again.";
    }
    case "browser_not_opened": {
      return `woofx3 could not open your browser: ${end.reason}`;
    }
  }
}

/**
 * "Continue with Twitch" for the desktop app's login and register pages. The
 * sign-in happens in the system browser; this waits for it, with a way to
 * give up, and signs the window in once it has finished.
 */
export default function DesktopTwitchSignIn({ nextPath }: { nextPath: string }) {
  const { signIn } = useAuthActions();
  const claim = useMutation(api.twitchAuth.claimDesktopSignIn);
  const navigateAfterSignIn = useNavigateAfterSignIn();
  const [phase, setPhase] = useState<Phase>({ kind: "idle", error: null });
  const cancelWait = useRef<Cancel | null>(null);

  useEffect(
    () => () => {
      cancelWait.current?.();
      cancelWait.current = null;
    },
    []
  );

  function start() {
    cancelWait.current?.();
    setPhase({ kind: "waiting" });
    cancelWait.current = startDesktopTwitchSignIn(
      {
        clock: systemClock,
        logger,
        openBrowser: openTwitchSignIn,
        claim: (nonce) => claim({ nonce }),
        signIn: async (token, nonce) => (await signIn("twitch", { token, nonce })).signingIn,
      },
      (end) => {
        cancelWait.current = null;
        if (end.kind === "signed_in") {
          setPhase({ kind: "signing_in" });
          navigateAfterSignIn(nextPath);
          return;
        }
        setPhase({ kind: "idle", error: endMessage(end) });
      }
    );
  }

  function cancel() {
    cancelWait.current?.();
    cancelWait.current = null;
    setPhase({ kind: "idle", error: null });
  }

  if (phase.kind === "signing_in") {
    return (
      <div className="flex items-center justify-center gap-2 py-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Signing in...
      </div>
    );
  }

  if (phase.kind === "waiting") {
    return (
      <div className="rounded-md border p-4 space-y-3 text-center" data-testid="twitch-sign-in-waiting">
        <div className="flex items-center justify-center gap-2 text-sm font-medium">
          <Loader2 className="h-4 w-4 animate-spin" />
          Waiting for Twitch
        </div>
        <p className="text-sm text-muted-foreground">
          Finish signing in with Twitch in your browser, then come back here. This window signs in by itself.
        </p>
        <Button variant="ghost" size="sm" onClick={cancel} data-testid="button-twitch-sign-in-cancel">
          Cancel
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Button variant="outline" className="w-full" onClick={start} data-testid="button-twitch-sign-in">
        <TwitchGlyph className="mr-2" />
        Continue with Twitch
      </Button>
      {phase.error && (
        <p className="text-sm text-destructive" role="alert">
          {phase.error}
        </p>
      )}
    </div>
  );
}
