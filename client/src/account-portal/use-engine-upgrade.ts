import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { UpgradeInfo } from "@convex/provisioning";
import { useAction } from "convex/react";
import { useEffect, useState } from "react";
import { useLogger } from "@/lib/logger-context";

/**
 * The release a hosted engine runs and whether a newer one is on offer; null while unasked, for an engine that is not
 * hosted or running, or when the lookup failed (it only decorates the engine, so it never blocks the page).
 */
export function useEngineUpgrade(instanceId: Id<"instances">, enabled: boolean): UpgradeInfo | null {
  const upgradeInfo = useAction(api.provisioning.upgradeInfo);
  const logger = useLogger();
  const [info, setInfo] = useState<UpgradeInfo | null>(null);
  useEffect(() => {
    if (!enabled) {
      return;
    }
    let current = true;
    upgradeInfo({ instanceId }).then(
      (answer) => {
        if (current) {
          setInfo(answer);
        }
      },
      (error: unknown) => logger.warn("Could not check the engine's release", { error, instanceId })
    );
    return () => {
      current = false;
    };
  }, [upgradeInfo, instanceId, enabled, logger]);
  return info;
}
