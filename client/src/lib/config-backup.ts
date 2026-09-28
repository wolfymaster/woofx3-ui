import {
  CONFIG_BUNDLE_MAX_BYTES,
  type ConfigImportAction,
  type ConfigImportOutcome,
  type ConfigImportPlan,
  type ConfigImportReason,
  type ConfigItemKind,
  type ConfigSection,
} from "@convex/lib/configBundle";

/** The order the engine applies kinds in, which is also the order they are shown. */
export const CONFIG_ITEM_KINDS: readonly ConfigItemKind[] = ["group", "resource", "workflow", "command"];

export const CONFIG_ITEM_KIND_LABELS: Record<ConfigItemKind, string> = {
  group: "Command groups",
  resource: "Resources",
  workflow: "Workflows",
  command: "Commands",
};

export const CONFIG_SECTION_LABELS: Record<ConfigSection, { label: string; description: string }> = {
  workflows: { label: "Workflows", description: "Your workflows, with their triggers and steps." },
  commands: { label: "Chat commands", description: "Commands you created, with their actions and cooldowns." },
  groups: { label: "Command groups", description: "Groups you created. Built-in groups exist everywhere." },
  resources: {
    label: "Resources",
    description: "Counters, timers, queues and other module resources, with their settings but not their values.",
  },
};

export const IMPORT_ACTION_LABELS: Record<ConfigImportAction, string> = {
  create: "Create",
  update: "Replace",
  skip: "Skip",
  conflict: "Conflict",
};

export const IMPORT_OUTCOME_LABELS: Record<ConfigImportOutcome, string> = {
  created: "Created",
  updated: "Replaced",
  skipped: "Skipped",
  conflict: "Conflict",
  failed: "Failed",
};

export interface KindGroup<T extends { kind: ConfigItemKind }> {
  kind: ConfigItemKind;
  label: string;
  items: T[];
}

/** Items grouped by kind in apply order, keeping their order within a kind; empty kinds are left out. */
export function groupByKind<T extends { kind: ConfigItemKind }>(items: readonly T[]): KindGroup<T>[] {
  return CONFIG_ITEM_KINDS.map((kind) => ({
    kind,
    label: CONFIG_ITEM_KIND_LABELS[kind],
    items: items.filter((item) => item.kind === kind),
  })).filter((group) => group.items.length > 0);
}

export function splitReasons(reasons: readonly ConfigImportReason[]): {
  blocking: ConfigImportReason[];
  warnings: ConfigImportReason[];
} {
  return {
    blocking: reasons.filter((reason) => reason.blocking),
    warnings: reasons.filter((reason) => !reason.blocking),
  };
}

/** How many items an import of this plan would write. */
export function writeCount(plan: ConfigImportPlan): number {
  return plan.summary.create + plan.summary.update;
}

/**
 * `woofx3-backup-<instance>-<YYYY-MM-DD>.json`, the instance name reduced to
 * lowercase letters, digits and single hyphens so the name is safe on every
 * file system. The date is the creator's local date, the one they will look
 * for when picking a backup to restore.
 */
export function backupFileName(instanceName: string, date: Date): string {
  const slug = instanceName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const year = date.getFullYear().toString().padStart(4, "0");
  const month = (date.getMonth() + 1).toString().padStart(2, "0");
  const day = date.getDate().toString().padStart(2, "0");
  return `woofx3-backup-${slug || "instance"}-${year}-${month}-${day}.json`;
}

/** Why a picked file cannot be imported, or null when it can be sent for a preview. */
export function backupFileProblem(file: { name: string; size: number }): string | null {
  if (file.size === 0) {
    return "That file is empty.";
  }
  if (file.size > CONFIG_BUNDLE_MAX_BYTES) {
    return `That file is ${formatMiB(file.size)}. A backup can be at most ${formatMiB(CONFIG_BUNDLE_MAX_BYTES)}.`;
  }
  return null;
}

function formatMiB(bytes: number): string {
  const mib = bytes / (1024 * 1024);
  return `${Number.isInteger(mib) ? mib : mib.toFixed(1)} MiB`;
}
