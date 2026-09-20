import { api } from "@convex/_generated/api";
import { useQuery } from "convex/react";
import { useCallback, useMemo, useState } from "react";
import type { CustomFieldRenderer, FieldDescriptor } from "@/components/common/configuration-form";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useInstance } from "@/hooks/use-instance";
import { type AlertLayout, readAlertLayout, writeAlertLayout } from "@/lib/alert-layout";
import { placeableOn } from "@/lib/widget-surfaces";
import type { VariableOption } from "@/lib/workflow-variables";
import { alertWidgetPreview } from "./alert-widget-previews";
import { WidgetLayoutCanvas, type WidgetsUpdate } from "./widget-layout-canvas";

interface AlertLayoutFieldProps {
  field: FieldDescriptor;
  value: unknown;
  onChange: (value: unknown) => void;
  /** The field renderers the layout's widget settings use. */
  renderers: Record<string, CustomFieldRenderer>;
  /** What the layout's widget settings may reference: the variables of the step the layout belongs to. */
  availableVariables: VariableOption[];
}

/**
 * A `layout` field: a summary of the placed widgets, and a dialog that edits
 * them on the shared widget canvas. The dialog works on a draft, so closing it
 * without Done leaves the step as it was.
 */
export function AlertLayoutField({ field, value, onChange, renderers, availableVariables }: AlertLayoutFieldProps) {
  const { instance } = useInstance();
  const catalogRows = useQuery(api.sceneWidgets.listForInstance, instance ? { instanceId: instance._id } : "skip");
  const surface = typeof field.surface === "string" ? field.surface : "alert";
  const catalog = useMemo(() => placeableOn(catalogRows ?? [], surface), [catalogRows, surface]);
  const nameOf = useCallback(
    (widgetCanonicalId: string) => catalog.find((row) => row.widgetId === widgetCanonicalId)?.name ?? widgetCanonicalId,
    [catalog]
  );
  const stored = useMemo(() => readAlertLayout(value, nameOf), [value, nameOf]);
  const [draft, setDraft] = useState<AlertLayout | null>(null);

  const handleWidgetsChange = useCallback((update: WidgetsUpdate) => {
    setDraft((prev) => (prev ? { ...prev, widgets: update(prev.widgets) } : prev));
  }, []);

  const handleDone = () => {
    if (draft) {
      onChange(writeAlertLayout(draft));
    }
    setDraft(null);
  };

  return (
    <div className="space-y-2">
      <Label>
        {field.label}
        {field.required && <span className="text-destructive ml-0.5">*</span>}
      </Label>
      <div className="flex items-center justify-between gap-2 rounded-md border p-3">
        <span className="text-sm text-muted-foreground truncate">{summarize(stored)}</span>
        <Button
          variant="outline"
          size="sm"
          className="shrink-0"
          onClick={() => setDraft(stored)}
          data-testid={`button-edit-${field.id}`}
        >
          Edit alert
        </Button>
      </div>
      {typeof field.description === "string" && <p className="text-xs text-muted-foreground">{field.description}</p>}

      <Dialog
        open={draft !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDraft(null);
          }
        }}
      >
        <DialogContent
          className="max-w-[95vw] w-[95vw] h-[90vh] flex flex-col gap-0 p-0"
          // A stray click outside must not throw away a layout in progress.
          onInteractOutside={(e) => e.preventDefault()}
        >
          <DialogHeader className="flex-row items-center justify-between space-y-0 border-b py-3 pl-4 pr-12">
            <div>
              <DialogTitle>{field.label}</DialogTitle>
              <DialogDescription>
                Place widgets on a {stored.width}×{stored.height} canvas; each alert widget scales it to fit.
              </DialogDescription>
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setDraft(null)}>
                Cancel
              </Button>
              <Button onClick={handleDone} data-testid={`button-done-${field.id}`}>
                Done
              </Button>
            </div>
          </DialogHeader>
          {draft && (
            <WidgetLayoutCanvas
              className="flex-1"
              width={draft.width}
              height={draft.height}
              widgets={draft.widgets}
              catalog={catalog}
              renderers={renderers}
              availableVariables={availableVariables}
              onChange={handleWidgetsChange}
              placeholder={alertWidgetPreview}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function summarize(layout: AlertLayout): string {
  if (layout.widgets.length === 0) {
    return "No widgets yet";
  }
  return layout.widgets.map((widget) => widget.name).join(", ");
}
