import { describe, expect, test } from "bun:test";
import { Square } from "lucide-react";
import { ALL_SOURCES, actionMenuGroups, actionSourceCounts, flattenActionMenu } from "./action-menu";
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
  action("Increment counter", "Counter", "Increase the chosen counter by the configured step."),
  action("Decrement counter", "Counter", "Decrease the chosen counter."),
  action("Print", "woofx3", "Log the step's parameters.", ["system.workflow"]),
  action("Alert", "woofx3", "Play an on-stream alert.", ["system.workflow", "alert.renderer"]),
];

function menu(query: string, source?: string) {
  return actionMenuGroups(PRESETS, query, source).map((group) => ({
    source: group.source,
    names: group.actions.map((preset) => preset.name),
  }));
}

describe("actionMenuGroups", () => {
  test("groups by module, system actions first, then alphabetically", () => {
    expect(menu("")).toEqual([
      { source: "woofx3", names: ["Alert", "Print"] },
      { source: "Counter", names: ["Decrement counter", "Increment counter"] },
      { source: "Twitch Platform", names: ["Send chat message"] },
    ]);
  });

  test("a query ranks names ahead of descriptions", () => {
    expect(menu("counter")).toEqual([{ source: "Counter", names: ["Decrement counter", "Increment counter"] }]);
  });

  test("matches a description when no name does", () => {
    expect(menu("on-stream")).toEqual([{ source: "woofx3", names: ["Alert"] }]);
  });

  test("a query naming a module lists that module's actions", () => {
    expect(menu("twitch")).toEqual([{ source: "Twitch Platform", names: ["Send chat message"] }]);
  });

  test("keeps a non-system group ahead of system when it holds the better match", () => {
    expect(menu("increment")).toEqual([{ source: "Counter", names: ["Increment counter"] }]);
  });

  test("a selected source narrows the menu to that module", () => {
    expect(menu("", "Counter")).toEqual([{ source: "Counter", names: ["Decrement counter", "Increment counter"] }]);
    expect(menu("", ALL_SOURCES)).toHaveLength(3);
  });

  test("no match leaves nothing", () => {
    expect(menu("nothing here")).toEqual([]);
  });
});

describe("actionSourceCounts", () => {
  test("counts every module's actions in the order the groups appear", () => {
    expect(actionSourceCounts(PRESETS, "")).toEqual([
      { source: "woofx3", count: 2 },
      { source: "Counter", count: 2 },
      { source: "Twitch Platform", count: 1 },
    ]);
  });

  test("counts only what the query matches", () => {
    expect(actionSourceCounts(PRESETS, "counter")).toEqual([{ source: "Counter", count: 2 }]);
  });
});

describe("flattenActionMenu", () => {
  test("walks groups in the order they are shown", () => {
    expect(flattenActionMenu(actionMenuGroups(PRESETS, "")).map((preset) => preset.name)).toEqual([
      "Alert",
      "Print",
      "Decrement counter",
      "Increment counter",
      "Send chat message",
    ]);
  });
});
