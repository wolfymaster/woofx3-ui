import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useStore } from "@nanostores/react";
import { useAction, useMutation as useConvexMutation } from "convex/react";
import { AlertTriangle, CheckCircle2, Loader2, Server, XCircle } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { EngineSyncCard } from "@/components/settings/engine-sync-card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { useInstance } from "@/hooks/use-instance";
import { $engineUrl } from "@/lib/stores";

type ConnectionStatus = "idle" | "testing" | "success" | "error";

function EngineSettings() {
  const { instance, isLoading: instanceLoading } = useInstance();
  const testConnectionAction = useAction(api.engineHealth.testConnection);
  const updateInstance = useConvexMutation(api.instances.update);
  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savingUrl, setSavingUrl] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fallbackUrl = useStore($engineUrl);

  const [urlDraft, setUrlDraft] = useState(fallbackUrl);

  useEffect(() => {
    const next = instance?.url?.trim() || fallbackUrl;
    setUrlDraft(next);
  }, [instance, fallbackUrl]);

  const effectiveUrl = urlDraft.trim();

  const persistEngineUrl = useCallback(async () => {
    setSaveError(null);
    if (!instance) {
      return;
    }
    const trimmed = urlDraft.trim();
    if (!trimmed || trimmed === instance.url.trim()) {
      $engineUrl.set(trimmed);
      return;
    }
    setSavingUrl(true);
    try {
      await updateInstance({ instanceId: instance._id, url: trimmed });
      $engineUrl.set(trimmed);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingUrl(false);
    }
  }, [instance, urlDraft, updateInstance]);

  const handleTestConnection = useCallback(async () => {
    if (!effectiveUrl) {
      setStatus("error");
      setErrorMsg("No engine URL configured");
      return;
    }
    setStatus("testing");
    setErrorMsg(null);

    if (resetTimer.current) {
      clearTimeout(resetTimer.current);
    }

    try {
      const result = await testConnectionAction({ url: effectiveUrl });
      if (result.ok) {
        setStatus("success");
      } else {
        setStatus("error");
        setErrorMsg(result.error ?? "Unknown error");
      }
    } catch (e) {
      setStatus("error");
      setErrorMsg(e instanceof Error ? e.message : String(e));
    }

    resetTimer.current = setTimeout(() => {
      setStatus("idle");
      setErrorMsg(null);
    }, 5000);
  }, [effectiveUrl, testConnectionAction]);

  useEffect(() => {
    return () => {
      if (resetTimer.current) {
        clearTimeout(resetTimer.current);
      }
    };
  }, []);

  if (instanceLoading) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-8 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading instance…
        </CardContent>
      </Card>
    );
  }

  if (!instance) {
    return (
      <Card>
        <CardContent className="py-8 text-sm text-muted-foreground">
          No instance selected. Complete onboarding or pick an instance from the header menu.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Engine Configuration</CardTitle>
          <CardDescription>
            Endpoint for the selected instance ({instance.name}). Each instance has its own engine URL.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-2">
            <Label htmlFor="engine-url">Engine URL</Label>
            <div className="flex flex-wrap gap-2">
              <Input
                id="engine-url"
                placeholder="localhost:8080 or https://api.example.com"
                value={urlDraft}
                onChange={(e) => setUrlDraft(e.target.value)}
                onBlur={() => {
                  void persistEngineUrl();
                }}
                className="flex-1 min-w-[200px]"
                data-testid="input-engine-url"
              />
              <Button
                type="button"
                variant="secondary"
                disabled={savingUrl || !effectiveUrl}
                onClick={() => {
                  void persistEngineUrl();
                }}
                data-testid="button-save-engine-url"
              >
                {savingUrl ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save URL"}
              </Button>
              <Button
                variant="outline"
                onClick={handleTestConnection}
                disabled={!effectiveUrl || status === "testing"}
                data-testid="button-test-connection"
              >
                {status === "testing" && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {status === "success" && <CheckCircle2 className="h-4 w-4 mr-2 text-green-500" />}
                {status === "error" && <XCircle className="h-4 w-4 mr-2 text-destructive" />}
                {status === "idle" && <Server className="h-4 w-4 mr-2" />}
                {status === "testing"
                  ? "Testing..."
                  : status === "success"
                    ? "Connected"
                    : status === "error"
                      ? "Failed"
                      : "Test Connection"}
              </Button>
            </div>
            {saveError && <p className="text-xs text-destructive">{saveError}</p>}
            {status === "error" && errorMsg && <p className="text-xs text-destructive">{errorMsg}</p>}
            {status === "success" && <p className="text-xs text-green-500">Engine is reachable.</p>}
            <p className="text-xs text-muted-foreground">
              The hostname and port (or full URL) where this instance&apos;s backend API is running. If no protocol is
              specified, the current page&apos;s protocol will be used.
            </p>
          </div>
          <Separator />
          <div className="grid gap-2">
            <Label>Registration Status</Label>
            <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/50">
              <div className={`h-2 w-2 rounded-full ${instance?.clientId ? "bg-green-500" : "bg-yellow-500"}`} />
              <p className="text-sm text-muted-foreground">
                {instance?.clientId
                  ? "Registered with engine"
                  : "Not registered — re-run onboarding or register from here."}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/50">
            <div className="h-2 w-2 rounded-full bg-green-500" />
            <p className="text-sm text-muted-foreground">
              Saving the engine URL updates this instance and reconnects the live engine connection.
            </p>
          </div>
        </CardContent>
      </Card>
      <EngineSyncCard instanceId={instance._id} />
      <DangerZone instanceId={instance._id} />
    </div>
  );
}
function DangerZone({ instanceId }: { instanceId: Id<"instances"> }) {
  const deleteInstanceAction = useAction(api.instances.deleteInstance);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleDeleteInstance = async () => {
    setDeleting(true);
    try {
      await deleteInstanceAction({ instanceId });
      window.location.href = "/";
    } catch (e) {
      console.error("Failed to delete instance:", e);
      setDeleting(false);
      setDialogOpen(false);
    }
  };

  return (
    <>
      <Card className="border-destructive/50">
        <CardHeader>
          <CardTitle className="text-destructive">Danger Zone</CardTitle>
          <CardDescription>Irreversible actions for this instance.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="destructive" data-testid="button-delete-instance" onClick={() => setDialogOpen(true)}>
            Delete Instance
          </Button>
        </CardContent>
      </Card>

      <AlertDialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Instance</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this instance? This action is irreversible and will permanently remove all
              data associated with this instance, including workflows, scenes, and assets.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteInstance}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <AlertTriangle className="h-4 w-4 mr-2" />
              )}
              Delete Instance
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export default function AdminEngine() {
  return (
    <div className="container mx-auto p-6">
      <PageHeader title="Engine" description="Where this instance's woofx3 engine lives, and how it stays in sync." />

      <EngineSettings />
    </div>
  );
}
