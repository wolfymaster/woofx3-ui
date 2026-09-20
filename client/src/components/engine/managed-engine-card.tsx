import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useAction, useQuery } from "convex/react";
import { AlertTriangle, ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { ProvisioningSteps } from "./provisioning-steps";

interface ManagedEngineCardProps {
  instanceId: Id<"instances">;
}

type RowStatus =
  | "requested"
  | "provisioning"
  | "ready"
  | "registering"
  | "registered"
  | "failed"
  | "deprovisioning"
  | "deleted";

const STATUS_LABELS: Record<RowStatus, string> = {
  requested: "Requested",
  provisioning: "Building",
  ready: "Ready",
  registering: "Connecting",
  registered: "Running",
  failed: "Failed",
  deprovisioning: "Deleting",
  deleted: "Deleted",
};

/**
 * A teardown that failed leaves the engine deprovisioning with the error on
 * the row, and the repair is to ask for the delete again — so the button says
 * so rather than reading as a delete that has not started.
 */
function deleteLabel(status: RowStatus, error: string | undefined): string {
  if (status !== "deprovisioning") {
    return "Delete engine";
  }
  return error ? "Try delete again" : "Deleting…";
}

function statusVariant(status: RowStatus): "default" | "secondary" | "destructive" | "outline" {
  if (status === "registered") {
    return "default";
  }
  if (status === "failed") {
    return "destructive";
  }
  if (status === "deleted") {
    return "outline";
  }
  return "secondary";
}

/**
 * The engine page for an engine woofx3 runs.
 *
 * There is no URL to edit here — the address is the slug the user chose, and
 * the maintenance API decides where it points — so this reports rather than
 * configures: what it is running, how the last run went, and the two actions
 * that make sense on a hosted engine.
 */
export function ManagedEngineCard({ instanceId }: ManagedEngineCardProps) {
  const provisioning = useQuery(api.provisioning.forInstance, { instanceId });
  const retry = useAction(api.provisioning.retry);
  const deleteEngine = useAction(api.provisioning.deleteManagedEngine);
  const engineFlag = useAction(api.provisioning.engineFlag);

  const [flag, setFlag] = useState<{ at: string; reason: string } | null>(null);
  const [busy, setBusy] = useState<"retry" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Only the maintenance API knows about a flag, and nothing pushes it, so it
  // is read once when the page opens.
  useEffect(() => {
    let cancelled = false;
    engineFlag({ instanceId })
      .then((result) => {
        if (!cancelled) {
          setFlag(result);
        }
      })
      .catch(() => {
        // A flag that cannot be fetched is not worth an error on this page:
        // everything else here comes from Convex and is still true.
      });
    return () => {
      cancelled = true;
    };
  }, [engineFlag, instanceId]);

  if (provisioning === undefined) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-8 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading engine…
        </CardContent>
      </Card>
    );
  }
  if (provisioning === null) {
    return (
      <Card>
        <CardContent className="py-8 text-sm text-muted-foreground">
          This instance is managed, but no provisioning record exists for it.
        </CardContent>
      </Card>
    );
  }

  const status = provisioning.status as RowStatus;

  async function handleRetry() {
    setError(null);
    setBusy("retry");
    try {
      await retry({ instanceId });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function handleDelete() {
    setError(null);
    setBusy("delete");
    try {
      await deleteEngine({ instanceId });
      setConfirmOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle>Managed Engine</CardTitle>
              <CardDescription>woofx3 runs this engine for you, at the address you chose.</CardDescription>
            </div>
            <Badge variant={statusVariant(status)} data-testid="badge-engine-status">
              {STATUS_LABELS[status] ?? status}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3 text-sm">
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Name</div>
              <div className="mt-1 font-mono" data-testid="text-engine-slug">
                {provisioning.slug}
              </div>
            </div>
            <div className="sm:col-span-2 min-w-0">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Address</div>
              {provisioning.publicUrl ? (
                <a
                  href={provisioning.publicUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 inline-flex items-center gap-1 font-mono text-primary hover:underline break-all"
                  data-testid="link-engine-url"
                >
                  {provisioning.publicUrl}
                  <ExternalLink className="h-3 w-3 shrink-0" />
                </a>
              ) : (
                <div className="mt-1 text-muted-foreground">Not published yet</div>
              )}
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Release</div>
              <div className="mt-1 font-mono" data-testid="text-engine-release">
                {provisioning.reportedVersion ?? "—"}
              </div>
            </div>
          </div>

          {flag && (
            <div
              className="rounded-md border border-yellow-500/40 bg-yellow-500/5 p-3 text-sm"
              data-testid="engine-flag"
            >
              <p className="font-medium inline-flex items-center gap-1.5">
                <AlertTriangle className="h-4 w-4 text-yellow-500" />
                Needs attention
              </p>
              <p className="mt-1 text-xs text-muted-foreground break-words">{flag.reason}</p>
              <p className="mt-1 text-xs text-muted-foreground">Flagged {new Date(flag.at).toLocaleString()}</p>
            </div>
          )}

          {provisioning.steps.length > 0 && status !== "registered" && (
            <>
              <Separator />
              <ProvisioningSteps steps={provisioning.steps} />
            </>
          )}

          {provisioning.error && status !== "registered" && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3">
              <p className="text-xs text-destructive/90 break-words" data-testid="text-engine-error">
                {provisioning.error}
              </p>
            </div>
          )}

          <Separator />

          <div className="flex flex-wrap items-center gap-2">
            {/* Retry resumes the failed run, or re-runs the handshake when the
                engine came up but never registered. A teardown in flight is
                repaired by asking for the delete again, not by rebuilding. */}
            <Button
              type="button"
              variant="secondary"
              onClick={handleRetry}
              disabled={busy !== null || status !== "failed"}
              data-testid="button-retry-engine"
            >
              {busy === "retry" ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-2" />
              )}
              Retry
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => setConfirmOpen(true)}
              disabled={busy !== null || status === "deleted"}
              data-testid="button-delete-engine"
            >
              {deleteLabel(status, provisioning.error)}
            </Button>
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </CardContent>
      </Card>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this engine?</AlertDialogTitle>
            <AlertDialogDescription>
              The engine at {provisioning.publicUrl ?? provisioning.slug} is destroyed, along with its database and
              everything stored on it. Your workspace, scenes and workflows stay here, and the address becomes available
              to someone else. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy === "delete"}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                // The dialog closes on its own once the action resolves, so the
                // default close is prevented to keep the pending state visible.
                event.preventDefault();
                void handleDelete();
              }}
              disabled={busy === "delete"}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete-engine"
            >
              {busy === "delete" ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Delete engine
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
