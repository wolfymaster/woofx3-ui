import { describe, expect, test } from "bun:test";
import { Square } from "lucide-react";
import {
  ALL_SECTIONS,
  actionGroupHeading,
  actionMenuGroups,
  actionPlacement,
  actionSectionCounts,
  BUILTIN_MODULE_LABEL,
  flattenActionMenu,
} from "./action-menu";
import type { ActionPreset } from "./workflow-presets";

function action(name: string, source: string, description = "", taxonomy?: string[]): ActionPreset {
  return {
    id: `${source}:${name}`,
    name,
    description,
    icon: Square,
    category: "General",
    color: "text-primary",
    source,
    taxonomy,
  };
}

const PRESETS: ActionPreset[] = [
  action("Send chat message", "Twitch Platform", "Publish a message to Twitch chat."),
  action("Switch OBS scene", "OBS", "Change the program scene.", ["platform.obs"]),
  action("Set Govee light colour", "Govee", "Change a light's colour.", ["platform.govee", "function.lighting"]),
  action("Increment counter", "woofx3", "Increase the chosen counter by the configured step.", ["tools.counter"]),
  action("Decrement counter", "woofx3", "Decrease the chosen counter.", ["tools.counter"]),
  action("Add to queue", "woofx3", "Put a viewer in line.", ["tools.queue"]),
  action("Print", "woofx3", "Log the step's parameters.", ["workflow"]),
  action("Alert", "woofx3", "Play an on-stream alert.", ["overlay.alerts", "alert.renderer"]),
];

function menu(query: string, section?: string) {
  return actionMenuGroups(PRESETS, query, section).map((group) => ({
    section: group.sectionLabel,
    group: group.groupLabel,
    names: group.actions.map((preset) => preset.name),
  }));
}

describe("actionPlacement", () => {
  test("reads the section and heading from the first taxonomy entry", () => {
    expect(actionPlacement({ source: "OBS", taxonomy: ["platform.obs.scenes", "function.scene"] })).toEqual({
      sectionKey: "taxonomy:platform",
      sectionLabel: "Platforms",
      groupKey: "taxonomy:platform.obs",
      groupLabel: "OBS",
    });
  });

  test("files counters, timers and queues together under Stream tools", () => {
    expect(actionPlacement({ source: "woofx3", taxonomy: ["tools.timer"] })).toMatchObject({
      sectionLabel: "Stream tools",
      groupLabel: "Timers",
    });
    expect(actionPlacement({ source: "woofx3", taxonomy: ["tools.queue"] })).toMatchObject({
      sectionLabel: "Stream tools",
      groupLabel: "Queues",
    });
  });

  test("labels an older engine's system family Built-in", () => {
    expect(actionPlacement({ source: "woofx3", taxonomy: ["system.timer"] })).toMatchObject({
      sectionLabel: "Built-in",
      groupLabel: "Timers",
    });
  });

  test("a one-segment entry is a section with no heading of its own", () => {
    const placement = actionPlacement({ source: "Wheel", taxonomy: ["games"] });
    expect(placement.groupLabel).toBe(placement.sectionLabel);
    expect(placement.sectionLabel).toBe("Games");
  });

  test("falls back to the module when there is no taxonomy", () => {
    expect(actionPlacement({ source: "Twitch Platform" })).toEqual({
      sectionKey: "module:Twitch Platform",
      sectionLabel: "Twitch Platform",
      groupKey: "module:Twitch Platform",
      groupLabel: "Twitch Platform",
    });
    expect(actionPlacement({ source: "Twitch Platform", taxonomy: [] }).sectionLabel).toBe("Twitch Platform");
  });

  test("falls back to the module when the first entry is malformed", () => {
    expect(actionPlacement({ source: "Odd", taxonomy: ["platform..obs"] }).sectionLabel).toBe("Odd");
  });

  test("an action with no module and no taxonomy joins an older engine's built-in section", () => {
    expect(actionPlacement({ source: BUILTIN_MODULE_LABEL }).sectionKey).toBe(
      actionPlacement({ source: "woofx3", taxonomy: ["system.workflow"] }).sectionKey
    );
  });
});

describe("actionMenuGroups", () => {
  test("groups by purpose, workflow first, then sections and headings alphabetically", () => {
    expect(menu("")).toEqual([
      { section: "Workflow", group: "Workflow", names: ["Print"] },
      { section: "Overlays", group: "Alerts", names: ["Alert"] },
      { section: "Platforms", group: "Govee", names: ["Set Govee light colour"] },
      { section: "Platforms", group: "OBS", names: ["Switch OBS scene"] },
      { section: "Stream tools", group: "Counters", names: ["Decrement counter", "Increment counter"] },
      { section: "Stream tools", group: "Queues", names: ["Add to queue"] },
      { section: "Twitch Platform", group: "Twitch Platform", names: ["Send chat message"] },
    ]);
  });

  test("an older engine's system family still leads", () => {
    const presets = [action("Zap", "Alpha"), action("Print", "woofx3", "", ["system.workflow"])];
    expect(actionMenuGroups(presets, "").map((group) => group.sectionLabel)).toEqual(["Built-in", "Alpha"]);
  });

  test("a query ranks names ahead of descriptions", () => {
    expect(menu("counter")).toEqual([
      { section: "Stream tools", group: "Counters", names: ["Decrement counter", "Increment counter"] },
    ]);
  });

  test("matches a description when no name does", () => {
    expect(menu("on-stream")).toEqual([{ section: "Overlays", group: "Alerts", names: ["Alert"] }]);
  });

  test("a query naming a section, heading or module lists what is under it", () => {
    expect(menu("platforms").map((group) => group.group)).toEqual(["Govee", "OBS"]);
    expect(menu("stream tools").map((group) => group.group)).toEqual(["Counters", "Queues"]);
    expect(menu("govee")).toEqual([{ section: "Platforms", group: "Govee", names: ["Set Govee light colour"] }]);
    expect(menu("twitch")).toEqual([
      { section: "Twitch Platform", group: "Twitch Platform", names: ["Send chat message"] },
    ]);
  });

  test("a section holding the better match leads, workflow aside", () => {
    const presets = [
      action("Zap", "Alpha", "Does a thing."),
      action("Thing", "Zeta"),
      action("Print", "woofx3", "Prints a thing.", ["workflow"]),
    ];
    expect(actionMenuGroups(presets, "thing").map((group) => group.sectionLabel)).toEqual([
      "Workflow",
      "Zeta",
      "Alpha",
    ]);
  });

  test("a selected section narrows the menu to it", () => {
    expect(menu("", "taxonomy:platform").map((group) => group.group)).toEqual(["Govee", "OBS"]);
    expect(menu("", ALL_SECTIONS)).toHaveLength(7);
  });

  test("an engine sending no taxonomy reads as one section per module", () => {
    const untagged = PRESETS.map((preset) => ({ ...preset, taxonomy: undefined }));
    expect(actionMenuGroups(untagged, "").map((group) => group.sectionLabel)).toEqual([
      "Govee",
      "OBS",
      "Twitch Platform",
      "woofx3",
    ]);
  });

  test("no match leaves nothing", () => {
    expect(menu("nothing here")).toEqual([]);
  });
});

describe("actionSectionCounts", () => {
  test("counts every section's actions in the order the sections appear", () => {
    expect(actionSectionCounts(PRESETS, "")).toEqual([
      { key: "taxonomy:workflow", label: "Workflow", count: 1 },
      { key: "taxonomy:overlay", label: "Overlays", count: 1 },
      { key: "taxonomy:platform", label: "Platforms", count: 2 },
      { key: "taxonomy:tools", label: "Stream tools", count: 3 },
      { key: "module:Twitch Platform", label: "Twitch Platform", count: 1 },
    ]);
  });

  test("counts only what the query matches", () => {
    expect(actionSectionCounts(PRESETS, "counter")).toEqual([
      { key: "taxonomy:tools", label: "Stream tools", count: 2 },
    ]);
  });
});

describe("flattenActionMenu", () => {
  test("walks groups in the order they are shown", () => {
    expect(flattenActionMenu(actionMenuGroups(PRESETS, "")).map((preset) => preset.name)).toEqual([
      "Print",
      "Alert",
      "Set Govee light colour",
      "Switch OBS scene",
      "Decrement counter",
      "Increment counter",
      "Add to queue",
      "Send chat message",
    ]);
  });
});

describe("actionGroupHeading", () => {
  const headings = (showSection: boolean) => {
    const groups = actionMenuGroups(PRESETS, "");
    return groups.map((group, index) => actionGroupHeading(group, groups[index - 1], showSection));
  };

  test("names the section over its first group, then each group's own heading", () => {
    expect(headings(true)).toEqual([
      "Workflow",
      "Overlays › Alerts",
      "Platforms › Govee",
      "OBS",
      "Stream tools › Counters",
      "Queues",
      "Twitch Platform",
    ]);
  });

  test("leaves the section out when something else names it", () => {
    expect(headings(false)).toEqual([null, "Alerts", "Govee", "OBS", "Counters", "Queues", null]);
  });
});
