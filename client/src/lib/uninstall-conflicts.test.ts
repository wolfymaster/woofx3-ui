import { describe, expect, test } from "bun:test";
import type { StepNode } from "@/lib/workflow-tree";
import {
  type ConflictResource,
  manualFixNote,
  stepIdsUsing,
  usageRows,
  withoutThemedWidgets,
} from "./uninstall-conflicts";

const CHEER = "twitch_platform:trigger:twitch.channel.cheer";
const SHOUT = "twitch_platform:action:shoutout";
const THEME = "neon:theme:glow";

describe("usageRows", () => {
  test("a workflow on the module's trigger is one row that deletes it, covering its steps", () => {
    const conflicts: ConflictResource[] = [
      {
        resourceType: "trigger",
        resourceName: CHEER,
        usedBy: [{ sourceType: "workflow", sourceId: "w1", context: "trigger" }],
      },
      {
        resourceType: "action",
        resourceName: SHOUT,
        usedBy: [
          { sourceType: "workflow", sourceId: "w1", context: "step[0]" },
          { sourceType: "workflow", sourceId: "w2", context: "step[1]" },
          { sourceType: "workflow", sourceId: "w2", context: "step[3].function" },
        ],
      },
    ];
    const rows = usageRows(conflicts);
    expect(rows.map((row) => [row.user?.sourceId, row.fix])).toEqual([
      ["w1", "workflow"],
      ["w2", "steps"],
    ]);
  });

  test("a scene wearing the theme clears its widgets; a command or a dependent module is cleared by hand", () => {
    const rows = usageRows([
      {
        resourceType: "theme",
        resourceName: THEME,
        usedBy: [{ sourceType: "scene", sourceId: "s1", context: "widgets[0].settings.theme" }],
      },
      {
        resourceType: "action",
        resourceName: SHOUT,
        usedBy: [{ sourceType: "command", sourceId: "c1", context: "actions" }],
      },
      {
        resourceType: "module",
        resourceName: "neon",
        usedBy: [{ sourceType: "module", sourceId: "m2", context: "requires ^1.0.0" }],
      },
    ]);
    expect(rows.map((row) => row.fix)).toEqual(["widgets", "none", "none"]);
    expect(manualFixNote(rows[1])).toContain("chat command");
    expect(manualFixNote(rows[2])).toBe("Needs this module (requires ^1.0.0). Uninstall it first.");
  });

  test("a resource no one else uses is a row of its own", () => {
    const rows = usageRows([{ resourceType: "instance:counter", resourceId: "r1", resourceName: "hype" }]);
    expect(rows).toHaveLength(1);
    expect(manualFixNote(rows[0])).toBe("A counter made with this module. Delete it first.");
  });
});

describe("stepIdsUsing", () => {
  const action = (id: string, fields: Partial<StepNode> = {}): StepNode =>
    ({ type: "action", id, action: "function", parameters: {}, ...fields }) as StepNode;

  test("finds steps by action ref or function, inside condition branches too", () => {
    const steps: StepNode[] = [
      action("a", { ref: SHOUT }),
      action("b", { ref: "other:action:x" }),
      {
        type: "condition",
        id: "c",
        conditions: [],
        thenBranch: [action("d", { function: SHOUT } as Partial<StepNode>)],
        elseBranch: [],
      },
    ];
    expect(stepIdsUsing(steps, SHOUT)).toEqual(["a", "d"]);
  });
});

describe("withoutThemedWidgets", () => {
  test("drops top-level placements and widgets nested in an alert layout, keeping the holder", () => {
    const widgets = [
      { id: "1", name: "Glow text", settings: { theme: THEME } },
      {
        id: "2",
        name: "Alert box",
        settings: {
          layout: { widgets: { inner: { name: "Glow title", settings: { theme: THEME } }, keep: { settings: {} } } },
        },
      },
      { id: "3", settings: { theme: "other:theme:x" } },
    ];
    const { value, removed } = withoutThemedWidgets(widgets, THEME);
    expect(removed).toEqual(["Glow text", "Glow title"]);
    expect(value).toEqual([
      { id: "2", name: "Alert box", settings: { layout: { widgets: { keep: { settings: {} } } } } },
      { id: "3", settings: { theme: "other:theme:x" } },
    ]);
  });
});
