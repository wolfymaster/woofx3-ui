import { useCallback, useEffect, useRef, useState } from "react";
import { useEngineGateway, useEngineScope } from "@/engine/context";
import type { ModuleStorageUsage } from "@/engine/types";

/**
 * How much module storage the instance's modules use against the plan's
 * limit, or null when no limit applies, the engine cannot say, or the read
 * failed: the limit is never enforced, so this only decides whether to warn.
 */
export function useModuleStorageUsage() {
  const { instanceId } = useEngineScope();
  const read = useEngineGateway().modules.useStorageUsageRequest();
  const [usage, setUsage] = useState<ModuleStorageUsage | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const requestSeq = useRef(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reloadToken is how refresh() asks for a re-read
  useEffect(() => {
    if (!instanceId) {
      setUsage(null);
      return;
    }
    const seq = ++requestSeq.current;
    void read()
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
