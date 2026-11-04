import { ENGINE_CAPABILITIES } from "@woofx3/api/capabilities";
import { MODERATION_ACTIONS_DEFAULT_LIMIT } from "@woofx3/api/moderation-config";
import type { ChatModerationGateway } from "@/engine/gateway";
import type { ChatModerationRead, ModerationConfig } from "@/engine/types";
import { useEngineRequest } from "./query";
import type { DirectRuntime } from "./runtime";

/** Chat moderation, straight to the engine's moderation methods. The engine has one owner when driven directly. */
export function directChatModerationGateway(runtime: DirectRuntime): ChatModerationGateway {
  const config = async (): Promise<ChatModerationRead> => {
    const { capabilities } = await runtime.call("getEngineCapabilities", (api) => api.getEngineCapabilities());
    if (!capabilities.includes(ENGINE_CAPABILITIES.moderationConfig)) {
      return { kind: "unsupported" };
    }
    return { kind: "ready", config: await runtime.call("getModerationConfig", (api) => api.getModerationConfig()) };
  };

  const setConfig = (next: ModerationConfig) =>
    runtime.call("setModerationConfig", (api) => api.setModerationConfig(next));

  const recentActions = (limit: number = MODERATION_ACTIONS_DEFAULT_LIMIT) =>
    runtime.call("listModerationActions", (api) => api.listModerationActions(limit));

  return {
    useConfigRequest: () => useEngineRequest(config),
    useSetConfigRequest: () => useEngineRequest(setConfig),
    useRecentActionsRequest: () => useEngineRequest(recentActions),
  };
}
