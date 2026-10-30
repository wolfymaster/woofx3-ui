import { describe, expect, test } from "bun:test";
import type { StreamSession, StreamStatus } from "@woofx3/api";
import { toInstanceLiveState } from "./live-state";

const NOW = 1_700_000_000_000;

const session: StreamSession = {
  id: "session-1",
  status: "open",
  startedAt: "2026-10-28T10:00:00Z",
  endedAt: null,
  segments: [],
};

const live: StreamStatus = {
  isLive: true,
  uptime: "1h",
  viewerCount: 42,
  startedAt: "2026-10-28T11:00:00Z",
  streamTitle: "Speedruns",
  gameName: "Celeste",
  twitchUserId: "u-1",
};

describe("toInstanceLiveState", () => {
  test("a live stream carries its own fields and the session", () => {
    expect(toInstanceLiveState(live, session, NOW)).toEqual({
      isLive: true,
      twitchUserId: "u-1",
      startedAt: "2026-10-28T11:00:00Z",
      sessionId: "session-1",
      sessionStartedAt: "2026-10-28T10:00:00Z",
      streamTitle: "Speedruns",
      gameName: "Celeste",
      viewerCount: 42,
      lastUpdateSource: "poll",
      lastUpdatedAt: NOW,
    });
  });

  test("offline, the stream's fields are left out and the session is kept", () => {
    const state = toInstanceLiveState({ ...live, isLive: false }, session, NOW);
    expect(state).toMatchObject({ isLive: false, sessionId: "session-1" });
    expect([state.startedAt, state.streamTitle, state.gameName, state.viewerCount]).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });

  test("with no session recorded there is none to name", () => {
    const state = toInstanceLiveState(live, null, NOW);
    expect([state.sessionId, state.sessionStartedAt]).toEqual([undefined, undefined]);
  });
});
