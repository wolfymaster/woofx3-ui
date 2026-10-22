import { useEngineGateway } from "@/engine/context";
import type { ReadOptions } from "@/engine/types";

/** What the caller may moderate now, per capability; null when they cannot see the instance. */
export function useModerationAccess(options?: ReadOptions) {
  return useEngineGateway().moderation.useAccess(options);
}

export function useBlockedTermsRequest() {
  return useEngineGateway().moderation.useBlockedTermsRequest();
}

export function useAddBlockedTermRequest() {
  return useEngineGateway().moderation.useAddBlockedTermRequest();
}

export function useRemoveBlockedTermRequest() {
  return useEngineGateway().moderation.useRemoveBlockedTermRequest();
}

export function useTimeoutUserRequest() {
  return useEngineGateway().moderation.useTimeoutRequest();
}

export function useBanUserRequest() {
  return useEngineGateway().moderation.useBanRequest();
}

/** Lifts a ban or a timeout. */
export function useUnbanUserRequest() {
  return useEngineGateway().moderation.useUnbanRequest();
}

export function useChatSettingsRequest() {
  return useEngineGateway().moderation.useChatSettingsRequest();
}

export function useUpdateChatSettingsRequest() {
  return useEngineGateway().moderation.useUpdateChatSettingsRequest();
}
