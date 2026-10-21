import type { ConfigField } from "@woofx3/api/ui-schema";
import type { VariableOption } from "@/lib/workflow-variables";

/**
 * The rules an action step's settings are held to while they are edited: which ones
 * still need a value, which values are out of bounds, and which values from earlier
 * in the workflow a setting can take instead of a fixed one.
 *
 * The engine checks none of this; a step saved with a required setting empty runs and
 * fails, so the editor says so before it is saved.
 */

/** A value is a reference to an earlier value when all of it is one `${…}`. */
const WHOLE_REFERENCE = /^\$\{[^{}]+\}$/;

export function isWholeReference(value: unknown): value is string {
  return typeof value === "string" && WHOLE_REFERENCE.test(value.trim());
}

/** Nothing entered: no value, blank text, no rows. */
export function isEmptySetting(value: unknown): boolean {
  if (value === undefined || value === null) {
    return true;
  }
  if (typeof value === "string") {
    return value.trim() === "";
  }
  return Array.isArray(value) && value.length === 0;
}

/**
 * Field types that never go without a value: a switch is on or off, and a button
 * stores nothing at all.
 */
const ALWAYS_SET = new Set<string>(["toggle", "button"]);

/** The required settings with nothing in them yet, in the order the action declares them. */
export function missingSettings(fields: readonly ConfigField[], values: Record<string, unknown>): ConfigField[] {
  return fields.filter((field) => field.required && !ALWAYS_SET.has(field.type) && isEmptySetting(values[field.id]));
}

export const MISSING_SETTING_MESSAGE = "Fill this in so the step can run.";

export interface SettingProblem {
  /** "missing" while a required setting is empty; "invalid" for a value the action can't take. */
  kind: "missing" | "invalid";
  message: string;
}

/**
 * What is wrong with one setting's value, or null when nothing is. A value taken from
 * earlier in the workflow is only known when the step runs, so it passes.
 */
export function settingProblem(field: ConfigField, value: unknown): SettingProblem | null {
  if (isWholeReference(value)) {
    return null;
  }
  if (isEmptySetting(value)) {
    return field.required && !ALWAYS_SET.has(field.type) ? { kind: "missing", message: MISSING_SETTING_MESSAGE } : null;
  }
  if (field.type === "number") {
    return typeof value === "number" ? boundsProblem(field, [value]) : null;
  }
  if (field.type === "range" && typeof value === "object") {
    const range = value as { type?: unknown; value?: unknown; min?: unknown; max?: unknown };
    if (range.type === "range") {
      if (typeof range.min === "number" && typeof range.max === "number" && range.min > range.max) {
        return { kind: "invalid", message: "The lowest can't be more than the highest." };
      }
      return boundsProblem(
        field,
        [range.min, range.max].filter((n): n is number => typeof n === "number")
      );
    }
    return typeof range.value === "number" ? boundsProblem(field, [range.value]) : null;
  }
  return null;
}

function boundsProblem(field: Pick<ConfigField, "min" | "max">, amounts: readonly number[]): SettingProblem | null {
  const { min, max } = field;
  const outside = amounts.some((n) => (min !== undefined && n < min) || (max !== undefined && n > max));
  if (!outside) {
    return null;
  }
  if (min !== undefined && max !== undefined) {
    return { kind: "invalid", message: `Choose between ${min} and ${max}.` };
  }
  if (min !== undefined) {
    return { kind: "invalid", message: `Choose ${min} or more.` };
  }
  return { kind: "invalid", message: `Choose ${max} or less.` };
}

/**
 * The parameters with one setting changed. A setting cleared is left out rather than
 * stored empty, so the action sees it unset and uses its own default.
 */
export function withSetting(
  parameters: Record<string, unknown>,
  fieldId: string,
  value: unknown
): Record<string, unknown> {
  const next = { ...parameters };
  if (value === undefined || value === null || value === "") {
    delete next[fieldId];
  } else {
    next[fieldId] = value;
  }
  return next;
}

/** How a setting can take a value from earlier in the workflow, if it can at all. */
export type VariableUse =
  /** Text with values written into it, as `{name}`. */
  | "insert"
  /** The whole value replaced by one earlier value. */
  | "replace"
  /** Not a single value: rows, a canvas of widgets, a button, a placement's theme. */
  | "none";

const NO_VARIABLE_TYPES = new Set<string>(["list", "layout", "button", "theme"]);

export function variableUse(field: Pick<ConfigField, "type" | "source">): VariableUse {
  if (NO_VARIABLE_TYPES.has(field.type)) {
    return "none";
  }
  // A text field draws on a fixed list only as suggestions, so it stays text.
  const pickedFromList = field.source !== undefined && field.source.kind !== "internal";
  if (field.type === "text" && !pickedFromList) {
    return "insert";
  }
  return "replace";
}

/** The value types each kind of control can take; anything else gets every value. */
const ACCEPTED_TYPES: Partial<Record<string, ReadonlySet<string>>> = {
  number: new Set(["number"]),
  range: new Set(["number"]),
  toggle: new Set(["boolean"]),
};

/**
 * The earlier values a setting is offered. A number takes numbers and a switch takes
 * yes/no values; a value of no declared type might be either, so it is offered too.
 */
export function variablesForSetting(
  field: Pick<ConfigField, "type">,
  variables: readonly VariableOption[]
): VariableOption[] {
  const accepted = ACCEPTED_TYPES[field.type];
  if (!accepted) {
    return [...variables];
  }
  return variables.filter((variable) => !variable.type || variable.type === "unknown" || accepted.has(variable.type));
}

/** Text with `token` added at its end, a space apart. */
export function appendToken(text: unknown, token: string): string {
  const current = typeof text === "string" ? text : "";
  return current === "" || current.endsWith(" ") ? `${current}${token}` : `${current} ${token}`;
}
