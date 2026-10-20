import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isValidStepId } from "@/lib/workflow-variables";

/** Editable step id, committed on blur/Enter rather than per keystroke — renaming mid-tree updates the
 * tree, autosaves, and re-selects under the new id, which would be disruptive on every character typed. */
export function StepIdField({
  id,
  existingStepIds,
  onUpdateActionId,
}: {
  id: string;
  existingStepIds: ReadonlySet<string>;
  onUpdateActionId: (oldId: string, newId: string) => void;
}) {
  const [draft, setDraft] = useState(id);

  useEffect(() => {
    setDraft(id);
  }, [id]);

  const trimmed = draft.trim();
  const error =
    trimmed.length === 0
      ? "Step ID can't be empty."
      : !isValidStepId(trimmed)
        ? "Use only letters, numbers, dots, underscores, and hyphens."
        : trimmed !== id && existingStepIds.has(trimmed)
          ? "Already used by another step in this workflow."
          : null;

  const commit = () => {
    if (error) {
      setDraft(id);
      return;
    }
    if (trimmed !== id) {
      onUpdateActionId(id, trimmed);
    }
  };

  return (
    <div className="space-y-2">
      <Label htmlFor="step-id">Step ID</Label>
      <Input
        id="step-id"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.currentTarget.blur();
          }
        }}
        className="font-mono text-xs"
        data-testid="input-step-id"
      />
      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : (
        <p className="text-xs text-muted-foreground">
          Later steps can use this step's output: type <code>{"{"}</code> in one of their fields.
        </p>
      )}
    </div>
  );
}
