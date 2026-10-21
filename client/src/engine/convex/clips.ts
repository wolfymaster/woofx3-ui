import { api } from "@convex/_generated/api";
import { useCallback } from "react";
import type { ClipsGateway } from "@/engine/gateway";
import { withPlainError } from "./errors";
import { useInstanceAction } from "./scope";

// Convex clips with the broadcaster token it holds, through the engine when
// the engine advertises `twitch.clips`.

function useCreateRequest() {
  const createClip = useInstanceAction(api.twitchClips.createClip);
  return useCallback(async () => {
    const { clipId, editUrl } = await createClip({}).catch(withPlainError);
    return { clipId, editUrl };
  }, [createClip]);
}

export const convexClipsGateway: ClipsGateway = {
  useCreateRequest,
};
