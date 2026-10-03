import { api } from "@convex/_generated/api";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { Loader2, MonitorPlay } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { TwitchUserCard } from "@/components/twitch/twitch-user-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { $currentInstanceId } from "@/lib/stores";
import { startTwitchSignIn, TWITCH_SIGN_IN_STORAGE_ERROR } from "@/lib/twitch-sign-in";

function getTokenFromLocation(): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  return new URLSearchParams(window.location.search).get("token");
}

/** Starts Twitch sign-in back to this invitation; false when it could not start. */
function signInWithTwitch(token: string | null): boolean {
  const back = token ? `/auth/accept-invite?token=${encodeURIComponent(token)}` : "/";
  try {
    startTwitchSignIn(back);
    return true;
  } catch {
    return false;
  }
}

export default function AcceptInvite() {
  const [, navigate] = useLocation();
  const { isAuthenticated, isLoading: authLoading } = useConvexAuth();
  const accept = useMutation(api.invitations.accept);
  const token = getTokenFromLocation();
  const preview = useQuery(api.invitations.previewByToken, token ? { token } : "skip");
  const twitchTarget = preview?.target.kind === "twitch" ? preview.target : null;

  const [status, setStatus] = useState<"idle" | "working" | "done" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const ranAccept = useRef(false);

  const runAccept = useCallback(async () => {
    if (!token) {
      setStatus("error");
      setMessage("Missing invitation token. Use the full link from your invite.");
      return;
    }
    setStatus("working");
    setMessage(null);
    try {
      const { instanceId } = await accept({ token });
      // Open the account they were invited to, not whichever instance they had
      // selected before (their own, if they have one).
      if (instanceId) {
        $currentInstanceId.set(instanceId);
      }
      setStatus("done");
      setMessage("You have joined the team. Redirecting…");
      setTimeout(() => navigate("/"), 1500);
    } catch (e: unknown) {
      setStatus("error");
      setMessage(e instanceof Error ? e.message : "Could not accept invitation.");
    }
  }, [accept, navigate, token]);

  useEffect(() => {
    if (authLoading) {
      return;
    }
    if (!isAuthenticated) {
      // A Twitch invite stays here to show whose account to sign in with, and
      // offers that sign-in itself; anything else goes to the general login.
      if (token && preview === undefined) {
        return;
      }
      if (preview?.target.kind === "twitch") {
        return;
      }
      const next = token
        ? `/auth/login?next=${encodeURIComponent(`/auth/accept-invite?token=${token}`)}`
        : "/auth/login";
      navigate(next);
      return;
    }
    if (ranAccept.current) {
      return;
    }
    ranAccept.current = true;
    void runAccept();
  }, [authLoading, isAuthenticated, navigate, runAccept, token, preview]);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-primary text-primary-foreground">
              <MonitorPlay className="h-5 w-5" />
            </div>
            <div>
              <CardTitle>Accept invitation</CardTitle>
              <CardDescription>Join a shared woofx3 workspace.</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {authLoading || status === "working" ? (
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Loader2 className="h-4 w-4 animate-spin" />
              Processing…
            </div>
          ) : null}
          {twitchTarget && (!isAuthenticated || status === "error") ? (
            <div className="space-y-2">
              <p className="text-sm">
                {preview?.accountName ? `This invitation to ${preview.accountName} is for` : "This invitation is for"}{" "}
                this Twitch account. Sign in with it to join.
              </p>
              <TwitchUserCard
                user={{
                  login: twitchTarget.login ?? "",
                  displayName: twitchTarget.displayName ?? twitchTarget.login ?? "Twitch user",
                  profileImageUrl: twitchTarget.profileImageUrl ?? undefined,
                }}
                data-testid="card-invite-twitch-account"
              >
                {!isAuthenticated ? (
                  <Button
                    className="w-full"
                    onClick={() => {
                      if (!signInWithTwitch(token)) {
                        setMessage(TWITCH_SIGN_IN_STORAGE_ERROR);
                      }
                    }}
                    data-testid="button-invite-twitch-sign-in"
                  >
                    Continue with Twitch
                  </Button>
                ) : null}
              </TwitchUserCard>
            </div>
          ) : null}
          {message ? <p className="text-sm">{message}</p> : null}
          {status === "error" ? (
            <Button variant="outline" onClick={() => navigate("/")}>
              Back to app
            </Button>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
