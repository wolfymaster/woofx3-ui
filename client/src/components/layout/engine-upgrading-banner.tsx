import { Loader2 } from "lucide-react";
import { useEngineUpgrading } from "@/hooks/use-engine-upgrading";

/**
 * A strip under the shell header while the instance's managed engine is being
 * upgraded. Every page that talks to the engine fails for those minutes, and
 * without this the failures read as an outage.
 */
export function EngineUpgradingBanner() {
  const upgrading = useEngineUpgrading();
  if (!upgrading) {
    return null;
  }
  return (
    <div
      className="flex items-center gap-3 border-b border-blue-500/30 bg-blue-500/10 px-4 py-2 text-sm shrink-0"
      data-testid="banner-engine-upgrading"
    >
      <Loader2 className="h-4 w-4 shrink-0 animate-spin text-blue-500" />
      <p className="min-w-0 flex-1">Your engine is upgrading. It'll be back in a few minutes.</p>
    </div>
  );
}
