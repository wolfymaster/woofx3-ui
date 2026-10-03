import { describe, expect, test } from "bun:test";
import { parseEngineShoutoutTarget, queuedPosition } from "./shoutoutEngineRequest";

describe("parseEngineShoutoutTarget", () => {
  test("reads the engine's lookup, normalizing the login", () => {
    expect(
      parseEngineShoutoutTarget({
        type: "shoutout.enqueue.requested",
        twitchUserId: "7",
        login: " @Raider",
        displayName: "Raider",
        profileImageUrl: "https://img/7.png",
        broadcasterType: "",
      })
    ).toEqual({
      twitchUserId: "7",
      login: "raider",
      displayName: "Raider",
      profileImageUrl: "https://img/7.png",
      broadcasterType: "",
    });
  });

  test("falls back to the login for a missing display name", () => {
    expect(parseEngineShoutoutTarget({ twitchUserId: "7", login: "raider" })).toMatchObject({
      displayName: "raider",
      profileImageUrl: undefined,
      broadcasterType: undefined,
    });
  });

  test("refuses a request that names nobody", () => {
    expect(parseEngineShoutoutTarget(null)).toBeNull();
    expect(parseEngineShoutoutTarget({ login: "raider" })).toBeNull();
    expect(parseEngineShoutoutTarget({ twitchUserId: "7", login: " @ " })).toBeNull();
  });
});

describe("queuedPosition", () => {
  const entries = [{ twitchUserId: "1" }, { twitchUserId: "7" }];

  test("is the 1-based place of a user already waiting", () => {
    expect(queuedPosition(entries, "7")).toBe(2);
  });

  test("is null for a user not in the queue", () => {
    expect(queuedPosition(entries, "9")).toBeNull();
    expect(queuedPosition([], "7")).toBeNull();
  });
});
