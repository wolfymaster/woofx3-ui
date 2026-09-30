import { api } from "@convex/_generated/api";
import { useQuery } from "convex/react";
import { useEffect, useRef } from "react";
import { useInstance } from "@/hooks/use-instance";
import { transport } from "@/lib/transport";

/**
 * Whether the current instance's managed engine is down for an upgrade. The
 * engine is unreachable for those minutes on purpose, so the shell says so
 * rather than reporting a lost connection.
 */
export function useEngineUpgrading(): boolean {
  const { instance } = useInstance();
  const provisioning = useQuery(
    api.provisioning.forInstance,
    instance?.hosting === "managed" ? { instanceId: instance._id } : "skip"
  );
  return provisioning?.status === "upgrading";
}

/**
 * Reconnects to the engine the moment its upgrade ends. The transport has been
 * failing to connect for minutes by then, so its next attempt is up to half a
 * minute away, while the row leaving `upgrading` means the engine is already
 * answering on its public address.
 */
export function useReconnectAfterUpgrade(): void {
  const upgrading = useEngineUpgrading();
  const wasUpgrading = useRef(false);

  useEffect(() => {
    if (wasUpgrading.current && !upgrading) {
      transport.reconnectNow();
    }
    wasUpgrading.current = upgrading;
  }, [upgrading]);
}
