import { api } from "@convex/_generated/api";
import { useCallback } from "react";
import type { ClipsGateway } from "@/engine/gateway";
import { withPlainError } from "./errors";
import { useInstanceAction } from "./scope";

// Convex clips through the instance's engine, or with the broadcaster token
// it holds when there is no engine to ask.

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
