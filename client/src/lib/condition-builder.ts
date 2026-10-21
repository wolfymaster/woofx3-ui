import type { ConditionConfig, ConditionOperator } from "@woofx3/api";
import type { CatalogTriggerRow } from "@/hooks/use-workflow-catalog";
import { parseConfigFields } from "@/lib/parse-config-fields";
import type { ViewerFactsState } from "@/lib/viewer-facts";
import type { VariableOption } from "@/lib/workflow-variables";

/**
 * The condition builder's model: which values a condition can check, what each can be
 * compared with, and how a row reads as a sentence.
 *
 * Every operator offered is one the engine evaluates (EvaluateOperator in the engine's
 * workflow/internal/expression/evaluator.go), and only where it means what its label
 * says for the value's type: the engine compares any pair, but "contains" on a number
 * compares its text, and "is more than" on text compares alphabetically.
 */

/** How a value is picked and compared. */
export type ConditionFieldKind = "number" | "text" | "choice" | "boolean" | "collection";

export interface ConditionChoice {
  value: string | number;
  label: string;
}

/** One value a condition can check, as the field picker offers it. */
export interface ConditionField {
  /** The `${...}` reference stored as the condition's field. */
  ref: string;
  label: string;
  /** The picker heading it is listed under, e.g. "From the trigger". */
  group: string;
  kind: ConditionFieldKind;
  /** Every value the field can hold, for a `choice` field. */
  choices?: ConditionChoice[];
  description?: string;
}

/**
 * An entry of a field's operator menu. A yes-or-no field reads "is true" and "is false",
 * which are one operator with a fixed value.
 */
export interface OperatorChoice {
  id: string;
  label: string;
  operator: ConditionOperator;
  fixedValue?: boolean;
}

const OPERATOR_LABELS: Record<ConditionOperator, string> = {
  eq: "is",
  ne: "is not",
  gt: "is more than",
  gte: "is at least",
  lt: "is less than",
  lte: "is at most",
  between: "is between",
  contains: "contains",
  starts_with: "starts with",
  ends_with: "ends with",
  regex: "matches the pattern",
  in: "is one of",
  not_in: "is not one of",
  exists: "has a value",
  not_exists: "is missing",
};

function plain(operator: ConditionOperator): OperatorChoice {
  return { id: operator, label: OPERATOR_LABELS[operator], operator };
}

const OPERATORS_BY_KIND: Record<ConditionFieldKind, OperatorChoice[]> = {
  number: (["eq", "ne", "gt", "gte", "lt", "lte", "between", "in", "not_in", "exists", "not_exists"] as const).map(
    plain
  ),
  text: (
    ["eq", "ne", "contains", "starts_with", "ends_with", "regex", "in", "not_in", "exists", "not_exists"] as const
  ).map(plain),
  choice: (["eq", "ne", "in", "not_in", "exists", "not_exists"] as const).map(plain),
  boolean: [
    { id: "true", label: "is true", operator: "eq", fixedValue: true },
    { id: "false", label: "is false", operator: "eq", fixedValue: false },
    plain("exists"),
    plain("not_exists"),
  ],
  // A list or an object compares only as its printed text, so only its presence is offered.
  collection: [plain("exists"), plain("not_exists")],
};

export function operatorChoices(kind: ConditionFieldKind): OperatorChoice[] {
  return OPERATORS_BY_KIND[kind];
}

/** The menu entry a stored operator and value select, or undefined when the field's kind offers none. */
export function selectedOperator(kind: ConditionFieldKind, condition: ConditionConfig): OperatorChoice | undefined {
  return OPERATORS_BY_KIND[kind].find(
    (choice) =>
      choice.operator === condition.operator &&
      (choice.fixedValue === undefined || choice.fixedValue === condition.value)
  );
}

export function isListOperator(operator: ConditionOperator): boolean {
  return operator === "in" || operator === "not_in";
}

export function isValuelessOperator(operator: ConditionOperator): boolean {
  return operator === "exists" || operator === "not_exists";
}

/** A plain decimal literal. Stricter than Number(), which also accepts "0x10", "Infinity" and "". */
const NUMBER_LITERAL = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;

export function numberFromText(text: string): number | undefined {
  const trimmed = text.trim();
  if (!NUMBER_LITERAL.test(trimmed)) {
    return undefined;
  }
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : undefined;
}

function isReference(value: unknown): boolean {
  return typeof value === "string" && value.includes("${");
}

function kindOfType(type: string | undefined): ConditionFieldKind {
  switch (type) {
    case "number":
    case "range":
      return "number";
    case "boolean":
    case "toggle":
      return "boolean";
    case "array":
    case "object":
      return "collection";
    default:
      return "text";
  }
}

/**
 * A value's path as a label, for a field that declares only its path: "userName" reads
 * "User name", "data.goalName" reads "Goal name".
 */
export function labelFromPath(path: string): string {
  const last = path.split(".").pop() ?? path;
  const words = last
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .toLowerCase();
  if (words === "") {
    return path;
  }
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** A choice list as a payload carries it, or undefined when any entry is malformed. */
function readChoices(raw: unknown, type: string | undefined): ConditionChoice[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) {
    return undefined;
  }
  const choices: ConditionChoice[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") {
      return undefined;
    }
    const { value, label } = entry as { value?: unknown; label?: unknown };
    if (typeof label !== "string" || label === "") {
      return undefined;
    }
    if (typeof value === "number") {
      choices.push({ value, label });
    } else if (typeof value === "string") {
      // A select setting's values are text, but the payload carries a number field's value as one.
      const asNumber = type === "number" ? numberFromText(value) : undefined;
      choices.push({ value: asNumber ?? value, label });
    } else {
      return undefined;
    }
  }
  return choices;
}

/**
 * The values each emitted field of a trigger can hold, by path: the field's own
 * `options`, or else the options of the trigger's `select` setting whose `eventPath`
 * names it, since a trigger offering a choice in its settings carries that choice in
 * its events.
 */
export function triggerFieldChoices(row: CatalogTriggerRow | undefined): Map<string, ConditionChoice[]> {
  const byPath = new Map<string, ConditionChoice[]>();
  if (!row) {
    return byPath;
  }
  const emits = Array.isArray(row.emits) ? (row.emits as unknown[]) : [];
  const typeByPath = new Map<string, string | undefined>();
  for (const raw of emits) {
    if (!raw || typeof raw !== "object") {
      continue;
    }
    const field = raw as { path?: unknown; type?: unknown; options?: unknown };
    if (typeof field.path !== "string") {
      continue;
    }
    const type = typeof field.type === "string" ? field.type : undefined;
    typeByPath.set(field.path, type);
    const choices = readChoices(field.options, type);
    if (choices) {
      byPath.set(field.path, choices);
    }
  }
  for (const setting of parseConfigFields(row.configFields)) {
    if (setting.type !== "select" || !setting.eventPath || byPath.has(setting.eventPath)) {
      continue;
    }
    const choices = readChoices(setting.options, typeByPath.get(setting.eventPath));
    if (choices) {
      byPath.set(setting.eventPath, choices);
    }
  }
  return byPath;
}

/**
 * Whether the trigger's events name one viewer, which is when the engine fills
 * `${viewer.*}`: its emits mark exactly one `string` field `identity: "viewer"`. Must
 * match identityOf in the engine's workflow/viewer_resolver.go.
 */
export function triggerNamesViewer(row: CatalogTriggerRow | undefined): boolean {
  const emits = Array.isArray(row?.emits) ? (row?.emits as unknown[]) : [];
  const identities = emits.filter(
    (raw) => !!raw && typeof raw === "object" && (raw as { identity?: unknown }).identity === "viewer"
  ) as { type?: unknown }[];
  return identities.length === 1 && identities[0].type === "string";
}

const TRIGGER_DATA_PREFIX = "${trigger.data.";

function groupLabel(group: string): string {
  if (group === "Trigger") {
    return "From the trigger";
  }
  return `From ${group}`;
}

export interface ConditionFieldSources {
  /** What the step can read: the trigger's payload and earlier steps' outputs. */
  variables: readonly VariableOption[];
  /** The values of the trigger's emitted fields, by path; see triggerFieldChoices. */
  triggerChoices: ReadonlyMap<string, ConditionChoice[]>;
  /** The engine's `${viewer.*}` values, offered only when `namesViewer`. */
  viewerFacts: ViewerFactsState;
  namesViewer: boolean;
}

export const VIEWER_GROUP = "About the viewer";

/** What the engine lets a condition builder offer, beyond what the catalog says. */
export interface EngineConditionSupport {
  viewerFacts: ViewerFactsState;
  /** Whether a `${...}` inside a list value is resolved (`workflow.conditionListReferences`). */
  listReferences: boolean;
}

/** Everything a condition step's builder offers, for one step. */
export interface ConditionSources {
  fields: ConditionField[];
  namesViewer: boolean;
  support: EngineConditionSupport;
}

/**
 * What a condition step can check: the values `variables` names (the trigger's payload
 * and earlier steps' outputs), with the trigger's known values, and the viewer's facts
 * when the trigger names a viewer.
 */
export function conditionSourcesFor(
  variables: readonly VariableOption[],
  triggerRow: CatalogTriggerRow | undefined,
  support: EngineConditionSupport
): ConditionSources {
  const namesViewer = triggerNamesViewer(triggerRow);
  return {
    fields: conditionFields({
      variables,
      triggerChoices: triggerFieldChoices(triggerRow),
      viewerFacts: support.viewerFacts,
      namesViewer,
    }),
    namesViewer,
    support,
  };
}

export const NO_ENGINE_CONDITION_SUPPORT: EngineConditionSupport = {
  viewerFacts: { status: "unavailable", reason: "unsupported" },
  listReferences: false,
};

/** Every value a condition step can check, in picker order. */
export function conditionFields(sources: ConditionFieldSources): ConditionField[] {
  const fields: ConditionField[] = sources.variables.map((variable) => {
    const path = variable.value.startsWith(TRIGGER_DATA_PREFIX)
      ? variable.value.slice(TRIGGER_DATA_PREFIX.length, -1)
      : undefined;
    const choices = path !== undefined ? sources.triggerChoices.get(path) : undefined;
    const label = variable.group === "Trigger" && path === variable.label ? labelFromPath(path) : variable.label;
    return {
      ref: variable.value,
      label: variable.group === "Trigger" ? label : `${labelFromPath(variable.label)} (${variable.group})`,
      group: groupLabel(variable.group),
      kind: choices ? "choice" : kindOfType(variable.type),
      ...(choices ? { choices } : {}),
      ...(variable.description ? { description: variable.description } : {}),
    };
  });
  if (sources.namesViewer && sources.viewerFacts.status === "ready") {
    for (const fact of sources.viewerFacts.facts) {
      fields.push({
        ref: `\${viewer.${fact.path}}`,
        label: fact.name,
        group: VIEWER_GROUP,
        kind: fact.valueKind === "string" ? "text" : "number",
        ...(fact.description ? { description: fact.description } : {}),
      });
    }
  }
  return fields;
}

export function findConditionField(fields: readonly ConditionField[], ref: string): ConditionField | undefined {
  const trimmed = ref.trim();
  return fields.find((field) => field.ref === trimmed);
}

/** The condition a newly picked field starts with: its first operator, and an empty value. */
export function conditionForField(field: ConditionField): ConditionConfig {
  const first = OPERATORS_BY_KIND[field.kind][0];
  return withOperator({ field: field.ref, operator: first.operator }, field, first);
}

/**
 * A condition moved to another operator, keeping what of its value still fits: a single
 * value becomes the first item of a list and back, and a value the new operator cannot
 * use is cleared.
 */
export function withOperator(
  condition: ConditionConfig,
  field: ConditionField,
  choice: OperatorChoice
): ConditionConfig {
  const next: ConditionConfig = { field: condition.field, operator: choice.operator };
  if (choice.fixedValue !== undefined) {
    return { ...next, value: choice.fixedValue };
  }
  if (isValuelessOperator(choice.operator)) {
    return next;
  }
  const previous = condition.value;
  const firstOf = Array.isArray(previous) ? previous[0] : previous;
  if (choice.operator === "between") {
    const bounds = Array.isArray(previous) && previous.length === 2 ? previous : ["", ""];
    return { ...next, value: bounds };
  }
  if (isListOperator(choice.operator)) {
    const items = Array.isArray(previous) ? previous : previous === undefined || previous === "" ? [] : [previous];
    return { ...next, value: items.filter((item) => typeof item !== "boolean") };
  }
  if (typeof firstOf === "boolean" || firstOf === undefined) {
    return { ...next, value: field.kind === "choice" ? (field.choices?.[0]?.value ?? "") : "" };
  }
  if (choice.operator === "regex" && typeof firstOf !== "string") {
    return { ...next, value: "" };
  }
  return { ...next, value: firstOf };
}

/**
 * Whether the builder can show a condition with pickers, or only as the text it stores.
 * It can when the field is one it offers and the value has the shape the operator and
 * the field's kind expect. A `${...}` value, or one typed by hand into a shape the
 * pickers cannot express, stays in the advanced editor.
 */
export function fitsBuilder(condition: ConditionConfig, field: ConditionField | undefined): boolean {
  if (!field || !selectedOperator(field.kind, condition)) {
    return false;
  }
  const { operator, value } = condition;
  if (isValuelessOperator(operator) || field.kind === "boolean") {
    return true;
  }
  const scalarFits = (item: unknown): boolean => {
    if (isReference(item)) {
      return false;
    }
    if (field.kind === "number") {
      return (
        typeof item === "number" || item === "" || (typeof item === "string" && numberFromText(item) !== undefined)
      );
    }
    if (field.kind === "choice") {
      return field.choices?.some((choice) => String(choice.value) === String(item)) ?? false;
    }
    return typeof item === "string";
  };
  if (operator === "between") {
    return Array.isArray(value) && value.length === 2 && value.every(scalarFits);
  }
  if (isListOperator(operator)) {
    return Array.isArray(value) && value.every(scalarFits);
  }
  return value === undefined || scalarFits(value);
}

/**
 * Whether a number field is compared with a number written as text, which the engine
 * compares alphabetically ("9" is more than "100"). Conditions saved before values were
 * typed hold their numbers as text.
 */
export function comparesNumberAsText(condition: ConditionConfig, field: ConditionField | undefined): boolean {
  if (!field || (field.kind !== "number" && field.kind !== "choice")) {
    return false;
  }
  const wantsNumber = (item: unknown): boolean => {
    if (typeof item !== "string" || numberFromText(item) === undefined) {
      return false;
    }
    if (field.kind === "number") {
      return true;
    }
    return field.choices?.some((choice) => typeof choice.value === "number" && String(choice.value) === item) ?? false;
  };
  const items = Array.isArray(condition.value) ? condition.value : [condition.value];
  return items.some(wantsNumber);
}

/** The condition with each number written as text stored as the number it spells. */
export function fixNumbersAsText(condition: ConditionConfig, field: ConditionField): ConditionConfig {
  const fix = (item: unknown): unknown => {
    if (typeof item !== "string") {
      return item;
    }
    const n = numberFromText(item);
    if (n === undefined) {
      return item;
    }
    if (field.kind === "choice" && !field.choices?.some((choice) => choice.value === n)) {
      return item;
    }
    return n;
  };
  const value = Array.isArray(condition.value) ? condition.value.map(fix) : fix(condition.value);
  return { ...condition, value };
}

/** A label as it reads inside a sentence: "Goal name" becomes "goal name", "Viewer ID" stays. */
function inSentence(label: string): string {
  if (label.length > 1 && label.charAt(1) === label.charAt(1).toUpperCase() && /[A-Z]/.test(label.charAt(1))) {
    return label;
  }
  return label.charAt(0).toLowerCase() + label.slice(1);
}

function valueText(field: ConditionField | undefined, value: unknown): string {
  if (value === "" || value === undefined || value === null) {
    return "…";
  }
  const choice = field?.choices?.find((c) => String(c.value) === String(value));
  if (choice) {
    return choice.label;
  }
  if (typeof value === "string" && field?.kind !== "number" && !isReference(value)) {
    return `“${value}”`;
  }
  return String(value);
}

function joinWithOr(items: string[]): string {
  if (items.length === 0) {
    return "…";
  }
  if (items.length === 1) {
    return items[0];
  }
  return `${items.slice(0, -1).join(", ")} or ${items[items.length - 1]}`;
}

/**
 * One condition as a phrase: "amount is at least 100", "tier is Tier 1 or Tier 2". A
 * field the builder does not offer reads as its reference.
 */
export function conditionPhrase(condition: ConditionConfig, fields: readonly ConditionField[]): string {
  const field = findConditionField(fields, condition.field);
  const subject = field ? inSentence(field.label) : condition.field || "…";
  const choice = field ? selectedOperator(field.kind, condition) : undefined;
  const operator = choice?.label ?? OPERATOR_LABELS[condition.operator] ?? condition.operator;
  if (choice?.fixedValue !== undefined || isValuelessOperator(condition.operator)) {
    return `${subject} ${operator}`;
  }
  const value = condition.value;
  if (condition.operator === "between") {
    const [min, max] = Array.isArray(value) ? value : [];
    return `${subject} ${operator} ${valueText(field, min)} and ${valueText(field, max)}`;
  }
  if (isListOperator(condition.operator)) {
    const items = Array.isArray(value) ? value.map((item) => valueText(field, item)) : [];
    return `${subject} ${operator} ${joinWithOr(items)}`;
  }
  if (condition.operator === "regex") {
    return `${subject} ${operator} ${typeof value === "string" && value !== "" ? `/${value}/` : "…"}`;
  }
  return `${subject} ${operator} ${valueText(field, value)}`;
}

/** Conditions joined the way the engine combines them; empty when there are none. */
export function conditionsSentence(
  conditions: readonly ConditionConfig[],
  logic: "and" | "or" | undefined,
  fields: readonly ConditionField[]
): string {
  return conditions.map((condition) => conditionPhrase(condition, fields)).join(logic === "or" ? " or " : " and ");
}

/**
 * Why a regex pattern would not work in the engine, or null when it would. The engine
 * uses Go's regular expressions, which have no lookaround and no backreferences; the
 * browser's own would accept them and test a pattern the engine then refuses.
 */
export function patternProblem(pattern: string): string | null {
  if (/\(\?<?[=!]/.test(pattern)) {
    return "Lookahead and lookbehind aren't supported.";
  }
  if (/\\[1-9]/.test(pattern)) {
    return "Backreferences like \\1 aren't supported.";
  }
  try {
    new RegExp(pattern);
  } catch {
    return "That pattern isn't valid.";
  }
  return null;
}

/** Whether a sample matches a pattern, or null when the pattern cannot be tested. */
export function testPattern(pattern: string, sample: string): boolean | null {
  if (patternProblem(pattern) !== null) {
    return null;
  }
  return new RegExp(pattern).test(sample);
}
