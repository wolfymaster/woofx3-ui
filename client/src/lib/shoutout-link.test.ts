import { describe, expect, test } from "bun:test";
import { CHATTERS_SCOPE, SHOUTOUT_SCOPE } from "@shared/twitch-chat";
import { shoutoutLinkProblem } from "./shoutout-link";

describe("shoutoutLinkProblem", () => {
  const full = [SHOUTOUT_SCOPE, CHATTERS_SCOPE];

  test.each([
    ["a healthy link", full, undefined, null],
    [
      "a revoked link",
      full,
      5,
      "Your Twitch connection stopped working. Reconnect Twitch in Settings to send shoutouts.",
    ],
    ["no shoutout scope", [CHATTERS_SCOPE], undefined, "Reconnect Twitch in Settings to send shoutouts."],
    [
      "no chatters scope",
      [SHOUTOUT_SCOPE],
      undefined,
      "Reconnect Twitch in Settings to see who's in chat. You can still type a name.",
    ],
  ])("%s", (_name, scopes, authFailedAt, expected) => {
    expect(shoutoutLinkProblem({ scopes, authFailedAt })).toBe(expected);
  });
});
