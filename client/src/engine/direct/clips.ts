import { readCreatedClipAnswer } from "@shared/twitch-clips";
import { ENGINE_CAPABILITIES } from "@woofx3/api";
import type { ClipsGateway } from "@/engine/gateway";
import type { CreatedClip } from "@/engine/types";
import { useEngineRequest } from "./query";
import type { DirectRuntime } from "./runtime";
import { directTwitch } from "./twitch";

/** Clipping the live stream through the engine's `twitchCreateClip`. Every link carries the clip scope. */
export function directClipsGateway(runtime: DirectRuntime): ClipsGateway {
  const twitch = directTwitch(runtime);

  const create = async (): Promise<CreatedClip> => {
    await twitch.authorize(null);
    return readCreatedClipAnswer(await twitch.helix("twitchCreateClip", (api) => api.twitchCreateClip()));
  };

  return {
    useCreateRequest: () => useEngineRequest(create),
  };
}
