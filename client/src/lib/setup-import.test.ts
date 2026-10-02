import { describe, expect, test } from "bun:test";
import type { Id } from "@convex/_generated/dataModel";
import type { ImportReport, ImportReportItem } from "@convex/setupImports";
import { applyProgress, canRetry, importFileProblem, reportSections, reviewSummary } from "./setup-import";

function item(overrides: Partial<ImportReportItem>): ImportReportItem {
  return {
    id: crypto.randomUUID() as Id<"setupImportItems">,
    kind: "workflow",
    name: "Item",
    origin: "Firebot event",
    readiness: "ready",
    notes: [],
    steps: [],
    outcome: null,
    message: null,
    ...overrides,
  };
}

function report(status: ImportReport["status"], items: ImportReportItem[], stalled = false): ImportReport {
  return {
    id: "import" as Id<"setupImports">,
    source: "firebot",
    label: "Setup",
    status,
    createdAt: 0,
    waitingFor: null,
    stalled,
    leftovers: [],
    items,
  };
}

describe("reportSections", () => {
  test("sorts a setup under review by how it comes over", () => {
    const sections = reportSections(
      report("review", [
        item({ readiness: "unsupported" }),
        item({ readiness: "ready" }),
        item({ readiness: "partial" }),
      ])
    );
    expect(sections.map((section) => section.section)).toEqual(["partial", "ready", "unsupported"]);
  });

  test("sorts an applied setup by outcome, problems first", () => {
    const sections = reportSections(
      report("applying", [item({ outcome: "created" }), item({ outcome: null }), item({ outcome: "failed" })])
    );
    expect(sections.map((section) => section.section)).toEqual(["failed", "waiting", "created"]);
  });
});

describe("reviewSummary and applyProgress", () => {
  test("count what comes over and what is done", () => {
    const items = [
      item({ readiness: "ready", outcome: "created" }),
      item({ readiness: "partial", outcome: "pending" }),
      item({ readiness: "unsupported", outcome: "skipped" }),
    ];
    expect(reviewSummary(report("review", items))).toEqual({ importable: 2, withChanges: 1, unsupported: 1 });
    expect(applyProgress(report("applying", items))).toEqual({ done: 2, total: 3 });
  });
});

describe("canRetry", () => {
  test("offers a retry for items that needed a module or failed, and for a stalled import", () => {
    expect(canRetry(report("done", [item({ outcome: "needs_module" })]))).toBe(true);
    expect(canRetry(report("done", [item({ outcome: "created" }), item({ outcome: "skipped" })]))).toBe(false);
    expect(canRetry(report("queued", [], true))).toBe(true);
    expect(canRetry(report("queued", []))).toBe(false);
  });
});

describe("importFileProblem", () => {
  test("allows large backups but not large text files", () => {
    expect(importFileProblem({ name: "backup.zip", size: 200 * 1024 * 1024 })).toBeNull();
    expect(importFileProblem({ name: "setup.firebotsetup", size: 200 * 1024 * 1024 })).toContain("largest");
    expect(importFileProblem({ name: "x.sb", size: 0 })).toBe("That file is empty.");
  });
});
