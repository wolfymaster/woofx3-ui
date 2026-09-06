import { api } from "@convex/_generated/api";
import { useQuery } from "convex/react";
import { useEffect, useRef } from "react";
import { useInstance } from "@/hooks/use-instance";
import { getTwitchClient } from "./twitch-client";
import type { PlatformEvent, PlatformEventType } from "./types";

// Widget-facing entry point for the direct-to-platform realtime layer. Each
// call is a "virtual" subscription — under the hood every widget on the page
// shares the same per-instance TwitchEventSubClient (see ./twitch-client),
// which ref-counts so N widgets asking for "follow" only open one real
// Twitch subscription. Aggregates across every platform connected for the
// instance (currently just Twitch; more platforms plug in here later).
export function usePlatformEvents(eventTypes: PlatformEventType[], onEvent: (event: PlatformEvent) => void): void {
  const { instance } = useInstance();
  const platformLinks = useQuery(api.instances.getPlatformLinks, instance ? { instanceId: instance._id } : "skip");

  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  const eventTypesRef = useRef(eventTypes);
  eventTypesRef.current = eventTypes;
  const eventTypesKey = eventTypes.join(",");

  const hasTwitch = !!platformLinks?.some((link) => link.platform === "twitch");

  // eventTypesRef/onEventRef intentionally excluded from deps — refs are
  // stable and read at call time. eventTypesKey isn't referenced in the body
  // either; it's a content-based stand-in for eventTypes (whose array
  // identity changes every render) so the effect only re-subscribes when the
  // requested types actually change.
  // biome-ignore lint/correctness/useExhaustiveDependencies: eventTypesKey is a deliberate content-key, not an oversight
  useEffect(() => {
    if (!instance || !hasTwitch) {
      return;
    }
    const client = getTwitchClient(instance._id);
    const unsubscribes = eventTypesRef.current.map((eventType) =>
      client.subscribe(eventType, (event) => onEventRef.current(event))
    );
    return () => {
      for (const unsubscribe of unsubscribes) {
        unsubscribe();
      }
    };
  }, [instance, hasTwitch, eventTypesKey]);
}
