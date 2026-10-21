import { useEngineGateway } from "@/engine/context";
import type { ReadOptions } from "@/engine/types";

// What the dashboard does on the linked Twitch channel as its broadcaster.

/** Reads the channel's ad schedule. */
export function useAdScheduleRequest() {
  return useEngineGateway().adBreaks.useScheduleRequest();
}

export function useSnoozeNextAdRequest() {
  return useEngineGateway().adBreaks.useSnoozeRequest();
}

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

/** Messages worth pinning again, newest first. */
export function usePinHistory(options?: ReadOptions) {
  return useEngineGateway().pins.useHistory(options);
}

/** Reads what Twitch has pinned now; null when nothing is. */
export function useCurrentPinRequest() {
  return useEngineGateway().pins.useCurrentRequest();
}

/** Posts a message and pins it. */
export function usePinNewMessageRequest() {
  return useEngineGateway().pins.usePinNewRequest();
}

export function useRepinRequest() {
  return useEngineGateway().pins.useRepinRequest();
}

export function useUnpinRequest() {
  return useEngineGateway().pins.useUnpinRequest();
}

export function useRemovePinHistoryEntryRequest() {
  return useEngineGateway().pins.useRemoveFromHistoryRequest();
}

/** Channels waiting for a shoutout, in queue order. */
export function useShoutoutQueue(options?: ReadOptions) {
  return useEngineGateway().shoutouts.useQueue(options);
}

/** Finds the channel a login names, to confirm before queueing a shoutout. */
export function useLookupTwitchChannelRequest() {
  return useEngineGateway().shoutouts.useLookupRequest();
}

export function useEnqueueShoutoutRequest() {
  return useEngineGateway().shoutouts.useEnqueueRequest();
}

export function useRemoveShoutoutRequest() {
  return useEngineGateway().shoutouts.useRemoveRequest();
}

export function useReorderShoutoutsRequest() {
  return useEngineGateway().shoutouts.useReorderRequest();
}

/** Posts a chat message as the broadcaster. */
export function useSendChatMessageRequest() {
  return useEngineGateway().twitchChat.useSendMessageRequest();
}

export function useSendAnnouncementRequest() {
  return useEngineGateway().twitchChat.useSendAnnouncementRequest();
}

/** Shouts out a channel now, outside the queue. */
export function useSendShoutoutRequest() {
  return useEngineGateway().twitchChat.useSendShoutoutRequest();
}

/** Reads who is in chat now. */
export function useChattersRequest() {
  return useEngineGateway().twitchChat.useChattersRequest();
}

/** Clips the live stream. */
export function useCreateClipRequest() {
  return useEngineGateway().clips.useCreateRequest();
}

/** Reads the channel's title, category and tags. */
export function useStreamInfoRequest() {
  return useEngineGateway().streamInfo.useChannelRequest();
}

export function useSearchCategoriesRequest() {
  return useEngineGateway().streamInfo.useSearchCategoriesRequest();
}

/** Changes some of the channel's title, category and tags. */
export function useUpdateStreamInfoRequest() {
  return useEngineGateway().streamInfo.useUpdateRequest();
}

/** Marks the live stream's VOD. */
export function useCreateStreamMarkerRequest() {
  return useEngineGateway().streamInfo.useCreateMarkerRequest();
}

export function useStreamInfoPresets(options?: ReadOptions) {
  return useEngineGateway().streamInfo.usePresets(options);
}

export function useSaveStreamInfoPresetRequest() {
  return useEngineGateway().streamInfo.useSavePresetRequest();
}

export function useRemoveStreamInfoPresetRequest() {
  return useEngineGateway().streamInfo.useRemovePresetRequest();
}
