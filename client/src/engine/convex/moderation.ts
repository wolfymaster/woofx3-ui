import { api } from "@convex/_generated/api";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useCallback } from "react";
import type { ModerationGateway } from "@/engine/gateway";
import type {
  BlockedTerm,
  ChatSettings,
  ChatSettingsPatch,
  ModeratedUser,
  ModerationAccess,
  ReadOptions,
} from "@/engine/types";
import { withPlainError } from "./errors";
import { useMappedValue } from "./mapped";
import { useInstanceAction, useScopeInstanceId } from "./scope";

// Convex decides who may moderate from the caller's role and the link's
// scopes, then asks Twitch with the broadcaster token it holds, through the
// engine when the engine advertises `twitch.moderation`.

type AccessRow = NonNullable<FunctionReturnType<typeof api.moderation.access>>;
type BlockedTermRow = FunctionReturnType<typeof api.moderation.addBlockedTerm>;
type ModeratedUserRow = FunctionReturnType<typeof api.moderation.banUser>;
type ChatSettingsRow = FunctionReturnType<typeof api.moderation.getChatSettings>;

export function toModerationAccess(access: AccessRow): ModerationAccess {
  return {
    addBlockedTerm: access.addBlockedTerm,
    removeBlockedTerm: access.removeBlockedTerm,
    timeout: access.timeout,
    ban: access.ban,
    chatSettings: access.chatSettings,
  };
}

function toBlockedTerm(term: BlockedTermRow): BlockedTerm {
  return { id: term.id, text: term.text, createdAt: term.createdAt, expiresAt: term.expiresAt };
}

function toModeratedUser(user: ModeratedUserRow): ModeratedUser {
  return { login: user.login, displayName: user.displayName };
}

export function toChatSettings(settings: ChatSettingsRow): ChatSettings {
  return {
    emoteMode: settings.emoteMode,
    followerMode: settings.followerMode,
    followerModeDuration: settings.followerModeDuration,
    slowMode: settings.slowMode,
    slowModeWaitTime: settings.slowModeWaitTime,
    subscriberMode: settings.subscriberMode,
  };
}

function useAccess({ enabled = true }: ReadOptions = {}) {
  const instanceId = useScopeInstanceId();
  const access = useQuery(api.moderation.access, enabled && instanceId ? { instanceId } : "skip");
  return useMappedValue(access, toModerationAccess);
}

function useBlockedTermsRequest() {
  const listBlockedTerms = useInstanceAction(api.moderation.listBlockedTerms);
  return useCallback(async () => {
    const { terms, truncated } = await listBlockedTerms({}).catch(withPlainError);
    return { terms: terms.map(toBlockedTerm), truncated };
  }, [listBlockedTerms]);
}

function useAddBlockedTermRequest() {
  const addBlockedTerm = useInstanceAction(api.moderation.addBlockedTerm);
  return useCallback(
    async (text: string) => toBlockedTerm(await addBlockedTerm({ text }).catch(withPlainError)),
    [addBlockedTerm]
  );
}

function useRemoveBlockedTermRequest() {
  const removeBlockedTerm = useInstanceAction(api.moderation.removeBlockedTerm);
  return useCallback(
    async (termId: string) => {
      await removeBlockedTerm({ termId }).catch(withPlainError);
    },
    [removeBlockedTerm]
  );
}

function useTimeoutRequest() {
  const timeoutUser = useInstanceAction(api.moderation.timeoutUser);
  return useCallback(
    async (login: string, seconds: number) =>
      toModeratedUser(await timeoutUser({ login, seconds }).catch(withPlainError)),
    [timeoutUser]
  );
}

function useBanRequest() {
  const banUser = useInstanceAction(api.moderation.banUser);
  return useCallback(
    async (login: string, reason?: string) => toModeratedUser(await banUser({ login, reason }).catch(withPlainError)),
    [banUser]
  );
}

function useUnbanRequest() {
  const unbanUser = useInstanceAction(api.moderation.unbanUser);
  return useCallback(
    async (login: string) => toModeratedUser(await unbanUser({ login }).catch(withPlainError)),
    [unbanUser]
  );
}

function useChatSettingsRequest() {
  const getChatSettings = useInstanceAction(api.moderation.getChatSettings);
  return useCallback(async () => toChatSettings(await getChatSettings({}).catch(withPlainError)), [getChatSettings]);
}

function useUpdateChatSettingsRequest() {
  const updateChatSettings = useInstanceAction(api.moderation.updateChatSettings);
  return useCallback(
    async (patch: ChatSettingsPatch) => toChatSettings(await updateChatSettings({ patch }).catch(withPlainError)),
    [updateChatSettings]
  );
}

export const convexModerationGateway: ModerationGateway = {
  useAccess,
  useBlockedTermsRequest,
  useAddBlockedTermRequest,
  useRemoveBlockedTermRequest,
  useTimeoutRequest,
  useBanRequest,
  useUnbanRequest,
  useChatSettingsRequest,
  useUpdateChatSettingsRequest,
};
