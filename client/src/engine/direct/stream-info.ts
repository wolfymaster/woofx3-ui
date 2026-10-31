import {
  categorySearchProblem,
  characterCount,
  type StreamInfo as HelixStreamInfo,
  isEmptyChanges,
  MAX_PRESET_NAME_LENGTH,
  markerDescriptionProblem,
  NOTHING_TO_UPDATE_MESSAGE,
  readCategoryAnswer,
  readChannelInfoAnswer,
  readMarkerAnswer,
  readModifyChannelAnswer,
  readSearchCategoriesAnswer,
  SEARCH_RESULT_LIMIT,
  STREAM_INFO_SCOPE,
  streamInfoChangesProblem,
  toHelixPatch,
  unappliedFields,
  withBoxArt,
} from "@shared/stream-info";
import { ENGINE_CAPABILITIES, type UISetting } from "@woofx3/api";
import { z } from "zod";
import type { StreamInfoGateway } from "@/engine/gateway";
import type {
  KnownBoxArt,
  NewStreamInfoPreset,
  StreamCategory,
  StreamInfo,
  StreamInfoChanges,
  StreamInfoPreset,
  StreamInfoPresetId,
  StreamInfoUpdate,
  StreamMarker,
} from "@/engine/types";
import { fromStreamInfoPresetId, toStreamInfoPresetId } from "./ids";
import { fromStreamInfoChanges, toStreamCategory, toStreamInfo } from "./map/twitch";
import { useEngineQuery, useEngineRequest } from "./query";
import type { DirectRuntime } from "./runtime";
import { directTwitch } from "./twitch";
import {
  parseSetting,
  removeUISetting,
  toSettingValue,
  UI_SETTING_NAMESPACES,
  uiSettingsRead,
  updateUISetting,
} from "./ui-settings";

/** Must match MAX_PRESETS in convex/streamInfo.ts. */
const MAX_PRESETS = 50;

/** A preset's title, category and tags, stored under its name in the engine's local UI settings. */
const presetInfoSchema = z.object({
  title: z.string(),
  category: z.object({ id: z.string(), name: z.string(), boxArtUrl: z.string().nullable() }).nullable(),
  tags: z.array(z.string()),
});

/** In name order, as the Convex gateway lists them. */
function byName(a: StreamInfoPreset, b: StreamInfoPreset): number {
  if (a.name === b.name) {
    return 0;
  }
  return a.name < b.name ? -1 : 1;
}

/**
 * The channel's title, category and tags, and VOD markers, through the
 * engine's `twitch.streamInfo` methods. Every call runs under one scope,
 * reads included, as the Convex gateway's do. Presets are the dashboard's
 * own records, one per name in the engine's local UI settings.
 */
export function directStreamInfoGateway(runtime: DirectRuntime): StreamInfoGateway {
  const twitch = directTwitch(runtime);
  const streamInfo = ENGINE_CAPABILITIES.twitchStreamInfo;

  const readChannel = async (known?: KnownBoxArt): Promise<HelixStreamInfo> => {
    const info = await readChannelInfoAnswer(
      await twitch.helix(streamInfo, "twitchGetChannelInformation", (api) => api.twitchGetChannelInformation())
    );
    return withBoxArt(info, known, async (id) =>
      readCategoryAnswer(await twitch.helix(streamInfo, "twitchGetGames", (api) => api.twitchGetGames({ id })))
    );
  };

  const channel = async (knownBoxArt?: KnownBoxArt): Promise<StreamInfo> => {
    await twitch.authorize(STREAM_INFO_SCOPE);
    return toStreamInfo(await readChannel(knownBoxArt));
  };

  const searchCategories = async (query: string): Promise<StreamCategory[]> => {
    const text = query.trim();
    if (!text) {
      return [];
    }
    const problem = categorySearchProblem(text);
    if (problem) {
      throw new Error(problem);
    }
    await twitch.authorize(STREAM_INFO_SCOPE);
    const categories = await readSearchCategoriesAnswer(
      await twitch.helix(streamInfo, "twitchSearchCategories", (api) =>
        api.twitchSearchCategories({ query: text, first: SEARCH_RESULT_LIMIT })
      )
    );
    return categories.map(toStreamCategory);
  };

  /**
   * Twitch answers success even when it ignores a value, so the channel is
   * read back and any requested field it does not hold is reported.
   */
  const update = async (requested: StreamInfoChanges): Promise<StreamInfoUpdate> => {
    const changes = fromStreamInfoChanges(requested);
    if (isEmptyChanges(changes)) {
      throw new Error(NOTHING_TO_UPDATE_MESSAGE);
    }
    const problem = streamInfoChangesProblem(changes);
    if (problem) {
      throw new Error(problem);
    }
    await twitch.authorize(STREAM_INFO_SCOPE);
    const patch = toHelixPatch(changes);
    await readModifyChannelAnswer(
      await twitch.helix(streamInfo, "twitchModifyChannelInformation", (api) =>
        api.twitchModifyChannelInformation(patch)
      )
    );
    const info = await readChannel();
    return { info: toStreamInfo(info), unapplied: unappliedFields(changes, info) };
  };

  const createMarker = async (text?: string): Promise<StreamMarker> => {
    const description = text?.trim() ?? "";
    const problem = markerDescriptionProblem(description);
    if (problem) {
      throw new Error(problem);
    }
    await twitch.authorize(STREAM_INFO_SCOPE);
    return readMarkerAnswer(
      await twitch.helix(streamInfo, "twitchCreateStreamMarker", (api) =>
        api.twitchCreateStreamMarker(description ? { description } : {})
      )
    );
  };

  const presetsRead = uiSettingsRead(runtime, UI_SETTING_NAMESPACES.streamInfoPresets, "streamInfo.usePresets");

  const toPreset = (setting: UISetting): StreamInfoPreset[] => {
    const info = parseSetting(runtime.logger, presetInfoSchema, setting);
    return info ? [{ id: toStreamInfoPresetId(setting.key), name: setting.key, info }] : [];
  };
  // Built once per gateway so the selected list keeps its identity until the namespace changes.
  const selectPresets = (settings: UISetting[]): StreamInfoPreset[] => settings.flatMap(toPreset).sort(byName);

  const savePreset = async ({ name: requestedName, info }: NewStreamInfoPreset): Promise<StreamInfoPresetId> => {
    const member = "streamInfo.useSavePresetRequest";
    const name = requestedName.trim();
    if (!name) {
      throw new Error("A preset needs a name");
    }
    if (characterCount(name) > MAX_PRESET_NAME_LENGTH) {
      throw new Error(`Preset names are limited to ${MAX_PRESET_NAME_LENGTH} characters`);
    }
    const stored: StreamInfo = { ...info, title: info.title.trim() };
    const problem = streamInfoChangesProblem(fromStreamInfoChanges(stored));
    if (problem) {
      throw new Error(problem);
    }
    const saved = selectPresets(await runtime.queryClient.fetchQuery(presetsRead));
    await updateUISetting(
      runtime,
      UI_SETTING_NAMESPACES.streamInfoPresets,
      name,
      (current) => {
        if (current === null && saved.length >= MAX_PRESETS) {
          throw new Error(`You can keep at most ${MAX_PRESETS} presets. Delete one to save another.`);
        }
        return { kind: "write", value: toSettingValue(stored) };
      },
      member
    );
    return toStreamInfoPresetId(name);
  };

  const removePreset = (presetId: StreamInfoPresetId) =>
    removeUISetting(
      runtime,
      UI_SETTING_NAMESPACES.streamInfoPresets,
      fromStreamInfoPresetId(presetId),
      "streamInfo.useRemovePresetRequest"
    );

  return {
    useChannelRequest: () => useEngineRequest(channel),
    useSearchCategoriesRequest: () => useEngineRequest(searchCategories),
    useUpdateRequest: () => useEngineRequest(update),
    useCreateMarkerRequest: () => useEngineRequest(createMarker),
    usePresets: (options) => useEngineQuery(runtime, presetsRead, { enabled: options?.enabled, select: selectPresets }),
    useSavePresetRequest: () => useEngineRequest(savePreset),
    useRemovePresetRequest: () => useEngineRequest(removePreset),
  };
}
