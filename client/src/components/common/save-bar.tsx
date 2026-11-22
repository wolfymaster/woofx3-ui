import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface SaveBarProps {
  onSave: () => void;
  onCancel?: () => void;
  saving?: boolean;
  disabled?: boolean;
  dirty?: boolean;
  testId?: string;
  className?: string;
}

/**
 * The one Save control for an editor page. It sticks to the bottom of the scrolling area, so it stays under the
 * user's hands however long the form is. Put it as the last child of the scroll container.
 */
export function SaveBar({
  onSave,
  onCancel,
  saving = false,
  disabled = false,
  dirty = false,
  testId,
  className,
}: SaveBarProps) {
  return (
    <div
      className={cn(
        "sticky bottom-0 z-10 flex items-center justify-end gap-3 border-t bg-background/95 px-4 py-3 backdrop-blur sm:px-8",
        className
      )}
      data-testid="save-bar"
    >
      {dirty && <span className="mr-auto text-sm text-amber-800 dark:text-amber-200">Unsaved changes</span>}
      {onCancel && (
        <Button variant="ghost" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
      )}
      <Button onClick={onSave} disabled={saving || disabled} data-testid={testId}>
        {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Save
      </Button>
    </div>
  );
}
