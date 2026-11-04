import { useStore } from "@nanostores/react";
import { useEffect, useState } from "react";
import { useEngineGateway, useEngineScope } from "@/engine/context";
import type { ObsStatus } from "@/engine/types";
import { $documentVisible } from "@/lib/stores";

/**
 * Often enough that fixing a password in OBS shows within a few seconds, and
 * cheap: the engine answers from memory without touching OBS.
 */
const POLL_MS = 5_000;

export interface ObsStatusResult {
  /** Null until the first answer, and while disabled. */
  status: ObsStatus | null;
}

/**
 * The engine's OBS connection state, asked every few seconds while `enabled`
 * and the tab is visible. The state lives on the engine and nothing pushes
 * it, so this polls rather than subscribes.
 */
export function useObsStatus(enabled: boolean): ObsStatusResult {
  const { instanceId } = useEngineScope();
  const getStatus = useEngineGateway().status.useObsStatusRequest();
  const visible = useStore($documentVisible);
  const [status, setStatus] = useState<ObsStatus | null>(null);
  const active = Boolean(instanceId) && enabled && visible;

  useEffect(() => {
    if (!active || !instanceId) {
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const next = await getStatus();
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

  return { status: active ? status : null };
}
