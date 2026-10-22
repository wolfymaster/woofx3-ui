import { useEngineGateway } from "@/engine/context";
import type { ReadOptions } from "@/engine/types";

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
