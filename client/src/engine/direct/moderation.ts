import {
  ADDED_TERM_MISSING_MESSAGE,
  addedBlockedTerm,
  BLOCKED_TERMS_PAGE_SIZE,
  CAPABILITY_RULES,
  CHAT_SETTINGS_MISSING_MESSAGE,
  CHAT_SETTINGS_UPDATE_MISSING_MESSAGE,
  chatSettingsFromHelix,
  chatSettingsToHelix,
  collectBlockedTerms,
  MODERATION_SCOPES,
  type ModerationCapability,
  type ModerationOperation,
  NO_BLOCKED_TERM_MESSAGE,
  readModerationAnswer,
  resolveModerationTarget,
  validateBanReason,
  validateBlockedTerm,
  validateTimeoutSeconds,
} from "@shared/moderation";
import { readTwitchUserAnswer, type TwitchUser } from "@shared/twitch-users";
import { ENGINE_CAPABILITIES, type TwitchHelixResult } from "@woofx3/api";
import type { ModerationGateway } from "@/engine/gateway";
import type {
  BlockedTerm,
  BlockedTermList,
  ChatSettings,
  ChatSettingsPatch,
  ModeratedUser,
  ReadOptions,
} from "@/engine/types";
import type { DirectEngineApi } from "./connection";
import { toModeratedUser, toModerationAccess } from "./map/twitch";
import { useEngineQuery, useEngineRequest } from "./query";
import type { DirectRuntime } from "./runtime";
import { directTwitch, type LinkedTwitchAccount } from "./twitch";

/**
 * Blocked terms, timeouts and bans, and chat modes, through the engine's
 * `twitch.moderation` methods. The streamer holds the owner's role (see
 * `toModerationAccess`), so only the link's scopes ever refuse them.
 */
export function directModerationGateway(runtime: DirectRuntime): ModerationGateway {
  const twitch = directTwitch(runtime);

  const authorize = (capability: ModerationCapability) => twitch.authorize(CAPABILITY_RULES[capability].scope);

  const moderate = async (
    operation: ModerationOperation,
    method: Parameters<typeof twitch.helix>[1],
    invoke: (api: DirectEngineApi) => PromiseLike<TwitchHelixResult>
  ): Promise<unknown> =>
    readModerationAnswer(operation, await twitch.helix(ENGINE_CAPABILITIES.twitchModeration, method, invoke));

  const target = (account: LinkedTwitchAccount, login: string): Promise<TwitchUser> =>
    resolveModerationTarget(login, account.userId, async (normalized) =>
      readTwitchUserAnswer(
        await twitch.helix(ENGINE_CAPABILITIES.twitchModeration, "twitchGetUsers", (api) =>
          api.twitchGetUsers({ login: normalized })
        )
      )
    );

  const blockedTerms = async (): Promise<BlockedTermList> => {
    // Anyone who may add a term may see the list they are adding to.
    await authorize("addBlockedTerm");
    return collectBlockedTerms((cursor) =>
      moderate("list-terms", "twitchGetBlockedTerms", (api) =>
        api.twitchGetBlockedTerms({ first: BLOCKED_TERMS_PAGE_SIZE, ...(cursor ? { after: cursor } : {}) })
      )
    );
  };

  const addBlockedTerm = async (text: string): Promise<BlockedTerm> => {
    const validated = validateBlockedTerm(text);
    if (!validated.ok) {
      throw new Error(validated.error);
    }
    await authorize("addBlockedTerm");
    const body = await moderate("add-term", "twitchAddBlockedTerm", (api) =>
      api.twitchAddBlockedTerm({ text: validated.value })
    );
    const term = addedBlockedTerm(body);
    if (!term) {
      throw new Error(ADDED_TERM_MISSING_MESSAGE);
    }
    return term;
  };

  const removeBlockedTerm = async (termId: string): Promise<void> => {
    if (!termId) {
      throw new Error(NO_BLOCKED_TERM_MESSAGE);
    }
    await authorize("removeBlockedTerm");
    await moderate("remove-term", "twitchRemoveBlockedTerm", (api) => api.twitchRemoveBlockedTerm({ id: termId }));
  };

  const timeout = async (login: string, seconds: number): Promise<ModeratedUser> => {
    const duration = validateTimeoutSeconds(seconds);
    if (!duration.ok) {
      throw new Error(duration.error);
    }
    const viewer = await target(await authorize("timeout"), login);
    await moderate("timeout", "twitchBanUser", (api) =>
      api.twitchBanUser({ user_id: viewer.twitchUserId, duration: duration.value })
    );
    return toModeratedUser(viewer);
  };

  const ban = async (login: string, reason?: string): Promise<ModeratedUser> => {
    const validated = validateBanReason(reason ?? "");
    if (!validated.ok) {
      throw new Error(validated.error);
    }
    const viewer = await target(await authorize("ban"), login);
    await moderate("ban", "twitchBanUser", (api) =>
      api.twitchBanUser({ user_id: viewer.twitchUserId, reason: validated.value })
    );
    return toModeratedUser(viewer);
  };

  /** Lifts a ban or an active timeout; Helix treats both the same. */
  const unban = async (login: string): Promise<ModeratedUser> => {
    const viewer = await target(await authorize("ban"), login);
    await moderate("unban", "twitchUnbanUser", (api) => api.twitchUnbanUser({ user_id: viewer.twitchUserId }));
    return toModeratedUser(viewer);
  };

  /**
   * Reading needs only the read scope every link already carries, so the
   * switches show the real state even before a reconnect grants permission
   * to flip them.
   */
  const chatSettings = async (): Promise<ChatSettings> => {
    await twitch.authorize(MODERATION_SCOPES.readChatSettings);
    const settings = chatSettingsFromHelix(
      await moderate("read-settings", "twitchGetChatSettings", (api) => api.twitchGetChatSettings())
    );
    if (!settings) {
      throw new Error(CHAT_SETTINGS_MISSING_MESSAGE);
    }
    return settings;
  };

  const updateChatSettings = async (patch: ChatSettingsPatch): Promise<ChatSettings> => {
    const body = chatSettingsToHelix(patch);
    if (!body.ok) {
      throw new Error(body.error);
    }
    await authorize("chatSettings");
    const settings = chatSettingsFromHelix(
      await moderate("update-settings", "twitchUpdateChatSettings", (api) => api.twitchUpdateChatSettings(body.value))
    );
    if (!settings) {
      throw new Error(CHAT_SETTINGS_UPDATE_MISSING_MESSAGE);
    }
    return settings;
  };

  return {
    useAccess: ({ enabled = true }: ReadOptions = {}) =>
      useEngineQuery(runtime, twitch.linkRead, { enabled, select: toModerationAccess }),
    useBlockedTermsRequest: () => useEngineRequest(blockedTerms),
    useAddBlockedTermRequest: () => useEngineRequest(addBlockedTerm),
    useRemoveBlockedTermRequest: () => useEngineRequest(removeBlockedTerm),
    useTimeoutRequest: () => useEngineRequest(timeout),
    useBanRequest: () => useEngineRequest(ban),
    useUnbanRequest: () => useEngineRequest(unban),
    useChatSettingsRequest: () => useEngineRequest(chatSettings),
    useUpdateChatSettingsRequest: () => useEngineRequest(updateChatSettings),
  };
}
