import { useEffect, useState } from "react";
import { currentIntegrations, type IntegrationsView, onIntegrationsChange } from "./state";

const OFF: IntegrationsView = {
  availability: { kind: "off" },
  relayAvailable: false,
  relay: { kind: "notNeeded" },
  modules: [],
};

/** Follows the Rust process's integrations view, the same way `useWindowState` follows the pairing state. */
export function useIntegrations(): IntegrationsView {
  const [view, setView] = useState<IntegrationsView>(OFF);
  useEffect(() => {
    let disposed = false;
    let eventSeen = false;
    let unlisten: (() => void) | null = null;
    onIntegrationsChange((next) => {
      eventSeen = true;
      setView(next);
    }).then((stop) => {
      if (disposed) {
        stop();
      } else {
        unlisten = stop;
      }
    });
    currentIntegrations().then((initial) => {
      if (!disposed && !eventSeen) {
        setView(initial);
      }
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);
  return view;
}
