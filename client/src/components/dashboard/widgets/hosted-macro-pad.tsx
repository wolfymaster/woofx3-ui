import { api } from "@convex/_generated/api";
import { useQuery } from "convex/react";
import { useMemo } from "react";
import type { Macro } from "@/engine/types";
import { useInstance } from "@/hooks/use-instance";
import { macroTriggerStatusLabel } from "@/lib/macro-trigger-examples";
import { MacroPad } from "./macro-pad";
import type { MacroPadRemoteTriggers } from "./macro-pad-remote-triggers";
import { MacroRemoteTrigger } from "./macro-remote-trigger";

// The hosted app's macro pad: the pad plus its macros' remote trigger URLs,
// which Convex serves (convex/macroTriggers.ts) and so only the hosted app
// may load.

function RemoteTriggerSection({ macro }: { macro: Macro }) {
  const { instance } = useInstance();
  if (!instance) {
    return null;
  }
  return <MacroRemoteTrigger instanceId={instance._id} macro={macro} />;
}

function useHostedRemoteTriggers(): MacroPadRemoteTriggers {
  const { instance } = useInstance();
  const status = useQuery(api.macroTriggers.listForInstance, instance ? { instanceId: instance._id } : "skip");
  return useMemo(() => {
    const statuses: Record<string, string> = {};
    for (const trigger of status?.triggers ?? []) {
      statuses[trigger.macroId] = macroTriggerStatusLabel(trigger);
    }
    return { canManage: status?.canManage, statuses, EditorSection: RemoteTriggerSection };
  }, [status]);
}

export function HostedMacroPadWidget() {
  return <MacroPad useRemoteTriggers={useHostedRemoteTriggers} />;
}
