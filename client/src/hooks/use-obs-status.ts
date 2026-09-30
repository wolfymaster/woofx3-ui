import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { ObsStatus } from "@convex/lib/engineObsStatus";
import { useStore } from "@nanostores/react";
import { useAction } from "convex/react";
import { useEffect, useState } from "react";
import { useEngineCapabilities } from "@/hooks/use-engine-capabilities";
import type { CapabilitySupport } from "@/lib/engine-capabilities";
import { $documentVisible } from "@/lib/stores";

/**
 * Often enough that fixing a password in OBS shows within a few seconds, and
 * cheap: the engine answers from memory without touching OBS.
 */
const POLL_MS = 5_000;

export interface ObsStatusResult {
  /** Whether the engine can report its OBS connection at all. */
  support: CapabilitySupport;
  /** Null until the first answer, and while unsupported or disabled. */
  status: ObsStatus | null;
}

/**
 * The engine's OBS connection state, asked every few seconds while `enabled`
 * and the tab is visible. The state lives on the engine and nothing pushes
 * it, so this polls rather than subscribes.
 */
export function useObsStatus(instanceId: Id<"instances"> | undefined, enabled: boolean): ObsStatusResult {
  const support = useEngineCapabilities(instanceId).support("obs.status");
  const getStatus = useAction(api.obsStatus.get);
  const visible = useStore($documentVisible);
  const [status, setStatus] = useState<ObsStatus | null>(null);
  const active = Boolean(instanceId) && enabled && support === "supported" && visible;

  useEffect(() => {
    if (!active || !instanceId) {
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const next = await getStatus({ instanceId });
        if (!cancelled) {
          setStatus(next);
        }
      } catch {
        if (!cancelled) {
          setStatus({ state: "unanswered", failure: null, address: null });
        }
      }
      if (!cancelled) {
        timer = setTimeout(() => void poll(), POLL_MS);
      }
    };
    void poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [active, instanceId, getStatus]);

  return { support, status: active ? status : null };
}
