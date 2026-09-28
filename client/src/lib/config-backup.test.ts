import { describe, expect, it } from "bun:test";
import type { ConfigImportPlan, ConfigImportPlanItem } from "@convex/lib/configBundle";
import { backupFileName, backupFileProblem, groupByKind, splitReasons, writeCount } from "./config-backup";

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
  it("separates blocking reasons from warnings", () => {
    const { blocking, warnings } = splitReasons([
      { code: "missing_module", message: "counter is not installed", blocking: true },
      { code: "renamed", message: "imported as Raid (imported)", blocking: false },
    ]);
    expect(blocking.map((reason) => reason.code)).toEqual(["missing_module"]);
    expect(warnings.map((reason) => reason.code)).toEqual(["renamed"]);
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
