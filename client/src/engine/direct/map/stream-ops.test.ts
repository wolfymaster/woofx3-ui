import { describe, expect, test } from "bun:test";
import { EngineDisconnectedError, EngineTimeoutError } from "@/engine/errors";
import type { SessionState } from "@/lib/engine-session/EngineSession";
import { toEngineCallFailure, toSupporterReadError } from "./stream-ops";

const connected: SessionState = { status: "connected", capabilities: [] };
const refusedCredentials: SessionState = { status: "refused", reason: "credentials", message: "no" };

describe("toEngineCallFailure", () => {
  test.each([
    [
      "credentials the engine turned away",
      new EngineDisconnectedError("getLeaderboard"),
      refusedCredentials,
      "rejected",
    ],
    ["no session to carry the call", new EngineDisconnectedError("getLeaderboard"), connected, "unreachable"],
    ["an engine that never answered", new EngineTimeoutError("getLeaderboard", 10), connected, "unreachable"],
    ["an error the engine answered with", new Error("boom"), connected, "failed"],
  ] as const)("%s", (_case, error, session, status) => {
    expect(toEngineCallFailure(error, session).status).toBe(status);
  });

  test("a long engine message is cut short", () => {
    const failure = toEngineCallFailure(new Error("x".repeat(500)), connected);
    expect(failure.status === "failed" && failure.message.length).toBeLessThan(500);
  });
});

describe("toSupporterReadError", () => {
  test("a lost session is passed on as it is", () => {
    const lost = new EngineDisconnectedError("getLeaderboard");
    expect(toSupporterReadError("the leaderboard", lost)).toBe(lost);
  });

  test("an engine without the read is told to update", () => {
    const error = toSupporterReadError("the leaderboard", new Error("'getLeaderboard' is not a function."));
    expect(error.message).toContain("too old for supporter stats");
  });
});
