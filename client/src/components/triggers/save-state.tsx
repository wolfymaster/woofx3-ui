import { Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface SaveStateProps {
  isDirty: boolean;
  isSaving: boolean;
  onSave: () => void;
  onDiscard: () => void;
}

/**
 * Where the page says whether its edits are saved: a quiet line when they are, and a
 * bar with Discard and Save when they aren't. Sticky, so it stays in reach at the end of
 * a long list of triggers.
 */
export function SaveState({ isDirty, isSaving, onSave, onDiscard }: SaveStateProps) {
  if (!isDirty) {
    return (
      <div className="sticky bottom-3 flex justify-end">
        <p className="flex items-center gap-1.5 text-[13px] text-muted-foreground" data-testid="save-state-saved">
          <Check className="h-3.5 w-3.5" aria-hidden="true" />
          All changes saved
        </p>
      </div>
    );
  }

  return (
    <div className="sticky bottom-3 z-20 flex justify-end">
      <div
        className="flex w-full items-center gap-3 rounded-xl border bg-popover px-3 py-2 shadow-lg sm:w-auto"
        data-testid="save-state-unsaved"
      >
        <span className="flex items-center gap-2 text-sm">
          <span className="h-2 w-2 rounded-full bg-amber-500 dark:bg-amber-300" aria-hidden="true" />
          Unsaved changes
        </span>
        <div className="ml-auto flex flex-1 gap-2 sm:flex-none">
          <Button variant="ghost" className="h-11 flex-1 sm:h-9 sm:flex-none" onClick={onDiscard} disabled={isSaving}>
            Discard
          </Button>
          <Button className="h-11 flex-1 sm:h-9 sm:flex-none" onClick={onSave} disabled={isSaving}>
            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}
