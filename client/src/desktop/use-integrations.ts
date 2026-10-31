import { useEffect, useState } from "react";
import { companionLinkStatus, type IntegrationsView, integrations, onIntegrationsChange } from "./host";

const OFF: IntegrationsView = {
  availability: { kind: "off" },
  relayAvailable: false,
  relay: { kind: "notNeeded" },
  modules: [],
};

/** Follows the host's picture of this computer's local connections. */
export function useIntegrations(): IntegrationsView {
  const [view, setView] = useState<IntegrationsView>(OFF);
  useEffect(() => {
    let disposed = false;
    let eventSeen = false;
    const unlisten = onIntegrationsChange((next) => {
      eventSeen = true;
      setView(next);
    });
    integrations().then(
      (current) => {
        if (!disposed && !eventSeen) {
          setView(current);
        }
      },
      (err: unknown) => {
        console.error("Couldn't read this computer's local connections from the host", err);
      }
    );
    return () => {
      disposed = true;
      void unlisten.then((stop) => stop());
    };
  }, []);
  return view;
}

/**
 * The host's view when this computer is `instanceId`'s linked computer, else
 * null. The host only knows the instance it is linked to, and module ids repeat
 * across instances, so a view for another instance must not be read as this one's.
 */
export function useIntegrationsFor(instanceId: string | undefined): IntegrationsView | null {
  const view = useIntegrations();
  const [linkedInstanceId, setLinkedInstanceId] = useState<string | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: linking starts and ends the host's view, so each new view asks again.
  useEffect(() => {
    let disposed = false;
    companionLinkStatus().then(
      (status) => {
        if (!disposed) {
          setLinkedInstanceId(status.linked?.instanceId ?? null);
        }
      },
      (err: unknown) => {
        console.error("Couldn't read which instance this computer is linked to", err);
      }
    );
    return () => {
      disposed = true;
    };
  }, [view]);
  return instanceId !== undefined && linkedInstanceId === instanceId ? view : null;
}
