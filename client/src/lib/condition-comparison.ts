import type { ComparisonOperator, ConfigField } from "@woofx3/api/ui-schema";
import { isComparisonOperator } from "@woofx3/api/ui-schema";
import { formatAmount } from "@/lib/amount-unit";

/**
 * A trigger condition on a number whose comparison the user picks, such as "at least"
 * or "exactly" 100 bits. Only a field that declares `operators` holds one; every other
 * number field holds a bare number compared with its fixed `operator`.
 *
 * The comparison lives in the value rather than beside it so it travels wherever the
 * value does: into the saved condition, back out of it, and into every summary.
 */
export interface ComparisonValue {
  operator: ComparisonOperator;
  /** `""` while the amount is cleared, which keeps the chosen comparison. */
  value: number | "";
}

export const COMPARISON_LABELS: Record<ComparisonOperator, string> = {
  eq: "Exactly",
  ne: "Not",
  gt: "More than",
  gte: "At least",
  lt: "Less than",
  lte: "At most",
};

type ComparisonField = Pick<ConfigField, "type" | "operator" | "operators">;

/** The comparisons a field lets the user choose between, or `undefined` when its comparison is fixed. */
export function comparisonChoices(field: ComparisonField): ComparisonOperator[] | undefined {
  if (field.type !== "number" || !field.operators || field.operators.length < 2) {
    return undefined;
  }
  return field.operators;
}

export function isComparisonValue(raw: unknown): raw is ComparisonValue {
  return (
    typeof raw === "object" &&
    raw !== null &&
    isComparisonOperator((raw as { operator?: unknown }).operator) &&
    "value" in raw
  );
}

/** The comparison a field starts on: its `operator`, which barkloader requires to be one of its choices. */
export function defaultComparison(field: ComparisonField & { defaultValue?: unknown; min?: number }): ComparisonValue {
  const choices = comparisonChoices(field) ?? [];
  const operator = isComparisonOperator(field.operator) ? field.operator : choices[0];
  if (!operator) {
    throw new Error("defaultComparison: the field offers no comparison to choose");
  }
  const value = typeof field.defaultValue === "number" ? field.defaultValue : (field.min ?? "");
  return { operator, value };
}

/** An amount read with its comparison: "exactly 100 bits", "100 bits or more". */
export function comparisonPhrase(amount: string, operator: ComparisonOperator): string {
  switch (operator) {
    case "eq":
      return `exactly ${amount}`;
    case "ne":
      return `other than ${amount}`;
    case "gt":
      return `more than ${amount}`;
    case "gte":
      return `${amount} or more`;
    case "lt":
      return `fewer than ${amount}`;
    case "lte":
      return `${amount} or fewer`;
  }
}

/** A comparison value as summaries show it, or `""` while its amount is cleared. */
export function formatComparison(comparison: ComparisonValue, unit?: string): string {
  if (comparison.value === "") {
    return "";
  }
  return comparisonPhrase(formatAmount(comparison.value, unit), comparison.operator);
}
