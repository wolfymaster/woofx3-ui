import { CircleAlert, CircleCheck, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { FlowSaveTone, FlowSaveView } from "@/lib/flow-save";
import { cn } from "@/lib/utils";

const TONE_TEXT: Record<FlowSaveTone, string> = {
  saved: "text-muted-foreground",
  unsaved: "text-amber-800 dark:text-amber-200",
  saving: "text-muted-foreground",
  failed: "text-destructive",
  blocked: "text-destructive",
};

function ToneMark({ tone }: { tone: FlowSaveTone }) {
  switch (tone) {
    case "saved":
      return <CircleCheck className="h-4 w-4 shrink-0" aria-hidden="true" />;
    case "saving":
      return <Loader2 className="h-4 w-4 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden="true" />;
    case "unsaved":
      return <span className="mx-1 h-2 w-2 shrink-0 rounded-full bg-amber-500" aria-hidden="true" />;
    case "failed":
    case "blocked":
      return <CircleAlert className="h-4 w-4 shrink-0" aria-hidden="true" />;
  }
}

function SaveText({ view, testId }: { view: FlowSaveView; testId: string }) {
  return (
    <p
      className={cn("flex min-w-0 items-center gap-1.5 text-[13px]", TONE_TEXT[view.tone])}
      aria-live="polite"
      data-tone={view.tone}
      data-testid={testId}
    >
      <ToneMark tone={view.tone} />
      <span className="min-w-0">{view.text}</span>
    </p>
  );
}

/**
 * The flow's state as a whole, floating in sight as the steps scroll. An open step's footer
 * says the same, so the chip steps aside for it but keeps its place: the steps don't jump.
 */
export function FlowSaveBar({ view, hidden, onRetry }: { view: FlowSaveView; hidden: boolean; onRetry: () => void }) {
  return (
    <div
      className={cn(
        "sticky top-1 z-10 mb-1 flex min-h-8 w-fit max-w-full items-center gap-3 self-end rounded-full border bg-card px-3 py-1 shadow-sm",
        hidden && "invisible"
      )}
      data-testid="flow-save-bar"
    >
      <SaveText view={view} testId="flow-save-status" />
      {view.tone === "failed" && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7"
          onClick={onRetry}
          data-testid="button-flow-save-retry"
        >
          Try again
        </Button>
      )}
    </div>
  );
}

/** The open step's own way out: what happens to its edits is a choice, not a side effect of closing. */
export function StepSaveFooter({
  view,
  changed,
  onSave,
  onDiscard,
  onClose,
}: {
  view: FlowSaveView;
  changed: boolean;
  onSave: () => void;
  onDiscard: () => void;
  onClose: () => void;
}) {
  const saving = view.tone === "saving";
  return (
    <div
      className="sticky bottom-0 -mx-4 -mb-4 flex flex-wrap items-center justify-between gap-2 rounded-b-[10px] border-t bg-card px-4 py-2.5"
      data-testid="step-save-footer"
    >
      {changed ? (
        <SaveText view={view} testId="step-save-status" />
      ) : (
        <p className="text-[13px] text-muted-foreground" data-testid="step-save-status">
          No changes to this step
        </p>
      )}
      <div className="ml-auto flex items-center gap-2">
        {changed ? (
          <>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onDiscard}
              disabled={saving}
              data-testid="button-step-discard"
            >
              Discard changes
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={onSave}
              disabled={saving || view.tone === "blocked"}
              data-testid="button-step-save"
            >
              {view.tone === "failed" ? "Try again" : "Save changes"}
            </Button>
          </>
        ) : (
          <Button type="button" variant="outline" size="sm" onClick={onClose} data-testid="button-step-close">
            Close
          </Button>
        )}
      </div>
    </div>
  );
}
