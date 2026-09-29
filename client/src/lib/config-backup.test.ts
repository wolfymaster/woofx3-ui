import { describe, expect, it } from "bun:test";
import type { ConfigImportPlan, ConfigImportPlanItem } from "@convex/lib/configBundle";
import {
  accessGrants,
  backupFileName,
  backupFileProblem,
  groupByKind,
  reasonLabel,
  splitReasons,
  writeCount,
} from "./config-backup";

function item(kind: ConfigImportPlanItem["kind"], key: string): ConfigImportPlanItem {
  return { kind, key, action: "create", targetName: key, reasons: [] };
}

describe("groupByKind", () => {
  it("orders kinds the way the engine applies them and drops empty kinds", () => {
    const groups = groupByKind([item("command", "hi"), item("workflow", "Raid"), item("group", "VIPs")]);
    expect(groups.map((group) => group.kind)).toEqual(["group", "workflow", "command"]);
    expect(groups[0].label).toBe("Command groups");
  });

  it("keeps the order of items within a kind", () => {
    const groups = groupByKind([item("command", "b"), item("command", "a")]);
    expect(groups[0].items.map((entry) => entry.key)).toEqual(["b", "a"]);
  });

  it("returns nothing for an empty plan", () => {
    expect(groupByKind([])).toEqual([]);
  });
});

describe("splitReasons", () => {
  it("separates blocking reasons, reasons to read before applying, and notes", () => {
    const { blocking, attention, notes } = splitReasons([
      { code: "missing_module", message: "counter is not installed", blocking: true },
      { code: "renamed", message: "imported as Raid (imported)", blocking: false },
      { code: "grants_access", message: "grants alice, bob", blocking: false },
      { code: "privileged_action", message: "bans chatters", blocking: false },
      { code: "rename_exhausted", message: "no free name", blocking: true },
    ]);
    expect(blocking.map((reason) => reason.code)).toEqual(["missing_module", "rename_exhausted"]);
    expect(attention.map((reason) => reason.code)).toEqual(["grants_access", "privileged_action"]);
    expect(notes.map((reason) => reason.code)).toEqual(["renamed"]);
  });
});

describe("reasonLabel", () => {
  it("labels known codes", () => {
    expect(reasonLabel("grants_access")).toBe("Grants access");
  });

  it("falls back to the code for one this UI does not know", () => {
    expect(reasonLabel("some_new_code")).toBe("some new code");
  });
});

describe("accessGrants", () => {
  it("collects every grants_access reason with the item it belongs to", () => {
    const plan: ConfigImportPlan = {
      onConflict: "skip",
      items: [
        {
          ...item("group", "VIPs"),
          reasons: [
            { code: "grants_access", message: "adds alice and bob to VIPs", blocking: false },
            { code: "renamed", message: "renamed", blocking: false },
          ],
        },
        item("workflow", "Raid"),
        {
          ...item("command", "vanish"),
          reasons: [{ code: "grants_access", message: "grants carol", blocking: false }],
        },
      ],
      summary: { create: 3, update: 0, skip: 0, conflict: 0 },
      missingModules: [],
    };
    expect(accessGrants(plan)).toEqual([
      { kind: "group", key: "VIPs", message: "adds alice and bob to VIPs" },
      { kind: "command", key: "vanish", message: "grants carol" },
    ]);
  });
});

describe("writeCount", () => {
  it("counts creates and updates only", () => {
    const plan: ConfigImportPlan = {
      onConflict: "skip",
      items: [],
      summary: { create: 3, update: 2, skip: 7, conflict: 1 },
      missingModules: [],
    };
    expect(writeCount(plan)).toBe(5);
  });
});

describe("backupFileName", () => {
  it("uses the instance slug and the local date", () => {
    expect(backupFileName("Wolfy's Stream!", new Date(2026, 8, 5, 23, 59))).toBe(
      "woofx3-backup-wolfy-s-stream-2026-09-05.json"
    );
  });

  it("falls back when nothing of the name survives", () => {
    expect(backupFileName("***", new Date(2026, 0, 1))).toBe("woofx3-backup-instance-2026-01-01.json");
  });
});

describe("backupFileProblem", () => {
  it("accepts a file at the limit", () => {
    expect(backupFileProblem({ name: "b.json", size: 5 * 1024 * 1024 })).toBeNull();
  });

  it("refuses a file over the limit", () => {
    expect(backupFileProblem({ name: "b.json", size: 5 * 1024 * 1024 + 1 })).toBe(
      "That file is 5.0 MiB. A backup can be at most 5 MiB."
    );
  });

  it("refuses an empty file", () => {
    expect(backupFileProblem({ name: "b.json", size: 0 })).toBe("That file is empty.");
  });
});
