import { useCallback, useMemo } from "react";
import { useWorkflowCatalog } from "@/hooks/use-workflow-catalog";
import { alertEventType } from "@/lib/alert-envelope";
import { type AlertSummary, describeAlert } from "@/lib/alert-summary";
import type { TriggerPreset } from "@/lib/workflow-presets";

/**
 * Every installed trigger by the event type it fires on, first one wins. Every
 * trigger counts, not only those the Alerts menu lists: a workflow can play an
 * alert from any event, and the Events widget shows any event.
 */
export function useTriggersByEvent(): ReadonlyMap<string, TriggerPreset> {
  const { triggerPresets } = useWorkflowCatalog();
  return useMemo(() => {
    const triggers = new Map<string, TriggerPreset>();
    for (const preset of triggerPresets) {
      if (preset.event && !triggers.has(preset.event)) {
        triggers.set(preset.event, preset);
      }
    }
    return triggers;
  }, [triggerPresets]);
}

/** Reads an alert's stored payload as a summary row, through the trigger of the event that fired it. */
export function useDescribeAlert(): (payload: string | undefined) => AlertSummary {
  const byEvent = useTriggersByEvent();
  return useCallback(
    (payload: string | undefined) => describeAlert(payload, byEvent.get(alertEventType(payload) ?? "")),
    [byEvent]
  );
}
