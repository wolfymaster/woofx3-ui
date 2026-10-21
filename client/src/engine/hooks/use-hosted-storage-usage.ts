import { useCallback, useEffect, useRef, useState } from "react";
import { useEngineGateway } from "@/engine/context";
import type { HostedStorageUsage, InstanceId } from "@/engine/types";

/**
 * How much of the plan's hosted asset storage the instance uses, or null when
 * it is not on hosted storage (or the read failed: the meter is informational,
 * and uploads are checked on the server either way).
 *
 * Fetched through an action for the same reason as `useResources`: the usage
 * is the engine's, so callers `refresh()` after anything that changes it.
 */
export function useHostedStorageUsage(instanceId: InstanceId | null) {
  const read = useEngineGateway().resources.useHostedStorageUsageRequest();
  const [usage, setUsage] = useState<HostedStorageUsage | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const requestSeq = useRef(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reloadToken is how refresh() asks for a re-read
  useEffect(() => {
    if (!instanceId) {
      setUsage(null);
      return;
    }
    const seq = ++requestSeq.current;
    void read(instanceId)
      .then((result) => {
        if (seq === requestSeq.current) {
          setUsage(result);
        }
      })
      .catch(() => {
        if (seq === requestSeq.current) {
          setUsage(null);
        }
      });
  }, [instanceId, read, reloadToken]);

  const refresh = useCallback(() => setReloadToken((token) => token + 1), []);

  return { usage, refresh };
}
