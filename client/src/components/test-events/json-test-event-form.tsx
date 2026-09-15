import { useMemo, useState } from "react";
import { TestEventForm, type TestEventProps } from "@/components/test-events/test-event-form";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { examplePayloadFromShape } from "@/lib/test-event-payload";

type ParsedPayload = { ok: true; payload: object } | { ok: false; error: string };

function parsePayload(text: string): ParsedPayload {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Not valid JSON." };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, error: "Event data must be a JSON object." };
  }
  return { ok: true, payload: value };
}

/**
 * The test form for a trigger with no hand-built one: the event data as JSON,
 * seeded from the trigger's declared `emits` shape when it has one.
 */
export function JsonTestEventForm({ preset }: TestEventProps) {
  const emits = preset.emits ?? [];
  const [text, setText] = useState(() => JSON.stringify(examplePayloadFromShape(emits), null, 2));
  const parsed = useMemo(() => parsePayload(text), [text]);

  return (
    <TestEventForm preset={preset} payload={parsed.ok ? parsed.payload : null}>
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
        {parsed.ok ? (
          <p className="text-xs text-muted-foreground">
            {emits.length > 0
              ? "Pre-filled from the fields this trigger says it sends."
              : "This trigger doesn't describe what it sends — add the fields your workflow reads."}
          </p>
        ) : (
          <p className="text-xs text-destructive">{parsed.error}</p>
        )}
      </div>
    </TestEventForm>
  );
}
