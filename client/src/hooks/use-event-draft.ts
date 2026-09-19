import { useCallback, useSyncExternalStore } from "react";
import { type EventDraft, getDraft, subscribeToDrafts } from "@/lib/event-drafts";

/** The draft for one event, re-rendering whenever any draft changes. See lib/event-drafts.ts. */
export function useEventDraft(event: string): EventDraft | undefined {
  const getSnapshot = useCallback(() => getDraft(event), [event]);
  return useSyncExternalStore(subscribeToDrafts, getSnapshot);
}
