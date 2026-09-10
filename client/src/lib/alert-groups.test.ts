import { describe, expect, test } from "bun:test";
import { alertGroupKey, alertGroupLabel, buildAlertGroups, findAlertGroup } from "@/lib/alert-groups";
import type { TriggerPreset } from "@/lib/workflow-presets";

const icon = (() => null) as unknown as TriggerPreset["icon"];

function preset(id: string, name: string, taxonomy?: string[], event?: string): TriggerPreset {
  return { id, name, description: "", icon, category: "General", color: "#888", event, taxonomy };
}

describe("alertGroupKey", () => {
  test("reads the declared alert axis, not the event name", () => {
    expect(alertGroupKey(preset("t", "Follow", ["platform.twitch", "alert.follow"], "channel.follow"))).toBe("follow");
    expect(alertGroupKey(preset("t", "Cheer", ["platform.twitch", "alert.cheer"], "channel.cheer"))).toBe("cheer");
  });

  test("ignores the other axes", () => {
    expect(alertGroupKey(preset("t", "Redeem", ["platform.twitch", "alert.channelpoints"]))).toBe("channelpoints");
  });

  // The regression this replaced: grouping by the leading event segment put
  // every `channel.*` event in one bucket once events became scope-first.
  test("does not collapse events that share a scope", () => {
    const follow = alertGroupKey(preset("t1", "Follow", ["alert.follow"], "channel.follow"));
    const cheer = alertGroupKey(preset("t2", "Cheer", ["alert.cheer"], "channel.cheer"));
    expect(follow).not.toBe(cheer);
  });

  test("a trigger with no alert axis is not an alert type", () => {
    expect(alertGroupKey(preset("t", "Workflow created", ["system.workflow"], "db.workflow.created.*"))).toBeUndefined();
    expect(alertGroupKey(preset("t", "No taxonomy at all", undefined, "channel.follow"))).toBeUndefined();
  });

  test("an empty or malformed axis is not an alert type", () => {
    expect(alertGroupKey(preset("t", "Empty leaf", ["alert."]))).toBeUndefined();
  });
});

describe("alertGroupLabel", () => {
  test("splits camelCase into words", () => {
    expect(alertGroupLabel("subscriptionGift")).toBe("Subscription Gift");
  });

  test("uses the real name where humanising the leaf would get it wrong", () => {
    expect(alertGroupLabel("channelpoints")).toBe("Channel Points");
    expect(alertGroupLabel("hypetrain")).toBe("Hype Train");
    expect(alertGroupLabel("watchstreak")).toBe("Watch Streak");
    expect(alertGroupLabel("subscription")).toBe("Subscriptions");
  });

  test("title-cases a single word", () => {
    expect(alertGroupLabel("cheer")).toBe("Cheer");
  });
});

describe("buildAlertGroups", () => {
  // The reason the axis exists: one concept scattered across many events is
  // one entry, not ten.
  test("collects every event of one kind into a single group", () => {
    const groups = buildAlertGroups([
      preset("t1", "Channel subscribe", ["platform.twitch", "alert.subscription"], "channel.subscribe"),
      preset("t2", "Channel resub", ["platform.twitch", "alert.subscription"], "channel.resub"),
      preset("t3", "Gift sub", ["platform.twitch", "alert.subscription"], "channel.subscriptionGift"),
      preset("t4", "Channel cheer", ["platform.twitch", "alert.cheer"], "channel.cheer"),
    ]);
    expect(groups.map((g) => g.key).sort()).toEqual(["cheer", "subscription"]);
    expect(groups.find((g) => g.key === "subscription")?.presets).toHaveLength(3);
  });

  test("a second platform joins the existing group with no change here", () => {
    const groups = buildAlertGroups([
      preset("t1", "Twitch cheer", ["platform.twitch", "alert.cheer"], "channel.cheer"),
      preset("t2", "Kick cheer", ["platform.kick", "alert.cheer"], "channel.cheer"),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.presets).toHaveLength(2);
  });

  test("lifecycle triggers are not offered as alert types", () => {
    const groups = buildAlertGroups([
      preset("t1", "Channel follow", ["platform.twitch", "alert.follow"], "channel.follow"),
      preset("t2", "Workflow created", ["system.workflow"], "db.workflow.created.*"),
      preset("t3", "Module installed", ["system.module"], "module.change.add"),
      preset("t4", "Chat command", ["system.chat"], "chat.command.*"),
    ]);
    expect(groups.map((g) => g.key)).toEqual(["follow"]);
  });

  test("orders groups by label and presets by name", () => {
    const groups = buildAlertGroups([
      preset("t1", "Zulu", ["alert.raid"]),
      preset("t2", "Alpha", ["alert.raid"]),
      preset("t3", "Anything", ["alert.cheer"]),
    ]);
    expect(groups.map((g) => g.label)).toEqual(["Cheer", "Raid"]);
    expect(groups.find((g) => g.key === "raid")?.presets.map((p) => p.name)).toEqual(["Alpha", "Zulu"]);
  });

  test("no alert triggers yields no groups", () => {
    expect(buildAlertGroups([preset("t1", "Workflow created", ["system.workflow"])])).toEqual([]);
  });
});

describe("findAlertGroup", () => {
  const groups = buildAlertGroups([
    preset("t1", "Follow", ["alert.follow"]),
    preset("t2", "Cheer", ["alert.cheer"]),
  ]);

  test("finds by key", () => {
    expect(findAlertGroup(groups, "follow")?.label).toBe("Follow");
  });

  test("returns undefined for an unknown or absent key", () => {
    expect(findAlertGroup(groups, "nope")).toBeUndefined();
    expect(findAlertGroup(groups, undefined)).toBeUndefined();
  });
});
