import type { StreamSession, StreamStatus } from "@woofx3/api";
import type { InstanceLiveState } from "@/engine/types";

/**
 * The live state from the engine's stream status and its newest stream
 * session, read at `now`. The stream's own fields describe a live stream
 * only, so they are left out while offline. The session spans brief
 * dropouts, so it is kept while offline; `newest` is null when the engine
 * records no sessions or cannot say.
 */
export function toInstanceLiveState(
  status: StreamStatus,
  newest: StreamSession | null,
  now: number
): InstanceLiveState {
  const live = status.isLive;
  return {
    isLive: live,
    twitchUserId: status.twitchUserId,
    startedAt: live ? status.startedAt : undefined,
    sessionId: newest?.id,
    sessionStartedAt: newest?.startedAt,
    streamTitle: live ? status.streamTitle : undefined,
    gameName: live ? status.gameName : undefined,
    viewerCount: live ? status.viewerCount : undefined,
    lastUpdateSource: "poll",
    lastUpdatedAt: now,
  };
}
