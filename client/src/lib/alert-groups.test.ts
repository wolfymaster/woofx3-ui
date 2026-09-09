import { describe, expect, test } from "bun:test";
import { alertGroupKey, alertGroupLabel, buildAlertGroups, findAlertGroup } from "@/lib/alert-groups";
import type { TriggerPreset } from "@/lib/workflow-presets";

const icon = (() => null) as unknown as TriggerPreset["icon"];

function preset(id: string, name: string, event?: string): TriggerPreset {
  return { id, name, description: "", icon, category: "General", color: "#888", event };
}

describe("alertGroupKey", () => {
  test("takes what happened, not where it happened", () => {
    expect(alertGroupKey("cheer.channel.twitch")).toBe("cheer");
    expect(alertGroupKey("subscriptionGift.channel.twitch")).toBe("subscriptionGift");
    expect(alertGroupKey("redeem.channelpoints.twitch")).toBe("redeem");
  });

  test("handles an event with no scope or platform", () => {
    expect(alertGroupKey("donation")).toBe("donation");
  });
});

describe("alertGroupLabel", () => {
  test("splits camelCase into words", () => {
    expect(alertGroupLabel("subscriptionGift")).toBe("Subscription Gift");
    expect(alertGroupLabel("giftPaidUpgrade")).toBe("Gift Paid Upgrade");
  });

  test("title-cases a single word", () => {
    expect(alertGroupLabel("cheer")).toBe("Cheer");
  });
});

describe("buildAlertGroups", () => {
  test("groups triggers by what they report, regardless of platform", () => {
    const groups = buildAlertGroups([
      preset("t1", "Channel cheer", "cheer.channel.twitch"),
      preset("t2", "Channel raid", "raid.channel.twitch"),
      // A second platform reporting the same kind of thing joins the same group.
      preset("t3", "Kick cheer", "cheer.channel.kick"),
    ]);

    expect(groups.map((g) => g.key)).toEqual(["cheer", "raid"]);
    expect(groups[0].presets.map((p) => p.name)).toEqual(["Channel cheer", "Kick cheer"]);
  });

  test("picks up a module's events with no vocabulary to update", () => {
    const groups = buildAlertGroups([preset("t1", "Throne gift", "donation.channel.throne")]);
    expect(groups).toEqual([expect.objectContaining({ key: "donation", label: "Donation" })]);
  });

  test("skips triggers with no event, which cannot fire an alert", () => {
    expect(buildAlertGroups([preset("t1", "Broken")])).toEqual([]);
  });

  test("orders groups and their triggers by label", () => {
    const groups = buildAlertGroups([
      preset("t1", "Zeta", "raid.channel.twitch"),
      preset("t2", "Alpha", "cheer.channel.twitch"),
    ]);
    expect(groups.map((g) => g.label)).toEqual(["Cheer", "Raid"]);
  });
});

describe("findAlertGroup", () => {
  const groups = buildAlertGroups([preset("t1", "Channel cheer", "cheer.channel.twitch")]);

  test("finds by key", () => {
    expect(findAlertGroup(groups, "cheer")?.label).toBe("Cheer");
  });

  test("returns undefined for an unknown or absent key", () => {
    expect(findAlertGroup(groups, "nope")).toBeUndefined();
    expect(findAlertGroup(groups, undefined)).toBeUndefined();
  });
});
