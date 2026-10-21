import { type PlacementDocument, stackOrder } from "@woofx3/scene/model";
import { BookmarkPlus, Loader2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import {
  AlertEditorShell,
  DiscardAlertChangesDialog,
  useAlertEditorView,
} from "@/components/alert-editor/alert-layout-editor";
import {
  AddLibraryAlertDialog,
  type LibraryAlert,
  LibraryAlertList,
} from "@/components/alert-editor/alert-library-panel";
import { SaveToLibraryDialog } from "@/components/alert-editor/save-to-library-dialog";
import type { FieldDescriptor } from "@/components/common/configuration-form";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useAlertLibrary } from "@/engine/hooks/use-alert-library";
import { useAlertLayoutEditor } from "@/hooks/use-alert-layout-editor";
import { useToast } from "@/hooks/use-toast";
import { libraryAlertEditorPath } from "@/lib/alert-editor-route";
import { readAlertComposition } from "@/lib/alert-layout";
import { inlineCopyOfLibraryAlert, unfilledInputsText, withLayersOf } from "@/lib/alert-library";
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
 * without Done leaves the step as it was. On an engine with an alert library, the
 * palette has a Library tab (copy a library alert's layers onto the canvas) and the
 * header a Save to library button (store a copy of this alert there).
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
  const libraryAlerts = useAlertLibrary();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  // Where to go once the edits are confirmed discarded: back to the step, or to a library alert.
  const [pendingLeave, setPendingLeave] = useState<(() => void) | null>(null);
  const [addingFromLibrary, setAddingFromLibrary] = useState<LibraryAlert | null>(null);
  const [savingToLibrary, setSavingToLibrary] = useState(false);
  const isDirty = session?.isDirty === true;

  const leaveTo = (go: () => void) => {
    if (isDirty) {
      setPendingLeave(() => go);
      return;
    }
    go();
  };
  const leave = () => leaveTo(onCancel);
  const addFromLibrary = (alert: LibraryAlert) => {
    setAddingFromLibrary(null);
    const current = session?.state.doc ?? null;
    if (session === null || current === null) {
      return;
    }
    const { doc: copy, unfilled } = inlineCopyOfLibraryAlert(alert, availableVariables);
    session.replace(withLayersOf(current, copy));
    session.editor.dispatch("selection.clear");
    if (unfilled.length > 0) {
      toast({ title: "Some of its inputs had no value", description: unfilledInputsText(unfilled) });
    }
  };
  const library = libraryAlerts.enabled ? (
    <LibraryAlertList
      alerts={libraryAlerts.alerts}
      onPick={setAddingFromLibrary}
      onEdit={(alert) => leaveTo(() => navigate(libraryAlertEditorPath(alert.engineCompositionId)))}
    />
  ) : undefined;

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
        <div className="flex items-center gap-2">
          {view?.transport && (
            <div className="rounded-md border bg-muted/40 py-0.5 pl-1 pr-2 font-mono text-xs text-muted-foreground">
              {view.transport(true)}
            </div>
          )}
          <Button variant="ghost" onClick={leave}>
            Cancel
          </Button>
          {library && (
            <Button
              variant="outline"
              onClick={() => setSavingToLibrary(true)}
              disabled={session === null}
              data-testid="button-save-to-library"
            >
              <BookmarkPlus className="mr-2 h-4 w-4" aria-hidden="true" />
              Save to library
            </Button>
          )}
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
        <AlertEditorShell view={view} library={library} className="flex-1" />
      ) : (
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}
      <DiscardAlertChangesDialog
        open={pendingLeave !== null}
        onOpenChange={(open) => (open ? undefined : setPendingLeave(null))}
        onDiscard={() => pendingLeave?.()}
      />
      {library && (
        <>
          <AddLibraryAlertDialog
            alert={addingFromLibrary}
            onClose={() => setAddingFromLibrary(null)}
            onConfirm={addFromLibrary}
          />
          <SaveToLibraryDialog
            open={savingToLibrary}
            onOpenChange={setSavingToLibrary}
            doc={session?.state.doc ?? null}
            availableVariables={availableVariables}
            takenNames={libraryAlerts.alerts?.map((alert) => alert.name)}
            onSaved={() => setSavingToLibrary(false)}
          />
        </>
      )}
    </DialogContent>
  );
}

function summarize(value: unknown): string {
  const doc = readAlertComposition(value, (widgetCanonicalId) => widgetCanonicalId);
  const names = stackOrder(doc).map((id) => (doc.widgets[id] as PlacementDocument).name);
  return names.length === 0 ? "No widgets yet" : names.join(", ");
}
