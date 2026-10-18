import type { ConditionOperator } from "@woofx3/api";
import type { VariableOption } from "@/lib/workflow-variables";

/**
 * Converting a condition's typed value into what the engine is sent.
 *
 * The engine compares two values as numbers only when both are numbers; when either is
 * a string it compares their text, so "9" is greater than "100". A value typed as text
 * is therefore stored as a number wherever the comparison is meant to be numeric. The
 * engine resolves a `${...}` reference only when it is the whole value, not inside a
 * list, so a reference is kept as the string the engine resolves.
 */

const NUMERIC_OPERATORS = new Set<ConditionOperator>(["gt", "gte", "lt", "lte"]);
const LIST_OPERATORS = new Set<ConditionOperator>(["in", "not_in", "between"]);
const VALUELESS_OPERATORS = new Set<ConditionOperator>(["exists", "not_exists"]);

/** A plain decimal literal. Stricter than Number(), which also accepts "0x10", "Infinity" and "". */
const NUMBER_LITERAL = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;

export function isValuelessOperator(operator: ConditionOperator): boolean {
  return VALUELESS_OPERATORS.has(operator);
}

function isReference(text: string): boolean {
  return text.includes("${");
}

function numberLiteral(text: string): number | undefined {
  const trimmed = text.trim();
  if (!NUMBER_LITERAL.test(trimmed)) {
    return undefined;
  }
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * The declared type of the variable a condition's field reads, when the field is exactly
 * one of the offered variables. A field typed by hand, or combining several references,
 * has no known type.
 */
export function conditionFieldType(field: string, variables: readonly VariableOption[]): string | undefined {
  const trimmed = field.trim();
  return variables.find((v) => v.value === trimmed)?.type;
}

/**
 * Whether a field's value arrives as a number. A trigger without a declared payload
 * describes it with its config fields, and a "range" config field's value is a number.
 */
function isNumericType(fieldType: string | undefined): boolean {
  return fieldType === "number" || fieldType === "range";
}

/** The text an input shows for a stored condition value. */
export function conditionValueText(value: unknown): string {
  if (value === undefined || value === null) {
    return "";
  }
  if (Array.isArray(value)) {
    return value.map((item) => String(item)).join(", ");
  }
  return String(value);
}

function splitList(text: string): string[] {
  return text
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * What a condition stores for the text typed as its value.
 *
 * - gt/gte/lt/lte and both bounds of between: a number whenever the text is one, since
 *   these only make sense numerically.
 * - eq/ne and each in/not_in item: a number only when the field is known to hold one.
 *   The engine falls back to comparing text, which matches a number to its usual
 *   spelling either way, but a text field holding "007" must not be compared with 7.
 * - Anything else, and every `${...}` reference: the text as typed.
 */
export function parseConditionValue(operator: ConditionOperator, text: string, fieldType?: string): unknown {
  if (VALUELESS_OPERATORS.has(operator)) {
    return undefined;
  }
  const numeric = operator === "between" || NUMERIC_OPERATORS.has(operator) || isNumericType(fieldType);
  const typed = (item: string): string | number => {
    if (!numeric || isReference(item)) {
      return item;
    }
    return numberLiteral(item) ?? item;
  };
  if (LIST_OPERATORS.has(operator)) {
    return splitList(text).map(typed);
  }
  if (operator === "eq" || operator === "ne" || NUMERIC_OPERATORS.has(operator)) {
    return typed(text);
  }
  return text;
}

/**
 * Why the engine would not evaluate a typed value as the operator means, or null when it
 * would. A blank value is a condition not yet filled in, and has no problem to report.
 */
export function conditionValueProblem(operator: ConditionOperator, text: string): string | null {
  if (VALUELESS_OPERATORS.has(operator) || text.trim() === "") {
    return null;
  }
  if (NUMERIC_OPERATORS.has(operator)) {
    if (isReference(text) || numberLiteral(text) !== undefined) {
      return null;
    }
    return "Enter a number or a variable. Text is compared alphabetically, so 9 would count as more than 100.";
  }
  if (!LIST_OPERATORS.has(operator)) {
    return null;
  }
  const items = splitList(text);
  if (items.some(isReference)) {
    return "A list can't contain variables: they are compared as the literal text you see.";
  }
  if (operator === "between") {
    if (items.length !== 2) {
      return "Enter exactly two numbers, the minimum and the maximum, separated by a comma.";
    }
    if (items.some((item) => numberLiteral(item) === undefined)) {
      return "Both bounds must be numbers.";
    }
  }
  return null;
}
