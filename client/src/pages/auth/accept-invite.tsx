import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useConvexAuth } from "convex/react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, MonitorPlay } from "lucide-react";

function getTokenFromLocation(): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  return new URLSearchParams(window.location.search).get("token");
}

export default function AcceptInvite() {
  const [, navigate] = useLocation();
  const { isAuthenticated, isLoading: authLoading } = useConvexAuth();
  const accept = useMutation(api.invitations.accept);

  const [status, setStatus] = useState<"idle" | "working" | "done" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const ranAccept = useRef(false);

  const runAccept = useCallback(async () => {
    const token = getTokenFromLocation();
    if (!token) {
      setStatus("error");
      setMessage("Missing invitation token. Use the full link from your invite.");
      return;
    }
    setStatus("working");
    setMessage(null);
    try {
      await accept({ token });
      setStatus("done");
      setMessage("You have joined the team. Redirecting…");
      setTimeout(() => navigate("/"), 1500);
    } catch (e: unknown) {
      setStatus("error");
      setMessage(e instanceof Error ? e.message : "Could not accept invitation.");
    }
  }, [accept, navigate]);

  useEffect(() => {
    if (authLoading) {
      return;
    }
    if (!isAuthenticated) {
      const token = getTokenFromLocation();
      const next = token ? `/auth/login?next=${encodeURIComponent(`/auth/accept-invite?token=${token}`)}` : "/auth/login";
      navigate(next);
      return;
    }
    if (ranAccept.current) {
      return;
    }
    ranAccept.current = true;
    void runAccept();
  }, [authLoading, isAuthenticated, navigate, runAccept]);

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
