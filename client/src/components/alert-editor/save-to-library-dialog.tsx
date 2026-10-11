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
  onSaved: () => void;
}

/**
 * Stores a copy of the alert on the canvas in the engine's library under a name, as a
 * starting point for other alerts. The step keeps its own alert. A stored alert refers
 * to no event data of its own, so each variable the alert uses becomes one of its inputs
 * (`libraryAlertOfStep`), which a copy started from it fills in again.
 */
export function SaveToLibraryDialog({
  open,
  onOpenChange,
  doc,
  availableVariables,
  onSaved,
}: SaveToLibraryDialogProps) {
  const { instance } = useInstance();
  const { toast } = useToast();
  const create = useAction(api.alertCompositionActions.create);
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);

  const save = async () => {
    if (!instance || !doc || name.trim() === "") {
      return;
    }
    setPending(true);
    try {
      const savedName = name.trim();
      await create({
        instanceId: instance._id,
        name: savedName,
        ...libraryJsonOf(libraryAlertOfStep(doc, availableVariables)),
      });
      setName("");
      toast({ title: `Saved ${savedName} to the library` });
      onSaved();
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
            Saves a copy other alerts can start from. This step keeps its own alert, and the variables it shows become
            the copy's inputs.
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
            data-testid="input-library-alert-name"
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => void save()}
            disabled={pending || name.trim() === "" || doc === null}
            data-testid="button-save-library-alert"
          >
            {pending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
