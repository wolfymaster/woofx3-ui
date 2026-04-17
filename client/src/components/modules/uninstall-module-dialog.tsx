import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useAction, useQuery } from "convex/react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
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

const ENGINE_RESPONSE_TIMEOUT_MS = 60_000;

type ConflictResource = {
  resourceType?: string;
  resourceId?: string;
  resourceName?: string;
};

type UninstallDialogModule = {
  _id: Id<"moduleRepository">;
  name: string;
  version: string;
  moduleKey?: string;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  instanceId: Id<"instances">;
  module: UninstallDialogModule | null;
  onSuccess?: () => void;
};

type Phase = "confirm" | "requesting" | "awaiting-engine" | "conflicts" | "error";

function groupConflicts(conflicts: ConflictResource[]): Array<[string, ConflictResource[]]> {
  const groups = new Map<string, ConflictResource[]>();
  for (const c of conflicts) {
    const key = c.resourceType ?? "other";
    const bucket = groups.get(key) ?? [];
    bucket.push(c);
    groups.set(key, bucket);
  }
  return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
}

export function UninstallModuleDialog({ open, onOpenChange, instanceId, module, onSuccess }: Props) {
  const requestModuleUninstall = useAction(api.moduleEngine.requestModuleUninstall);
  const [phase, setPhase] = useState<Phase>("confirm");
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<ConflictResource[]>([]);

  const uninstallEvent = useQuery(
    api.transientEvents.get,
    pendingKey ? { instanceId, correlationKey: pendingKey } : "skip"
  );

  const reset = useCallback(() => {
    setPhase("confirm");
    setPendingKey(null);
    setErrorMessage(null);
    setConflicts([]);
  }, []);

  useEffect(() => {
    if (!open) {
      reset();
    }
  }, [open, reset]);

  useEffect(() => {
    if (!pendingKey || !uninstallEvent) {
      return;
    }
    if (uninstallEvent.status === "progress") {
      setPhase("awaiting-engine");
      return;
    }
    if (uninstallEvent.status === "success") {
      setPendingKey(null);
      onOpenChange(false);
      if (onSuccess) {
        onSuccess();
      }
      return;
    }
    if (uninstallEvent.status === "error") {
      setErrorMessage(uninstallEvent.message ?? "Uninstall failed on the engine.");
      const data = uninstallEvent.data as { conflicts?: ConflictResource[] } | undefined;
      const rawConflicts = data?.conflicts;
      const conflictList = Array.isArray(rawConflicts) ? rawConflicts : [];
      setConflicts(conflictList);
      setPhase(conflictList.length > 0 ? "conflicts" : "error");
      setPendingKey(null);
    }
  }, [pendingKey, uninstallEvent, onOpenChange, onSuccess]);

  useEffect(() => {
    if (phase !== "awaiting-engine" || !pendingKey) {
      return;
    }
    const timer = setTimeout(() => {
      setErrorMessage(
        "The engine did not respond within 60 seconds. The uninstall may still complete in the background."
      );
      setPhase("error");
      setPendingKey(null);
    }, ENGINE_RESPONSE_TIMEOUT_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [phase, pendingKey]);

  const handleConfirm = useCallback(async () => {
    if (!module) {
      return;
    }
    setPhase("requesting");
    setErrorMessage(null);
    setConflicts([]);
    try {
      const result = await requestModuleUninstall({ instanceId, moduleId: module._id });
      setPendingKey(result.moduleKey);
      setPhase("awaiting-engine");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Failed to request uninstall.");
      setPhase("error");
    }
  }, [module, instanceId, requestModuleUninstall]);

  const handleRetry = useCallback(() => {
    setErrorMessage(null);
    setConflicts([]);
    setPendingKey(null);
    setPhase("confirm");
  }, []);

  const groupedConflicts = useMemo(() => groupConflicts(conflicts), [conflicts]);

  if (!module) {
    return null;
  }

  const moduleLabel = `${module.name}@${module.version}`;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-xl">
        {phase === "confirm" && (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle>Remove {module.name}?</AlertDialogTitle>
              <AlertDialogDescription>
                This will request the engine to uninstall <span className="font-medium">{moduleLabel}</span>. The engine
                will refuse if any workflows, scenes, or commands still use this module.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={(e) => {
                  e.preventDefault();
                  void handleConfirm();
                }}
              >
                Uninstall
              </AlertDialogAction>
            </AlertDialogFooter>
          </>
        )}

        {(phase === "requesting" || phase === "awaiting-engine") && (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle>Uninstalling {module.name}</AlertDialogTitle>
              <AlertDialogDescription>
                Waiting for the engine to confirm removal of <span className="font-medium">{moduleLabel}</span>.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="flex items-center gap-3 py-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {phase === "requesting" ? "Sending uninstall request…" : "Engine is working on it…"}
            </div>
          </>
        )}

        {phase === "conflicts" && (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-destructive" />
                Can&apos;t remove {module.name} yet
              </AlertDialogTitle>
              <AlertDialogDescription>
                {errorMessage ?? "The engine refused the uninstall because these resources still use this module."}{" "}
                Remove or reassign them, then try again.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="space-y-4 max-h-80 overflow-y-auto pr-1">
              {groupedConflicts.map(([type, items]) => (
                <div key={type}>
                  <div className="mb-2 flex items-center gap-2">
                    <Badge variant="outline" className="capitalize">
                      {type}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {items.length} {items.length === 1 ? "item" : "items"}
                    </span>
                  </div>
                  <ul className="space-y-1 pl-1">
                    {items.map((item, idx) => (
                      <li
                        key={`${type}-${item.resourceId ?? idx}`}
                        className="text-sm border-l-2 border-border pl-3 py-1"
                      >
                        <div className="font-medium">{item.resourceName ?? item.resourceId ?? "(unnamed)"}</div>
                        {item.resourceId && item.resourceName && (
                          <div className="text-xs text-muted-foreground font-mono">{item.resourceId}</div>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => onOpenChange(false)}>Close</AlertDialogCancel>
              <Button variant="outline" onClick={handleRetry}>
                Try again
              </Button>
            </AlertDialogFooter>
          </>
        )}

        {phase === "error" && (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-destructive" />
                Uninstall failed
              </AlertDialogTitle>
              <AlertDialogDescription>
                {errorMessage ?? "Something went wrong while uninstalling the module."}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => onOpenChange(false)}>Close</AlertDialogCancel>
              <Button variant="outline" onClick={handleRetry}>
                Try again
              </Button>
            </AlertDialogFooter>
          </>
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
}
