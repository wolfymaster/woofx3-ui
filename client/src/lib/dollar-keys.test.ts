import { describe, expect, test } from "bun:test";
import { escapeDollarKeys, unescapeDollarKeys } from "./dollar-keys";

describe("dollar-keys", () => {
  test("round-trips workflow trigger $ref", () => {
    const engine = {
      trigger: {
        type: "event",
        event: "cheer.user.twitch",
        $ref: "twitch_platform:trigger:cheer.user.twitch",
        conditions: [],
      },
      tasks: [{ id: "s1", $ref: "mod:action:play_alert", type: "action", action: "play_alert" }],
    };
    const escaped = escapeDollarKeys(engine) as typeof engine;
    expect(escaped.trigger).not.toHaveProperty("$ref");
    expect(escaped.trigger).toHaveProperty("__$ref", "twitch_platform:trigger:cheer.user.twitch");
    expect(unescapeDollarKeys(escaped)).toEqual(engine);
  });

  test("does not double-escape already escaped keys", () => {
    const once = { __$ref: "x" };
    expect(escapeDollarKeys(once)).toEqual(once);
  });
});
