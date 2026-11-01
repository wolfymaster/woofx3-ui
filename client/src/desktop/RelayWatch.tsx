import type { RelayView } from "@desktop-host/window";
import { useEffect, useRef, useState } from "react";
import { $relayLimitation } from "@/lib/relay-limitation";
import { integrations, onIntegrationsChange, reconnectRelay } from "./host";
import { RELAY_GRACE_MS, relayCondition, relayDownSince } from "./relay-condition";

/**
 * Keeps the status bar's picture of the relay current. It renders nothing:
 * the relay's state lives in the host, and only this desktop-only component
 * may talk to the host, so the shared status bar reads a store instead.
 */
export default function RelayWatch() {
  const [view, setView] = useState<RelayView | null>(null);
  const downSince = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const unlisten = onIntegrationsChange((next) => setView(next.relay));
    integrations().then(
      (current) => {
        if (!cancelled) {
          setView(current.relay);
        }
      },
      (err: unknown) => {
        console.error("Couldn't read the relay's state from the host", err);
      }
    );
    return () => {
      cancelled = true;
      void unlisten.then((stop) => stop());
    };
  }, []);

  useEffect(() => {
    if (!view) {
      return;
    }
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
