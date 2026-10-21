import { api } from "@convex/_generated/api";
import type { OptimisticLocalStore } from "convex/browser";
import { useQuery } from "convex/react";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import { useCallback } from "react";
import type { StreamInfoGateway } from "@/engine/gateway";
import type {
  KnownBoxArt,
  NewStreamInfoPreset,
  ReadOptions,
  StreamCategory,
  StreamInfo,
  StreamInfoChanges,
  StreamInfoPreset,
  StreamInfoPresetId,
} from "@/engine/types";
import { withPlainError } from "./errors";
import { fromStreamInfoPresetId, toStreamInfoPresetId } from "./ids";
import { useMappedList } from "./mapped";
import { useInstanceAction, useInstanceMutation, useScopeInstanceId } from "./scope";

// Convex keeps the presets, and reads and writes the channel with the
// broadcaster token it holds, through the engine when the engine advertises
// `twitch.streamInfo`.

type StreamInfoRow = FunctionReturnType<typeof api.streamInfo.getChannelInfo>;
type CategoryRow = FunctionReturnType<typeof api.streamInfo.searchCategories>[number];
type PresetRow = FunctionReturnType<typeof api.streamInfo.listPresets>[number];

function toStreamCategory(category: CategoryRow): StreamCategory {
  return { id: category.id, name: category.name, boxArtUrl: category.boxArtUrl };
}

export function toStreamInfo(info: StreamInfoRow): StreamInfo {
  return {
    title: info.title,
    category: info.category ? toStreamCategory(info.category) : null,
    tags: info.tags,
  };
}

export function toStreamInfoPreset(row: PresetRow): StreamInfoPreset {
  return { id: toStreamInfoPresetId(row.id), name: row.name, info: toStreamInfo(row.info) };
}

/** Drops a removed preset from the list at once, so the row does not linger until the mutation lands. */
export function removePresetOptimistically(
  localStore: OptimisticLocalStore,
  args: FunctionArgs<typeof api.streamInfo.removePreset>
): void {
  const list = localStore.getQuery(api.streamInfo.listPresets, { instanceId: args.instanceId });
  if (list) {
    localStore.setQuery(
      api.streamInfo.listPresets,
      { instanceId: args.instanceId },
      list.filter((preset) => preset.id !== args.presetId)
    );
  }
}

function useChannelRequest() {
  const getChannelInfo = useInstanceAction(api.streamInfo.getChannelInfo);
  return useCallback(
    async (knownBoxArt?: KnownBoxArt) => toStreamInfo(await getChannelInfo({ knownBoxArt }).catch(withPlainError)),
    [getChannelInfo]
  );
}

function useSearchCategoriesRequest() {
  const searchCategories = useInstanceAction(api.streamInfo.searchCategories);
  return useCallback(
    async (query: string) => (await searchCategories({ query }).catch(withPlainError)).map(toStreamCategory),
    [searchCategories]
  );
}

function useUpdateRequest() {
  const updateChannelInfo = useInstanceAction(api.streamInfo.updateChannelInfo);
  return useCallback(
    async ({ title, category, tags }: StreamInfoChanges) => {
      const { info, unapplied } = await updateChannelInfo({ title, category, tags }).catch(withPlainError);
      return { info: toStreamInfo(info), unapplied };
    },
    [updateChannelInfo]
  );
}

function useCreateMarkerRequest() {
  const createMarker = useInstanceAction(api.streamInfo.createMarker);
  return useCallback(
    async (description?: string) => {
      const { positionSeconds, createdAt } = await createMarker({ description }).catch(withPlainError);
      return { positionSeconds, createdAt };
    },
    [createMarker]
  );
}

function usePresets({ enabled = true }: ReadOptions = {}) {
  const instanceId = useScopeInstanceId();
  const rows = useQuery(api.streamInfo.listPresets, enabled && instanceId ? { instanceId } : "skip");
  return useMappedList(rows, toStreamInfoPreset);
}

function useSavePresetRequest() {
  const savePreset = useInstanceMutation(api.streamInfo.savePreset);
  return useCallback(
    async ({ name, info }: NewStreamInfoPreset) => {
      const presetId = await savePreset({ name, title: info.title, category: info.category, tags: info.tags }).catch(
        withPlainError
      );
      return toStreamInfoPresetId(presetId);
    },
    [savePreset]
  );
}

function useRemovePresetRequest() {
  const removePreset = useInstanceMutation(api.streamInfo.removePreset, removePresetOptimistically);
  return useCallback(
    async (presetId: StreamInfoPresetId) => {
      await removePreset({ presetId: fromStreamInfoPresetId(presetId) }).catch(withPlainError);
    },
    [removePreset]
  );
}

export const convexStreamInfoGateway: StreamInfoGateway = {
  useChannelRequest,
  useSearchCategoriesRequest,
  useUpdateRequest,
  useCreateMarkerRequest,
  usePresets,
  useSavePresetRequest,
  useRemovePresetRequest,
};
