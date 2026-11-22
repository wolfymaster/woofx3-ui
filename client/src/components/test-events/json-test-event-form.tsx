import { useMemo, useState } from "react";
import { AdvancedDisclosure } from "@/components/alerts/advanced-disclosure";
import { TestEventForm, type TestEventProps } from "@/components/test-events/test-event-form";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { parseEventData } from "@/lib/test-event-json";
import { examplePayloadFromShape } from "@/lib/test-event-payload";

/**
 * The test form for a trigger that declares nothing about what it emits: the
 * event data as JSON, for the person who knows what their workflow reads.
 *
 * A trigger that declares an `emits` shape gets labelled fields instead — see
 * ShapeTestEventForm.
 */
export function JsonTestEventForm({ preset, runner }: TestEventProps) {
  const emits = preset.emits ?? [];
  const [text, setText] = useState(() => JSON.stringify(examplePayloadFromShape(emits), null, 2));
  const parsed = useMemo(() => parseEventData(text), [text]);

  return (
    <TestEventForm preset={preset} runner={runner} payload={parsed.ok ? parsed.payload : null}>
      <AdvancedDisclosure testId="test-event-advanced">
        <div className="space-y-2">
          <Label htmlFor="test-event-payload">Event data</Label>
          <Textarea
            id="test-event-payload"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={12}
            spellCheck={false}
            className="font-mono text-xs"
            data-testid="textarea-test-event-payload"
          />
          {!parsed.ok && <p className="text-xs text-destructive">{parsed.error}</p>}
        </div>
      </AdvancedDisclosure>
    </TestEventForm>
  );
}
