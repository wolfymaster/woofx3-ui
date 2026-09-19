import { testEventFormFor } from "@/components/test-events/registry";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { AlertMenuSection } from "@/lib/alert-groups";

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
  const preset = selectedId
    ? sections.flatMap((section) => section.presets).find((entry) => entry.id === selectedId)
    : undefined;
  const Form = preset ? testEventFormFor(preset) : null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange} modal={false}>
      <SheetContent
        className="w-full sm:max-w-md flex flex-col"
        onInteractOutside={(e) => e.preventDefault()}
        data-testid="test-event-sheet"
      >
        <SheetHeader>
          <SheetTitle>Test an event</SheetTitle>
          <SheetDescription>
            Fires a simulated event at the engine. Workflows listening for it run exactly as they would for a real one —
            overlays included.
          </SheetDescription>
        </SheetHeader>

        {preset && Form ? (
          <>
            <div className="space-y-2 pb-4 border-b">
              <Label htmlFor="test-event-trigger">Trigger</Label>
              <Select value={preset.id} onValueChange={onSelect}>
                <SelectTrigger id="test-event-trigger" data-testid="select-test-event">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {sections.map((section) => (
                    <SelectGroup key={section.id}>
                      <SelectLabel>{section.label}</SelectLabel>
                      {section.presets.map((entry) => (
                        <SelectItem key={entry.id} value={entry.id}>
                          {entry.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {preset.description}
                <span className="block mt-1 font-mono text-muted-foreground/80">{preset.event}</span>
              </p>
            </div>

            <Form key={preset.id} preset={preset} />
          </>
        ) : (
          <p className="text-sm text-muted-foreground">That trigger is no longer registered on this instance.</p>
        )}
      </SheetContent>
    </Sheet>
  );
}
