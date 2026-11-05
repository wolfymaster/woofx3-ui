import { useCallback } from "react";
import { useEngineGateway, useEngineScope } from "@/engine/context";
import type { ChatModerationRead, Fetched, ModerationActionRecord, ModerationConfig } from "@/engine/types";
import { useFetched } from "./use-fetched";

export interface ModerationConfigState {
  read: Fetched<ChatModerationRead>;
  /** Saves `config` and reads it back; rejects with the engine's first problem with it. */
  save: (config: ModerationConfig) => Promise<ModerationConfig>;
}

/** The instance's chat moderation config, read again after each save. */
export function useModerationConfig(): ModerationConfigState {
  const gateway = useEngineGateway().chatModeration;
  const getConfig = gateway.useConfigRequest();
  const setConfig = gateway.useSetConfigRequest();
  const { instanceId } = useEngineScope();
  const read = useFetched(getConfig, instanceId === null ? "skip" : { instanceId });
  const { refetch } = read;
  const save = useCallback(
    async (config: ModerationConfig) => {
      const saved = await setConfig(config);
      refetch();
      return saved;
    },
    [setConfig, refetch]
  );
  return { read, save };
}

/** The latest moderated lines, newest first; `refetch` reads them again. */
export function useRecentModerationActions(limit?: number): Fetched<ModerationActionRecord[]> {
  const listRecentActions = useEngineGateway().chatModeration.useRecentActionsRequest();
  const { instanceId } = useEngineScope();
  const request = useCallback((args: { limit?: number }) => listRecentActions(args.limit), [listRecentActions]);
  return useFetched(request, instanceId === null ? "skip" : { instanceId, ...(limit === undefined ? {} : { limit }) });
}
