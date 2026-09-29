import { describe, expect, test } from "bun:test";
import { describePermission, describePermissions, permissionsToApprove } from "./module-permissions";

describe("describePermission", () => {
  test("known ids read as plain language", () => {
    expect(describePermission("twitch.moderation")).toEqual({
      id: "twitch.moderation",
      description: "Time out chatters in your Twitch chat",
      known: true,
    });
    expect(describePermission("twitch.channel").known).toBe(true);
    expect(describePermission("obs.control").known).toBe(true);
  });

  test("an unknown id is shown, flagged as unknown", () => {
    expect(describePermission("obs.scenes")).toEqual({
      id: "obs.scenes",
      description: "Unknown permission: obs.scenes",
      known: false,
    });
  });

  test("an id that names an Object.prototype member is still unknown", () => {
    expect(describePermission("toString").known).toBe(false);
    expect(describePermission("__proto__").known).toBe(false);
  });

  test("describes a list in order", () => {
    expect(describePermissions(["twitch.channel", "x"]).map((p) => p.id)).toEqual(["twitch.channel", "x"]);
  });
});

describe("permissionsToApprove", () => {
  test("a fresh install approves everything it declares", () => {
    expect(permissionsToApprove(["twitch.moderation", "twitch.channel"], null)).toEqual([
      "twitch.moderation",
      "twitch.channel",
    ]);
  });

  test("an upgrade approves only what the installed version lacked", () => {
    expect(permissionsToApprove(["twitch.moderation", "twitch.channel"], ["twitch.moderation"])).toEqual([
      "twitch.channel",
    ]);
  });

  test("an upgrade that keeps or drops permissions needs no approval", () => {
    expect(permissionsToApprove(["twitch.channel"], ["twitch.channel"])).toEqual([]);
    expect(permissionsToApprove([], ["twitch.channel"])).toEqual([]);
  });
});
