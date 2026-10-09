import { api } from "@convex/_generated/api";
import type { Doc } from "@convex/_generated/dataModel";
import { useQuery } from "convex/react";
import { Loader2 } from "lucide-react";
import { useMemo } from "react";
import { AlertLayoutPreview } from "@/components/alerts/alert-layout-preview";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useInstance } from "@/hooks/use-instance";
import { useWorkflowCatalog } from "@/hooks/use-workflow-catalog";
import { readAlertLayout } from "@/lib/alert-layout";
import { alertsInCommands, alertsInWorkflows, type ExistingAlert } from "@/lib/existing-alerts";

interface StartFromAlertDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The alert being edited, left out of the list. */
  currentKey?: string;
  /** How many layers picking one replaces, so the dialog can say so. */
  replacesLayers: number;
  onPick: (alert: ExistingAlert) => void;
}

/**
 * Lists the alerts already saved on the instance, from triggers and chat commands, so
 * a new alert can start as a copy of one. It reads what the engine holds: an edit
 * waiting for Save elsewhere is not offered until it is saved.
 */
export function StartFromAlertDialog({
  open,
  onOpenChange,
  currentKey,
  replacesLayers,
  onPick,
}: StartFromAlertDialogProps) {
  const { instance } = useInstance();
  const { triggerPresets, loading: catalogLoading } = useWorkflowCatalog();
  const workflows = useQuery(api.workflows.list, open && instance ? { instanceId: instance._id } : "skip");
  const commands = useQuery(api.chatCommands.list, open && instance ? { instanceId: instance._id } : "skip");

  const alerts = useMemo(() => {
    if (workflows === undefined || commands === undefined) {
      return undefined;
    }
    return [
      ...alertsInWorkflows(workflows as Doc<"workflows">[], triggerPresets),
      ...alertsInCommands(commands),
    ].filter((alert) => alert.key !== currentKey);
  }, [workflows, commands, triggerPresets, currentKey]);

  const loading = catalogLoading || alerts === undefined;
  const fromTriggers = alerts?.filter((alert) => alert.source === "trigger") ?? [];
  const fromCommands = alerts?.filter((alert) => alert.source === "command") ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] max-w-3xl flex-col gap-4">
        <DialogHeader>
          <DialogTitle>Start from an existing alert</DialogTitle>
          <DialogDescription>
            {replacesLayers > 0
              ? `Its layers replace the ${replacesLayers === 1 ? "layer" : `${replacesLayers} layers`} on this canvas. Cancel in the editor still brings them back.`
              : "Its layers and their settings are copied here. The alert you copy from stays as it is."}
          </DialogDescription>
        </DialogHeader>
        <div className="-mx-6 min-h-0 flex-1 overflow-y-auto px-6">
          {loading ? (
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          ) : fromTriggers.length === 0 && fromCommands.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No saved alerts have anything on them yet. Once one does, it can be copied from here.
            </p>
          ) : (
            <div className="flex flex-col gap-6">
              <AlertGroup heading="Triggers" alerts={fromTriggers} onPick={onPick} />
              <AlertGroup heading="Chat commands" alerts={fromCommands} onPick={onPick} />
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AlertGroup({
  heading,
  alerts,
  onPick,
}: {
  heading: string;
  alerts: ExistingAlert[];
  onPick: (alert: ExistingAlert) => void;
}) {
  if (alerts.length === 0) {
    return null;
  }
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{heading}</h3>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
        {alerts.map((alert) => (
          <li key={alert.key}>
            <button
              type="button"
              onClick={() => onPick(alert)}
              className="flex w-full flex-col gap-2 rounded-[10px] border p-2 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              data-testid={`start-from-${alert.key}`}
            >
              <AlertLayoutPreview layout={readAlertLayout(alert.layout, (widgetCanonicalId) => widgetCanonicalId)} />
              <span className="min-w-0 px-1">
                <span className="block truncate text-sm font-medium">{alert.title}</span>
                <span className="block truncate text-xs text-muted-foreground">{alert.detail}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
