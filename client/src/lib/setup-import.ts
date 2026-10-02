import type { ImportItemOutcome, ImportReport, ImportReportItem } from "@convex/setupImports";

/**
 * How an import from Firebot or Streamer.bot reads in the UI: the sections its
 * items fall into, before and after they are applied, and the file limits.
 */

/** Largest Firebot backup the browser opens. A backup holds the profile's sounds and overlay files too. */
export const MAX_IMPORT_ZIP_BYTES = 512 * 1024 * 1024;
/** Largest setup file or Streamer.bot export read as text. */
export const MAX_IMPORT_TEXT_BYTES = 50 * 1024 * 1024;

export function importFileProblem(file: { name: string; size: number }): string | null {
  const isZip = file.name.toLowerCase().endsWith(".zip");
  const limit = isZip ? MAX_IMPORT_ZIP_BYTES : MAX_IMPORT_TEXT_BYTES;
  if (file.size > limit) {
    return `That file is ${Math.ceil(file.size / (1024 * 1024))} MiB; the largest this reads is ${limit / (1024 * 1024)} MiB.`;
  }
  if (file.size === 0) {
    return "That file is empty.";
  }
  return null;
}

/** Where an item stands, as one of the report's sections. */
export type ImportSection =
  | "ready"
  | "partial"
  | "unsupported"
  | "created"
  | "exists"
  | "needs_module"
  | "skipped"
  | "pending"
  | "failed"
  | "waiting";

export const IMPORT_SECTION_LABELS: Record<ImportSection, string> = {
  ready: "Comes over as it is",
  partial: "Comes over with changes",
  unsupported: "Can't come over",
  created: "Imported",
  exists: "Already on woofx3",
  needs_module: "Needs a module",
  skipped: "Left out",
  pending: "Waiting for the engine",
  failed: "Failed",
  waiting: "Not imported yet",
};

const SECTION_ORDER: readonly ImportSection[] = [
  "failed",
  "needs_module",
  "pending",
  "waiting",
  "created",
  "exists",
  "skipped",
  "partial",
  "ready",
  "unsupported",
];

export function itemSection(item: ImportReportItem, status: ImportReport["status"]): ImportSection {
  if (item.outcome !== null) {
    return item.outcome;
  }
  if (status === "review") {
    return item.readiness;
  }
  return "waiting";
}

export interface ReportSection {
  section: ImportSection;
  label: string;
  items: ImportReportItem[];
}

export function reportSections(report: ImportReport): ReportSection[] {
  const bySection = new Map<ImportSection, ImportReportItem[]>();
  for (const item of report.items) {
    const section = itemSection(item, report.status);
    bySection.set(section, [...(bySection.get(section) ?? []), item]);
  }
  return SECTION_ORDER.filter((section) => bySection.has(section)).map((section) => ({
    section,
    label: IMPORT_SECTION_LABELS[section],
    items: bySection.get(section) ?? [],
  }));
}

export interface ReviewSummary {
  importable: number;
  withChanges: number;
  unsupported: number;
}

export function reviewSummary(report: ImportReport): ReviewSummary {
  let importable = 0;
  let withChanges = 0;
  let unsupported = 0;
  for (const item of report.items) {
    if (item.readiness === "unsupported") {
      unsupported++;
    } else {
      importable++;
      if (item.readiness === "partial") {
        withChanges++;
      }
    }
  }
  return { importable, withChanges, unsupported };
}

/** How far an apply has got: items with an outcome, out of all of them. */
export function applyProgress(report: ImportReport): { done: number; total: number } {
  return {
    done: report.items.filter((item) => item.outcome !== null && item.outcome !== "pending").length,
    total: report.items.length,
  };
}

const RETRYABLE: ReadonlySet<ImportItemOutcome> = new Set(["needs_module", "failed"]);

export function canRetry(report: ImportReport): boolean {
  if (report.status === "queued") {
    return report.stalled;
  }
  return report.status === "done" && report.items.some((item) => item.outcome !== null && RETRYABLE.has(item.outcome));
}

export const IMPORT_KIND_LABELS: Record<ImportReportItem["kind"], string> = {
  group: "Group",
  counter: "Counter",
  command: "Command",
  workflow: "Workflow",
};
