import { api } from "@convex/_generated/api";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useCallback } from "react";
import type { StarterPacksGateway } from "@/engine/gateway";
import type { StarterPackInstall, StarterPackInstallOutcome } from "@/engine/types";
import { useInstanceAction, useScopeInstanceId } from "./scope";

// The packs themselves are the app's own (lib/starterPacks); Convex creates
// their commands and workflows on the engine and keeps a ledger of what each
// item made, which the status read checks against the engine's mirror.

type InstallOutcomeRow = FunctionReturnType<typeof api.starterPacks.install>["results"][number];

export function toStarterPackInstallOutcome(row: InstallOutcomeRow): StarterPackInstallOutcome {
  return { itemId: row.itemId, outcome: row.outcome, message: row.message };
}

function useStatus() {
  const instanceId = useScopeInstanceId();
  return useQuery(api.starterPacks.status, instanceId ? { instanceId } : "skip");
}

function useInstallRequest() {
  const install = useInstanceAction(api.starterPacks.install);
  return useCallback(
    async ({ packId, values }: StarterPackInstall) => {
      const { results } = await install({ packId, values });
      return results.map(toStarterPackInstallOutcome);
    },
    [install]
  );
}

export const convexStarterPacksGateway: StarterPacksGateway = {
  useStatus,
  useInstallRequest,
};
