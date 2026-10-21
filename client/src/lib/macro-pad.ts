// A macro pad button. Its `{{name}}` variables live in
// convex/lib/macroVariables.ts, shared with the remote trigger route.

import type { Id } from "@convex/_generated/dataModel";
import type { MacroActionStep, MacroActionType, MacroConfig } from "@convex/lib/macroVariables";
import type { ActionNode } from "@/lib/workflow-tree";

export {
  applyMacroVariables,
  extractMacroVariables,
  hasMacroVariables,
  type MacroActionStep,
  type MacroActionType,
  type MacroConfig,
  type MacroHttpMethod,
} from "@convex/lib/macroVariables";

/** A macro's editable fields — everything except its server-assigned id. */
export type MacroInput = Omit<MacroButton, "id">;

export interface MacroButton {
  /** Macros are kept by the dashboard, so a macro is its Convex row. */
  id: Id<"macros">;
  label: string;
  /** Lucide icon name, resolved through resolveLucideIcon. */
  icon?: string;
  /** Six-digit hex (`#rrggbb`). Undefined leaves the tile in the default card style. */
  color?: string;
  type: MacroActionType;
  config: MacroConfig;
}

/**
 * Default swatches, mid-tone so they stay legible tinting a tile on both the
 * light and dark grounds. Matches the Tailwind 500 values the announcement
 * swatches in broadcast-controls already use.
 */
export const MACRO_COLOR_PRESETS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "#ef4444", label: "Red" },
  { value: "#f97316", label: "Orange" },
  { value: "#f59e0b", label: "Amber" },
  { value: "#22c55e", label: "Green" },
  { value: "#14b8a6", label: "Teal" },
  { value: "#3b82f6", label: "Blue" },
  { value: "#6366f1", label: "Indigo" },
  { value: "#a855f7", label: "Purple" },
  { value: "#ec4899", label: "Pink" },
  { value: "#64748b", label: "Slate" },
];

const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

/**
 * Exactly `#rrggbb`. The tile's background wash is built by appending an alpha
 * pair to the stored value, which only produces a valid color for the six-digit
 * form — so anything else is refused at the input rather than rendering as a
 * broken style.
 */
export function isHexColor(value: string | undefined): value is string {
  return typeof value === "string" && HEX_COLOR_PATTERN.test(value);
}

/**
 * A chat-command button's command word and the text after it. `command` is
 * normally the bare word with the text in `commandText`, but it may instead
 * hold a whole typed line such as `!so {{channel}}` with no `commandText`;
 * that line is split at its first whitespace, the way chat splits it.
 */
export function chatCommandParts(config: MacroConfig): { command: string; text: string } {
  const command = (config.command ?? "").trim();
  if (config.commandText !== undefined) {
    return { command: command.replace(/^!/, ""), text: config.commandText.trim() };
  }
  const line = command.replace(/^!/, "");
  const space = line.search(/\s/);
  if (space === -1) {
    return { command: line, text: "" };
  }
  return { command: line.slice(0, space), text: line.slice(space + 1).trim() };
}

/** The id a button's one action has while the flow's step editors edit it; never stored. */
const MACRO_STEP_ID = "action-1";

/** A "run-action" button's action as the flow's step editors read it. */
export function macroStepNode(step: MacroActionStep): ActionNode {
  return {
    type: "action",
    id: MACRO_STEP_ID,
    action: step.action,
    ...(step.function && { function: step.function }),
    ...(step.ref && { ref: step.ref }),
    parameters: step.parameters ?? {},
  };
}

/** What a button stores of a step the flow's editors changed: the action and its settings, nothing else. */
export function macroStepFromNode(node: ActionNode): MacroActionStep {
  return {
    action: node.action,
    ...(node.function && { function: node.function }),
    ...(node.ref && { ref: node.ref }),
    parameters: node.parameters,
  };
}

/**
 * The label a button is saved with. A run-action button reads as its step's
 * sentence ("Add to Hype counter") until the streamer types a label of their
 * own; `typed` is null, or empty, while they have not.
 */
export function macroButtonLabel(typed: string | null, sentence: string): string {
  return typed?.trim() || sentence.trim();
}

/**
 * The typed label an opened button starts with: null when its stored label is
 * its step's sentence, so the label keeps following the step as it is changed.
 */
export function typedMacroLabel(stored: string, sentence: string): string | null {
  return sentence !== "" && stored.trim() === sentence.trim() ? null : stored;
}
