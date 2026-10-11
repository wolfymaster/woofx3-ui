import { api } from "@convex/_generated/api";
import type { CompositionDocument } from "@woofx3/scene/model";
import { useAction } from "convex/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useInstance } from "@/hooks/use-instance";
import { useToast } from "@/hooks/use-toast";
import { libraryAlertOfStep, libraryJsonOf } from "@/lib/alert-library";
import type { VariableOption } from "@/lib/workflow-variables";

interface SaveToLibraryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The alert as the editor holds it now. */
  doc: CompositionDocument | null;
  /** The step's variables, which name the inputs its `${...}` references become. */
  availableVariables: VariableOption[];
  /** The library's alert names, which the engine keeps unique; undefined while they load. */
  takenNames: readonly string[] | undefined;
  /** The new library alert's id, which the step then links, with the values for its inputs. */
  onSaved: (compositionId: string, inputs: Record<string, string>) => void;
}

/**
 * Stores the alert on the canvas in the engine's library under a name. The step then
 * plays the library alert, so other steps can use the same one and an edit published to
 * it changes all of them. A stored alert refers to no event data of its own, so each
 * variable the alert uses becomes one of its inputs, filled in by this step with the
 * same variable (`libraryAlertOfStep`).
 */
export function SaveToLibraryDialog({
  open,
  onOpenChange,
  doc,
  availableVariables,
  takenNames,
  onSaved,
}: SaveToLibraryDialogProps) {
  const { instance } = useInstance();
  const { toast } = useToast();
  const create = useAction(api.alertCompositionActions.create);
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const taken = takenNames?.includes(name.trim()) ?? false;

  const save = async () => {
    if (!instance || !doc || name.trim() === "" || taken) {
      return;
    }
    setPending(true);
    try {
      const library = libraryAlertOfStep(doc, availableVariables);
      const { engineCompositionId } = await create({
        instanceId: instance._id,
        name: name.trim(),
        ...libraryJsonOf(library.doc),
      });
      setName("");
      onSaved(engineCompositionId, library.values);
    } catch (error) {
      toast({
        title: "The alert wasn't saved to the library",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Save to library</DialogTitle>
          <DialogDescription>
            This step then plays the library alert. Other alerts can use it too, and what you publish to it changes
            every one of them.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="library-alert-name">Name</Label>
          <Input
            id="library-alert-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                void save();
              }
            }}
            placeholder="Follower alert"
            aria-invalid={taken}
            aria-describedby={taken ? "library-alert-name-taken" : undefined}
            data-testid="input-library-alert-name"
          />
          {taken && (
            <p id="library-alert-name-taken" className="text-sm text-destructive">
              The library already has an alert with this name.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => void save()}
            disabled={pending || name.trim() === "" || taken || doc === null}
            data-testid="button-save-library-alert"
          >
            {pending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
