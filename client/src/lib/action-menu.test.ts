import { describe, expect, test } from "bun:test";
import { Square } from "lucide-react";
import {
  ALL_SECTIONS,
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
  action("Increment counter", "woofx3", "Increase the chosen counter by the configured step.", ["system.counter"]),
  action("Decrement counter", "woofx3", "Decrease the chosen counter.", ["system.counter"]),
  action("Print", "woofx3", "Log the step's parameters.", ["system.workflow"]),
  action("Alert", "woofx3", "Play an on-stream alert.", ["system.alerts", "alert.renderer"]),
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

  test("labels the engine's own family Built-in", () => {
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

  test("an action with no module and no taxonomy joins the built-in section", () => {
    expect(actionPlacement({ source: BUILTIN_MODULE_LABEL }).sectionKey).toBe(
      actionPlacement({ source: "woofx3", taxonomy: ["system.workflow"] }).sectionKey
    );
  });
});

describe("actionMenuGroups", () => {
  test("groups by taxonomy, built-in first, then sections and headings alphabetically", () => {
    expect(menu("")).toEqual([
      { section: "Built-in", group: "Alerts", names: ["Alert"] },
      { section: "Built-in", group: "Counters", names: ["Decrement counter", "Increment counter"] },
      { section: "Built-in", group: "Workflow", names: ["Print"] },
      { section: "Platforms", group: "Govee", names: ["Set Govee light colour"] },
      { section: "Platforms", group: "OBS", names: ["Switch OBS scene"] },
      { section: "Twitch Platform", group: "Twitch Platform", names: ["Send chat message"] },
    ]);
  });

  test("a query ranks names ahead of descriptions", () => {
    expect(menu("counter")).toEqual([
      { section: "Built-in", group: "Counters", names: ["Decrement counter", "Increment counter"] },
    ]);
  });

  test("matches a description when no name does", () => {
    expect(menu("on-stream")).toEqual([{ section: "Built-in", group: "Alerts", names: ["Alert"] }]);
  });

  test("a query naming a section, heading or module lists what is under it", () => {
    expect(menu("platforms").map((group) => group.group)).toEqual(["Govee", "OBS"]);
    expect(menu("govee")).toEqual([{ section: "Platforms", group: "Govee", names: ["Set Govee light colour"] }]);
    expect(menu("twitch")).toEqual([
      { section: "Twitch Platform", group: "Twitch Platform", names: ["Send chat message"] },
    ]);
  });

  test("a section holding the better match leads, built-in aside", () => {
    const presets = [
      action("Zap", "Alpha", "Does a thing."),
      action("Thing", "Zeta"),
      action("Print", "woofx3", "Prints a thing.", ["system.workflow"]),
    ];
    expect(actionMenuGroups(presets, "thing").map((group) => group.sectionLabel)).toEqual([
      "Built-in",
      "Zeta",
      "Alpha",
    ]);
  });

  test("a selected section narrows the menu to it", () => {
    expect(menu("", "taxonomy:platform").map((group) => group.group)).toEqual(["Govee", "OBS"]);
    expect(menu("", ALL_SECTIONS)).toHaveLength(6);
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
      { key: "taxonomy:system", label: "Built-in", count: 4 },
      { key: "taxonomy:platform", label: "Platforms", count: 2 },
      { key: "module:Twitch Platform", label: "Twitch Platform", count: 1 },
    ]);
  });

  test("counts only what the query matches", () => {
    expect(actionSectionCounts(PRESETS, "counter")).toEqual([{ key: "taxonomy:system", label: "Built-in", count: 2 }]);
  });
});

describe("flattenActionMenu", () => {
  test("walks groups in the order they are shown", () => {
    expect(flattenActionMenu(actionMenuGroups(PRESETS, "")).map((preset) => preset.name)).toEqual([
      "Alert",
      "Decrement counter",
      "Increment counter",
      "Print",
      "Set Govee light colour",
      "Switch OBS scene",
      "Send chat message",
    ]);
  });
});
