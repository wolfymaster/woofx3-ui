import { TestEventPicker } from "@/components/test-events/test-event-picker";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { AlertMenuSection } from "@/lib/alert-groups";
import { SHEET_MOTION } from "@/lib/sheet-motion";
import { cn } from "@/lib/utils";

interface TestEventSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Every alert trigger, in the rail's menu order — see flattenAlertTree. */
  sections: AlertMenuSection[];
  /** Held by the caller so the lightning icon on another event can retarget an open sheet. */
  selectedId: string | null;
  onSelect: (presetId: string) => void;
}

/**
 * Hand-fire a simulated event from beside the alerts it drives.
 *
 * Non-modal and not dismissed by outside clicks, so the configured triggers stay
 * visible and editable while firing — checking a threshold is edit, fire, repeat
 * rather than close, edit, reopen.
 */
export function TestEventSheet({ open, onOpenChange, sections, selectedId, onSelect }: TestEventSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange} modal={false}>
      <SheetContent
        className={cn("w-full sm:max-w-md flex flex-col", SHEET_MOTION)}
        onInteractOutside={(e) => e.preventDefault()}
        data-testid="test-event-sheet"
      >
        <SheetHeader>
          <SheetTitle>Test an event</SheetTitle>
          <SheetDescription>Sends a pretend event so you can see your alerts play on your overlay.</SheetDescription>
        </SheetHeader>

        <TestEventPicker sections={sections} selectedId={selectedId} onSelect={onSelect} />
      </SheetContent>
    </Sheet>
  );
}
