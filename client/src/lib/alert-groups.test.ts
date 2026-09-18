import { describe, expect, test } from "bun:test";
import {
  type AlertNode,
  alertMenuPath,
  buildAlertTree,
  countAlertsByNode,
  findAlertNode,
  flattenAlertTree,
  OTHER_PLATFORM_KEY,
  subtreePresets,
  taxonomyLabel,
} from "@/lib/alert-groups";
import type { TriggerPreset } from "@/lib/workflow-presets";

const icon = (() => null) as unknown as TriggerPreset["icon"];

function preset(id: string, name: string, taxonomy?: string[], event?: string): TriggerPreset {
  return { id, name, description: "", icon, category: "General", color: "#888", event, taxonomy };
}

/** The tree as nested labels, which is what a reader of the menu sees. */
function outline(nodes: AlertNode[]): unknown[] {
  return nodes.map((node) => (node.children.length > 0 ? { [node.label]: outline(node.children) } : node.label));
}

describe("alertMenuPath", () => {
  test("reads the platform axis, then the alert axis, not the event name", () => {
    expect(alertMenuPath(preset("t", "Follow", ["platform.twitch", "alert.follow"], "channel.follow"))).toEqual([
      "twitch",
      "follow",
    ]);
  });

  test("gives every segment of a nested alert axis its own level", () => {
    expect(alertMenuPath(preset("t", "Gift", ["alert.subscription.gift.community", "platform.twitch"]))).toEqual([
      "twitch",
      "subscription",
      "gift",
      "community",
    ]);
  });

  test("puts a trigger with no platform axis under Other", () => {
    expect(alertMenuPath(preset("t", "Donation", ["alert.donation"]))).toEqual([OTHER_PLATFORM_KEY, "donation"]);
  });

  // The regression the declared axis replaced: grouping by the leading event segment
  // put every `channel.*` event in one bucket once events became scope-first.
  test("does not collapse events that share a scope", () => {
    const follow = alertMenuPath(preset("t1", "Follow", ["alert.follow"], "channel.follow"));
    const cheer = alertMenuPath(preset("t2", "Cheer", ["alert.cheer"], "channel.cheer"));
    expect(follow).not.toEqual(cheer);
  });

  test("a trigger with no alert axis is not an alert type", () => {
    expect(
      alertMenuPath(preset("t", "Workflow created", ["platform.twitch", "system.workflow"], "db.workflow.created.*"))
    ).toBeUndefined();
    expect(alertMenuPath(preset("t", "No taxonomy at all", undefined, "channel.follow"))).toBeUndefined();
  });

  test("an empty or malformed alert axis is not an alert type", () => {
    expect(alertMenuPath(preset("t", "Empty leaf", ["alert."]))).toBeUndefined();
    expect(alertMenuPath(preset("t", "Empty segment", ["alert.subscription..gift"]))).toBeUndefined();
  });

  test("a malformed platform axis falls back to Other", () => {
    expect(alertMenuPath(preset("t", "Cheer", ["platform.", "alert.cheer"]))).toEqual([OTHER_PLATFORM_KEY, "cheer"]);
  });
});

describe("taxonomyLabel", () => {
  test("splits camelCase into words", () => {
    expect(taxonomyLabel("subscriptionGift")).toBe("Subscription Gift");
  });

  test("uses the real name where humanising the segment would get it wrong", () => {
    expect(taxonomyLabel("channelpoints")).toBe("Channel Points");
    expect(taxonomyLabel("hypetrain")).toBe("Hype Train");
    expect(taxonomyLabel("watchstreak")).toBe("Watch Streak");
    expect(taxonomyLabel("subscription")).toBe("Subscriptions");
  });

  test("title-cases a single word", () => {
    expect(taxonomyLabel("twitch")).toBe("Twitch");
    expect(taxonomyLabel(OTHER_PLATFORM_KEY)).toBe("Other");
  });
});

describe("buildAlertTree", () => {
  test("groups by platform first, then by what happened", () => {
    const tree = buildAlertTree([
      preset("t1", "Channel subscribe", ["platform.twitch", "alert.subscription"], "channel.subscribe"),
      preset("t2", "Channel resub", ["platform.twitch", "alert.subscription"], "channel.resub"),
      preset("t3", "Channel cheer", ["platform.twitch", "alert.cheer"], "channel.cheer"),
      preset("t4", "Kick cheer", ["platform.kick", "alert.cheer"], "channel.cheer"),
    ]);
    expect(outline(tree)).toEqual([{ Kick: ["Cheer"] }, { Twitch: ["Cheer", "Subscriptions"] }]);
    expect(findAlertNode(tree, ["twitch", "subscription"])?.presets).toHaveLength(2);
  });

  test("nests as deep as the alert axis goes, keeping triggers at every level", () => {
    const tree = buildAlertTree([
      preset("t1", "Subscribe", ["platform.twitch", "alert.subscription"]),
      preset("t2", "Gift", ["platform.twitch", "alert.subscription.gift"]),
      preset("t3", "Community gift", ["platform.twitch", "alert.subscription.gift.community"]),
    ]);
    expect(outline(tree)).toEqual([{ Twitch: [{ Subscriptions: [{ Gift: ["Community"] }] }] }]);
    const subscriptions = findAlertNode(tree, ["twitch", "subscription"]);
    expect(subscriptions?.presets.map((p) => p.name)).toEqual(["Subscribe"]);
    expect(subscriptions && subtreePresets(subscriptions).map((p) => p.name)).toEqual([
      "Subscribe",
      "Gift",
      "Community gift",
    ]);
  });

  // Twitch's shared-chat events declare `alert.shared.*`, so activity from another
  // channel during a shared session sits under its own level rather than beside the
  // channel's own events, which repeats "Subscriptions › Gift" at a second depth.
  test("a shared branch keeps its own copy of a kind that also exists beside it", () => {
    const tree = buildAlertTree([
      preset("t1", "Gift", ["platform.twitch", "alert.subscription.gift"]),
      preset("t2", "Shared gift", ["platform.twitch", "alert.shared.subscription.gift"]),
      preset("t3", "Shared raid", ["platform.twitch", "alert.shared.raid"]),
    ]);
    expect(outline(tree)).toEqual([
      { Twitch: [{ Shared: ["Raid", { Subscriptions: ["Gift"] }] }, { Subscriptions: ["Gift"] }] },
    ]);
    expect(findAlertNode(tree, ["twitch", "shared", "subscription", "gift"])?.presets.map((p) => p.name)).toEqual([
      "Shared gift",
    ]);
    expect(findAlertNode(tree, ["twitch", "subscription", "gift"])?.presets.map((p) => p.name)).toEqual(["Gift"]);
  });

  test("places Other after every named platform", () => {
    const tree = buildAlertTree([
      preset("t1", "Donation", ["alert.donation"]),
      preset("t2", "Zebra cheer", ["platform.zebra", "alert.cheer"]),
      preset("t3", "Apple cheer", ["platform.apple", "alert.cheer"]),
    ]);
    expect(tree.map((node) => node.label)).toEqual(["Apple", "Zebra", "Other"]);
  });

  test("lifecycle triggers are not offered as alert types", () => {
    const tree = buildAlertTree([
      preset("t1", "Channel follow", ["platform.twitch", "alert.follow"], "channel.follow"),
      preset("t2", "Workflow created", ["system.workflow"], "db.workflow.created.*"),
      preset("t3", "Chat command", ["system.chat"], "chat.command.*"),
    ]);
    expect(outline(tree)).toEqual([{ Twitch: ["Follow"] }]);
  });

  test("orders kinds by label and presets by name", () => {
    const tree = buildAlertTree([
      preset("t1", "Zulu", ["alert.raid"]),
      preset("t2", "Alpha", ["alert.raid"]),
      preset("t3", "Anything", ["alert.cheer"]),
    ]);
    expect(outline(tree)).toEqual([{ Other: ["Cheer", "Raid"] }]);
    expect(findAlertNode(tree, ["other", "raid"])?.presets.map((p) => p.name)).toEqual(["Alpha", "Zulu"]);
  });

  test("no alert triggers yields no tree", () => {
    expect(buildAlertTree([preset("t1", "Workflow created", ["system.workflow"])])).toEqual([]);
  });
});

describe("findAlertNode", () => {
  const tree = buildAlertTree([
    preset("t1", "Follow", ["platform.twitch", "alert.follow"]),
    preset("t2", "Gift", ["platform.twitch", "alert.subscription.gift"]),
  ]);

  test("finds a node at any depth", () => {
    expect(findAlertNode(tree, ["twitch"])?.label).toBe("Twitch");
    expect(findAlertNode(tree, ["twitch", "subscription", "gift"])?.label).toBe("Gift");
  });

  test("returns undefined for an unknown or empty path", () => {
    expect(findAlertNode(tree, ["twitch", "nope"])).toBeUndefined();
    expect(findAlertNode(tree, ["follow"])).toBeUndefined();
    expect(findAlertNode(tree, [])).toBeUndefined();
  });
});

describe("flattenAlertTree", () => {
  test("lists each node holding triggers, labelled with its whole trail", () => {
    const sections = flattenAlertTree(
      buildAlertTree([
        preset("t1", "Subscribe", ["platform.twitch", "alert.subscription"]),
        preset("t2", "Community gift", ["platform.twitch", "alert.subscription.gift.community"]),
      ])
    );
    expect(sections.map((section) => section.label)).toEqual([
      "Twitch › Subscriptions",
      "Twitch › Subscriptions › Gift › Community",
    ]);
  });
});

describe("countAlertsByNode", () => {
  test("counts each alert at its node and every ancestor", () => {
    const counts = countAlertsByNode([
      [["twitch", "subscription"], 2],
      [["twitch", "subscription", "gift"], 1],
      [["twitch", "cheer"], 3],
    ]);
    expect(counts.get("twitch")).toBe(6);
    expect(counts.get("twitch/subscription")).toBe(3);
    expect(counts.get("twitch/subscription/gift")).toBe(1);
    expect(counts.get("twitch/cheer")).toBe(3);
  });
});
