import { type PlacementDocument, stackOrder } from "@woofx3/scene/model";
import { Loader2 } from "lucide-react";
import { useMemo, useState } from "react";
import {
  AlertEditorShell,
  DiscardAlertChangesDialog,
  useAlertEditorView,
} from "@/components/alert-editor/alert-layout-editor";
import type { FieldDescriptor } from "@/components/common/configuration-form";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useAlertLayoutEditor } from "@/hooks/use-alert-layout-editor";
import { readAlertComposition } from "@/lib/alert-layout";
import type { VariableOption } from "@/lib/workflow-variables";

interface AlertLayoutFieldProps {
  field: FieldDescriptor;
  value: unknown;
  onChange: (value: unknown) => void;
  /** What the layout's widget settings may reference: the variables of the step the layout belongs to. */
  availableVariables: VariableOption[];
}

/**
 * A `layout` field: a summary of the placed widgets, and a dialog with the alert
 * editor's stage, layers and inspector. The dialog edits a copy, so closing it
 * without Done leaves the step as it was.
 */
export function AlertLayoutField({ field, value, onChange, availableVariables }: AlertLayoutFieldProps) {
  const [open, setOpen] = useState(false);
  const summary = useMemo(() => summarize(value), [value]);

  return (
    <div className="space-y-2">
      <Label>
        {field.label}
        {field.required && <span className="text-destructive ml-0.5">*</span>}
      </Label>
      <div className="flex items-center justify-between gap-2 rounded-md border p-3">
        <span className="text-sm text-muted-foreground truncate">{summary}</span>
        <Button
          variant="outline"
          size="sm"
          className="shrink-0"
          onClick={() => setOpen(true)}
          data-testid={`button-edit-${field.id}`}
        >
          Edit alert
        </Button>
      </div>
      {typeof field.description === "string" && <p className="text-xs text-muted-foreground">{field.description}</p>}

      <Dialog open={open} onOpenChange={setOpen}>
        {open && (
          <AlertLayoutDialogBody
            field={field}
            value={value}
            availableVariables={availableVariables}
            onDone={(layout) => {
              if (layout !== null) {
                onChange(layout);
              }
              setOpen(false);
            }}
            onCancel={() => setOpen(false)}
          />
        )}
      </Dialog>
    </div>
  );
}

/** The dialog's content, mounted while it is open, so each opening edits a fresh copy of the step's layout. */
function AlertLayoutDialogBody({
  field,
  value,
  availableVariables,
  onDone,
  onCancel,
}: {
  field: FieldDescriptor;
  value: unknown;
  availableVariables: VariableOption[];
  onDone: (layout: unknown | null) => void;
  onCancel: () => void;
}) {
  const session = useAlertLayoutEditor(value);
  const view = useAlertEditorView(session, availableVariables);
  const [confirmingLeave, setConfirmingLeave] = useState(false);
  const isDirty = session?.isDirty === true;

  const leave = () => {
    if (isDirty) {
      setConfirmingLeave(true);
      return;
    }
    onCancel();
  };

  return (
    <DialogContent
      className="max-w-[95vw] w-[95vw] h-[90vh] flex flex-col gap-0 p-0"
      // A stray click outside, or Escape meant for the canvas, must not throw away a layout in progress.
      onInteractOutside={(e) => e.preventDefault()}
      onEscapeKeyDown={(e) => {
        if (isDirty) {
          e.preventDefault();
        }
      }}
    >
      <DialogHeader className="flex-row items-center justify-between space-y-0 border-b py-3 pl-4 pr-12">
        <div>
          <DialogTitle>{field.label}</DialogTitle>
          <DialogDescription>
            {view
              ? `Place widgets on a ${view.canvas.width}×${view.canvas.height} canvas; each alert widget scales it to fit. ${view.lengthLabel}.`
              : "Loading the alert…"}
          </DialogDescription>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={leave}>
            Cancel
          </Button>
          <Button
            onClick={() => onDone(session?.changedLayout() ?? null)}
            disabled={session === null}
            data-testid={`button-done-${field.id}`}
          >
            Done
          </Button>
        </div>
      </DialogHeader>
      {view ? (
        <AlertEditorShell view={view} className="flex-1" />
      ) : (
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}
      <DiscardAlertChangesDialog open={confirmingLeave} onOpenChange={setConfirmingLeave} onDiscard={onCancel} />
    </DialogContent>
  );
}

function summarize(value: unknown): string {
  const doc = readAlertComposition(value, (widgetCanonicalId) => widgetCanonicalId);
  const names = stackOrder(doc).map((id) => (doc.widgets[id] as PlacementDocument).name);
  return names.length === 0 ? "No widgets yet" : names.join(", ");
}
