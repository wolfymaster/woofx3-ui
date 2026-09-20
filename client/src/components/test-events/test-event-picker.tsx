import { testEventFormFor } from "@/components/test-events/registry";
import { TriggerPicker } from "@/components/test-events/trigger-picker";
import { Label } from "@/components/ui/label";
import type { AlertMenuSection } from "@/lib/alert-groups";

interface TestEventPickerProps {
  /** Every alert trigger, in the rail's menu order — see flattenAlertTree. */
  sections: AlertMenuSection[];
  /** Held by the caller so something else on the page can retarget the picker. */
  selectedId: string | null;
  onSelect: (presetId: string) => void;
  /** Distinguishes the select from another on the same page. */
  id?: string;
}

/**
 * Choose a trigger and fill in the event to fire at the engine.
 *
 * Grows to its container and scrolls its fields, so the Trigger button stays in
 * reach whether this sits in a sheet beside the alerts it drives or in a card
 * on the Alerts dashboard.
 */
export function TestEventPicker({ sections, selectedId, onSelect, id = "test-event-trigger" }: TestEventPickerProps) {
  const preset = selectedId
    ? sections.flatMap((section) => section.presets).find((entry) => entry.id === selectedId)
    : undefined;
  const Form = preset ? testEventFormFor(preset) : null;

  return (
    <>
      <div className="space-y-2 border-b pb-4">
        <Label htmlFor={id}>Trigger</Label>
        <TriggerPicker id={id} sections={sections} selectedId={selectedId} onSelect={onSelect} />
        {preset && (
          <p className="text-xs text-muted-foreground">
            {preset.description}
            <span className="mt-1 block font-mono text-muted-foreground/80">{preset.event}</span>
          </p>
        )}
      </div>

      {preset && Form ? (
        <Form key={preset.id} preset={preset} />
      ) : (
        // The picker stays on screen either way: a trigger that has gone is
        // replaced by choosing another, not by reopening the sheet.
        <p className="text-sm text-muted-foreground">
          {selectedId
            ? "That trigger is no longer registered on this instance. Pick another one above."
            : "Pick a trigger to fire."}
        </p>
      )}
    </>
  );
}
