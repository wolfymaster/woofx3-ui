import { Loader2, Zap } from "lucide-react";
import type { FormEvent, ReactNode } from "react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useFireTestEvent } from "@/hooks/use-fire-test-event";
import type { TriggerPreset } from "@/lib/workflow-presets";

/** Props every test-event form takes. */
export interface TestEventProps {
  preset: TriggerPreset;
}

interface TestEventFormProps extends TestEventProps {
  /** The event data the fields describe, or null while they don't describe a valid one. */
  payload: object | null;
  children: ReactNode;
}

/**
 * One trigger's test settings and the button that fires it. The button sits below
 * the scrolling fields so it stays in reach however tall the form grows.
 */
export function TestEventForm({ preset, payload, children }: TestEventFormProps) {
  const fire = useFireTestEvent();
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (payload === null) {
      return;
    }
    setBusy(true);
    try {
      await fire(preset, payload);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-1 min-h-0 flex-col" data-testid={`test-event-form-${preset.id}`}>
      <div className="flex-1 overflow-y-auto space-y-4">{children}</div>
      <div className="mt-4 pt-4 border-t shrink-0">
        <Button
          type="submit"
          disabled={busy || payload === null}
          className="w-full gap-2"
          data-testid="button-trigger-test-event"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
          {busy ? "Triggering…" : "Trigger"}
        </Button>
      </div>
    </form>
  );
}
