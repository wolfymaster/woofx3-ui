import { useEffect, useRef } from "react";
import { $relayLimitation } from "@/lib/relay-limitation";
import { reconnectRelay } from "./host";
import { RELAY_GRACE_MS, relayCondition, relayDownSince } from "./relay-condition";
import { useIntegrations } from "./use-integrations";

/**
 * Keeps the status bar's picture of the relay current. It renders nothing:
 * the relay's state lives in the host, and only this desktop-only component
 * may talk to the host, so the shared status bar reads a store instead.
 */
export default function RelayWatch() {
  const { relay: view } = useIntegrations();
  const downSince = useRef<number | null>(null);

  useEffect(() => {
    const publish = () => {
      const condition = relayCondition(view, downSince.current, Date.now());
      $relayLimitation.set(
        condition.kind === "limited"
          ? { detail: condition.detail, reconnect: condition.canReconnect ? reconnectRelay : null }
          : null
      );
    };
    downSince.current = relayDownSince(view, downSince.current, Date.now());
    publish();
    if (downSince.current === null) {
      return;
    }
    const timer = setTimeout(publish, Math.max(0, downSince.current + RELAY_GRACE_MS - Date.now()));
    return () => clearTimeout(timer);
  }, [view]);

  useEffect(() => () => $relayLimitation.set(null), []);

  return null;
}
