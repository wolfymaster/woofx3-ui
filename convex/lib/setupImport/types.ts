import type { ConditionConfig } from "@woofx3/api";
import type { BuiltInGroupName } from "../starterPacks";

/**
 * A streamer's setup from another tool, converted into woofx3 terms.
 *
 * Converting is pure and catalog-free: an item names actions and triggers by
 * canonical ref and event subject, the way starter packs do, so a file can be
 * reviewed before the engine has the modules it needs. Applying resolves the
 * refs against the instance's catalog and creates each item through the same
 * engine calls the workflow builder, command editor and counters page make, so
 * the engine cannot tell an imported item from one a person built.
 */

export const IMPORT_SOURCES = ["firebot", "streamerbot"] as const;
export type ImportSource = (typeof IMPORT_SOURCES)[number];

export const IMPORT_SOURCE_LABELS: Record<ImportSource, string> = {
  firebot: "Firebot",
  streamerbot: "Streamer.bot",
};

/** Canonical refs of every action an import can produce. */
export const IMPORT_ACTION_REFS = {
  chatReply: "woofx3:action:chat.reply",
  counterIncrement: "woofx3:action:counter.increment",
  counterDecrement: "woofx3:action:counter.decrement",
  counterSet: "woofx3:action:counter.set",
  shoutout: "woofx3_twitch:action:twitch.shoutout",
  clip: "woofx3_twitch:action:twitch.clip",
  marker: "woofx3_twitch:action:twitch.marker",
  updateStream: "woofx3_twitch:action:twitch.update_stream",
  timeout: "woofx3_twitch:action:twitch.timeout",
  switchScene: "woofx3_obs:action:obs.switch_scene",
  sourceVisibility: "woofx3_obs:action:obs.set_source_visibility",
  inputMute: "woofx3_obs:action:obs.set_input_mute",
} as const;

export type ImportActionRef = (typeof IMPORT_ACTION_REFS)[keyof typeof IMPORT_ACTION_REFS];

/** A counter this import creates or reuses, filled in with its canonical id when applied. */
export interface CounterReference {
  counterKey: string;
}

export type ImportParameter = string | number | boolean | CounterReference;

export function isCounterReference(value: unknown): value is CounterReference {
  return (
    typeof value === "object" && value !== null && typeof (value as { counterKey?: unknown }).counterKey === "string"
  );
}

export interface ImportActionStep {
  kind: "action";
  /** How the report describes the step. */
  label: string;
  ref: ImportActionRef;
  parameters: Record<string, ImportParameter>;
}

export interface ImportDelayStep {
  kind: "delay";
  label: string;
  ms: number;
}

/** An if/else. Each side runs only when the conditions do, or do not, hold. */
export interface ImportBranchStep {
  kind: "branch";
  label: string;
  conditions: ConditionConfig[];
  logic: "and" | "or";
  whenTrue: ImportStep[];
  whenFalse: ImportStep[];
}

export type ImportStep = ImportActionStep | ImportDelayStep | ImportBranchStep;

/**
 * Something the import could not carry over exactly. `blocking` means the item
 * cannot be created at all, because creating it without the missing piece would
 * make it run when the original would not; otherwise the item is created
 * without it.
 */
export interface ImportNote {
  message: string;
  /** Source the streamer may want to rebuild by hand, such as a C# code action. */
  detail?: string;
  blocking?: boolean;
}

export type ImportReadiness = "ready" | "partial" | "unsupported";

export interface CommandAccess {
  builtIn: BuiltInGroupName[];
  /** Keys of the group items in the same import. */
  groupKeys: string[];
  usernames: string[];
}

export interface ImportGroupSpec {
  name: string;
  description: string;
  members: string[];
}

export interface ImportCounterSpec {
  /** The counter's id on woofx3: a canonical-id segment. */
  resourceInstanceId: string;
  displayName: string;
  initialValue: number;
}

export interface ImportCommandSpec {
  /** The command word, without the `!`. */
  command: string;
  enabled: boolean;
  cooldown: number;
  access: CommandAccess;
  /**
   * What the command runs. Only actions: a command whose source did more (a
   * delay, an if/else) comes with a workflow item on its chat event instead.
   */
  steps: ImportActionStep[];
}

export type ImportTrigger =
  | { kind: "event"; event: string; conditions: ConditionConfig[]; logic: "and" | "or" }
  | { kind: "schedule"; schedule: string };

export interface ImportWorkflowSpec {
  name: string;
  description: string;
  enabled: boolean;
  trigger: ImportTrigger;
  steps: ImportStep[];
  /** Key of a command item this workflow belongs to; it is only created when that command is. */
  commandKey?: string;
}

interface ImportItemBase {
  /** Stable within a source: the same file imported twice gives the same keys. */
  key: string;
  /** What the streamer called it. */
  name: string;
  /** Where it came from, e.g. "Firebot command". */
  origin: string;
  notes: ImportNote[];
}

export type ImportItem =
  | (ImportItemBase & { kind: "group"; spec: ImportGroupSpec })
  | (ImportItemBase & { kind: "counter"; spec: ImportCounterSpec })
  | (ImportItemBase & { kind: "command"; spec: ImportCommandSpec })
  | (ImportItemBase & { kind: "workflow"; spec: ImportWorkflowSpec });

export type ImportItemKind = ImportItem["kind"];

/** Applying order: what a later kind refers to is created first. */
export const IMPORT_KIND_ORDER: readonly ImportItemKind[] = ["group", "counter", "command", "workflow"];

/**
 * Things the source had that woofx3 has no place for at all, such as currencies
 * or overlay widgets. Reported, never created.
 */
export interface ImportLeftover {
  origin: string;
  name: string;
  message: string;
  detail?: string;
}

export interface ImportPlan {
  source: ImportSource;
  /** The setup's own name, or the file's when it has none. */
  label: string;
  items: ImportItem[];
  leftovers: ImportLeftover[];
}

export function itemReadiness(item: Pick<ImportItem, "notes">): ImportReadiness {
  if (item.notes.some((note) => note.blocking === true)) {
    return "unsupported";
  }
  return item.notes.length > 0 ? "partial" : "ready";
}
