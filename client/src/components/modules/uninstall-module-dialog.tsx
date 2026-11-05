import { AlertTriangle, Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { UninstallUsageRow } from "@/components/modules/uninstall-usage-row";
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
import { useTransientEvent } from "@/engine/hooks/use-correlated-request";
import { useReconcileModuleUninstallRequest, useUninstallModuleRequest } from "@/engine/hooks/use-modules";
import type { ModuleId } from "@/engine/types";
import { type ConflictResource, usageRows } from "@/lib/uninstall-conflicts";

const ENGINE_RESPONSE_TIMEOUT_MS = 60_000;

type UninstallDialogModule = {
  id: ModuleId;
  name: string;
  version: string;
  moduleKey?: string;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  module: UninstallDialogModule | null;
  onSuccess?: () => void;
};

type Phase = "confirm" | "requesting" | "awaiting-engine" | "conflicts" | "error";

export function UninstallModuleDialog({ open, onOpenChange, module, onSuccess }: Props) {
  const requestModuleUninstall = useUninstallModuleRequest();
  const reconcileUninstall = useReconcileModuleUninstallRequest();
  const [phase, setPhase] = useState<Phase>("confirm");
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<ConflictResource[]>([]);
  const [removedKeys, setRemovedKeys] = useState<ReadonlySet<string>>(new Set());

  const uninstallEvent = useTransientEvent(pendingKey || null);

  const reset = useCallback(() => {
    setPhase("confirm");
    setPendingKey(null);
    setErrorMessage(null);
    setConflicts([]);
    setRemovedKeys(new Set());
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
    if (phase !== "awaiting-engine" || !pendingKey || !module) {
      return;
    }
    const key = pendingKey;
    const timer = setTimeout(async () => {
      // No module.deleted/module.delete_failed webhook arrived in time — ask
      // the engine directly whether it's still installed rather than leaving
      // the dialog (and the stale Convex record) stuck on a webhook that may
      // never come.
      try {
        const result = await reconcileUninstall(module.id, key);
        if (!result.stillInstalled) {
          setPendingKey(null);
          onOpenChange(false);
          if (onSuccess) {
            onSuccess();
          }
          return;
        }
        setErrorMessage(
          "The engine did not confirm removal within 60 seconds, and the module is still installed. Try again."
        );
      } catch {
        setErrorMessage(
          "The engine did not respond within 60 seconds. The uninstall may still complete in the background."
        );
      }
      setPhase("error");
      setPendingKey(null);
    }, ENGINE_RESPONSE_TIMEOUT_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [phase, pendingKey, module, reconcileUninstall, onOpenChange, onSuccess]);

  const handleConfirm = useCallback(async () => {
    if (!module) {
      return;
    }
    setPhase("requesting");
    setErrorMessage(null);
    setConflicts([]);
    setRemovedKeys(new Set());
    try {
      const result = await requestModuleUninstall(module.id);
      setPendingKey(result.moduleKey);
      setPhase("awaiting-engine");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Failed to request uninstall.");
      setPhase("error");
    }
  }, [module, requestModuleUninstall]);

  const handleRetry = useCallback(() => {
    setErrorMessage(null);
    setConflicts([]);
    setPendingKey(null);
    setPhase("confirm");
  }, []);

  const usage = useMemo(() => usageRows(conflicts), [conflicts]);
  const hasFixes = usage.some((row) => row.fix !== "none");
  const allClear = usage.length > 0 && usage.every((row) => removedKeys.has(row.key));
  const markRemoved = useCallback((key: string) => {
    setRemovedKeys((keys) => (keys.has(key) ? keys : new Set(keys).add(key)));
  }, []);

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
                will refuse if any workflows, scenes, or commands still use this module, or another installed module
                requires it.
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
                {usage.length === 1 ? "This still uses it." : `These ${usage.length} still use it.`}{" "}
                {hasFixes ? "Remove them here, then uninstall." : "Clear them, then try again."}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <ul className="-mr-1 flex max-h-96 flex-col gap-2 overflow-y-auto pr-1">
              {usage.map((row) => (
                <UninstallUsageRow
                  key={row.key}
                  row={row}
                  isRemoved={removedKeys.has(row.key)}
                  onRemoved={markRemoved}
                />
              ))}
            </ul>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => onOpenChange(false)}>Close</AlertDialogCancel>
              <Button
                variant={allClear ? "destructive" : "outline"}
                onClick={() => {
                  void handleConfirm();
                }}
              >
                {allClear ? `Uninstall ${module.name}` : "Try again"}
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
