import { api } from "@convex/_generated/api";
import { useCallback } from "react";
import type { ChatModerationGateway } from "@/engine/gateway";
import type { ModerationConfig } from "@/engine/types";
import { withPlainError } from "./errors";
import { useInstanceAction } from "./scope";

// The engine holds the config; Convex relays each call to it and keeps nothing.

function useConfigRequest() {
  const getConfig = useInstanceAction(api.chatModerationActions.getConfig);
  return useCallback(() => getConfig({}).catch(withPlainError), [getConfig]);
}

function useSetConfigRequest() {
  const setConfig = useInstanceAction(api.chatModerationActions.setConfig);
  return useCallback((config: ModerationConfig) => setConfig({ config }).catch(withPlainError), [setConfig]);
}

function useRecentActionsRequest() {
  const listRecentActions = useInstanceAction(api.chatModerationActions.listRecentActions);
  return useCallback(
    (limit?: number) => listRecentActions(limit === undefined ? {} : { limit }).catch(withPlainError),
    [listRecentActions]
  );
}

export const convexChatModerationGateway: ChatModerationGateway = {
  useConfigRequest,
  useSetConfigRequest,
  useRecentActionsRequest,
};
