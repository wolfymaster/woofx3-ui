import { useEffect, useRef } from "react";
import { useInstance } from "@/hooks/use-instance";
import { transport } from "@/lib/transport";
import { frameToPlatformEvent } from "./engine-events";
import type { PlatformEvent, PlatformEventType } from "./types";

// Widget-facing entry point for realtime platform events. Events arrive from
// the engine over the capnweb session the transport already holds, rather than
// from a per-tab connection to the platform: one socket instead of one per tab,
// and one CloudEvent vocabulary shared with every other engine surface.
//
// Each call is a "virtual" subscription — the transport keeps a single engine
// subscription and fans out locally, so N widgets asking for "follow" still
// produce one registration.
export function usePlatformEvents(eventTypes: PlatformEventType[], onEvent: (event: PlatformEvent) => void): void {
  const { instance } = useInstance();

  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  const eventTypesRef = useRef(eventTypes);
  eventTypesRef.current = eventTypes;
  const eventTypesKey = eventTypes.join(",");

  const instanceId = instance?._id;

  // eventTypesRef/onEventRef intentionally excluded from deps — refs are
  // stable and read at call time. eventTypesKey isn't referenced in the body
  // either; it's a content-based stand-in for eventTypes (whose array
  // identity changes every render) so the effect only re-subscribes when the
  // requested types actually change.
  // biome-ignore lint/correctness/useExhaustiveDependencies: eventTypesKey is a deliberate content-key, not an oversight
  useEffect(() => {
    if (!instanceId) {
      return;
    }
    return transport.subscribeStreamEvents(instanceId, (frame) => {
      const event = frameToPlatformEvent(frame);
      if (event && eventTypesRef.current.includes(event.type)) {
        onEventRef.current(event);
      }
    });
  }, [instanceId, eventTypesKey]);
}
