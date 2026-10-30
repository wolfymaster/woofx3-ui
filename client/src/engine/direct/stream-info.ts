import {
  categorySearchProblem,
  type StreamInfo as HelixStreamInfo,
  isEmptyChanges,
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
import { ENGINE_CAPABILITIES } from "@woofx3/api";
import type { StreamInfoGateway } from "@/engine/gateway";
import type {
  KnownBoxArt,
  StreamCategory,
  StreamInfo,
  StreamInfoChanges,
  StreamInfoUpdate,
  StreamMarker,
} from "@/engine/types";
import { fromStreamInfoChanges, toStreamCategory, toStreamInfo } from "./map/twitch";
import { useEngineRequest } from "./query";
import type { DirectRuntime } from "./runtime";
import { directTwitch } from "./twitch";
import { unsupportedRead, unsupportedRequest } from "./unsupported";

/**
 * The channel's title, category and tags, and VOD markers, through the
 * engine's `twitch.streamInfo` methods. Every call runs under one scope,
 * reads included, as the Convex gateway's do.
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

  return {
    useChannelRequest: () => useEngineRequest(channel),
    useSearchCategoriesRequest: () => useEngineRequest(searchCategories),
    useUpdateRequest: () => useEngineRequest(update),
    useCreateMarkerRequest: () => useEngineRequest(createMarker),
    // Presets are the dashboard's own records, kept in the account; the engine has none.
    usePresets: unsupportedRead("streamInfo.usePresets"),
    useSavePresetRequest: unsupportedRequest("streamInfo.useSavePresetRequest"),
    useRemovePresetRequest: unsupportedRequest("streamInfo.useRemovePresetRequest"),
  };
}
