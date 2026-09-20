import type { ConfigField } from "@woofx3/api/ui-schema";
import { formatConfigValue, type TriggerConfigValues } from "@/lib/workflow-presets";
import { ANY_CONDITION } from "@/lib/workflow-presets-json";

/**
 * A trigger's conditions read as one sentence — "Test is redeemed", "Someone subs at
 * Tier 1" — from a template the module author declares on the trigger (`sentence`),
 * with a `{fieldId}` placeholder wherever a condition value goes.
 *
 * Each placeholder resolves to one of three things, and the part says which so the
 * page can style it: the configured value, the field's words for "any" (a condition
 * value of ANY_CONDITION), or its words for a required value nobody has chosen yet.
 */
export type SentencePart =
  | { kind: "text"; text: string }
  | { kind: "field"; fieldId: string; text: string; state: "value" | "any" | "missing" };

/**
 * The config field properties a sentence reads. `anyText` and `missingText` are the
 * module author's wording; without them the field's label supplies generic words.
 */
export type SentenceField = Pick<ConfigField, "id" | "label" | "type" | "unit" | "operator" | "options"> & {
  anyText?: string;
  missingText?: string;
};

/** Labels for options that load at runtime (a reward list), by field id then value. */
export type OptionLabels = ReadonlyMap<string, ReadonlyMap<string, string>>;

const PLACEHOLDER = /\{([^{}]+)\}/g;

/**
 * The sentence for one trigger's condition values.
 *
 * A trigger declaring no template still reads as a sentence: each field's label and
 * value, joined. A placeholder naming no field is kept as written, which shows the
 * mistake instead of hiding it; barkloader rejects one at install, so only a manifest
 * installed before that check can carry it.
 */
export function sentenceParts(
  template: string | undefined,
  fields: readonly SentenceField[],
  values: TriggerConfigValues,
  optionLabels: OptionLabels = new Map()
): SentencePart[] {
  const byId = new Map(fields.map((field) => [field.id, field]));
  const parts: SentencePart[] = [];

  if (template === undefined || template.trim() === "") {
    fields.forEach((field, index) => {
      parts.push({ kind: "text", text: `${index === 0 ? "" : " · "}${field.label}: ` });
      parts.push(fieldPart(field, values[field.id], optionLabels));
    });
  } else {
    let cursor = 0;
    for (const match of Array.from(template.matchAll(PLACEHOLDER))) {
      const index = match.index ?? 0;
      if (index > cursor) {
        parts.push({ kind: "text", text: template.slice(cursor, index) });
      }
      const field = byId.get(match[1]);
      parts.push(field ? fieldPart(field, values[field.id], optionLabels) : { kind: "text", text: match[0] });
      cursor = index + match[0].length;
    }
    if (cursor < template.length) {
      parts.push({ kind: "text", text: template.slice(cursor) });
    }
  }

  return capitalizeFirst(parts.filter((part) => part.text !== ""));
}

/** The whole sentence as plain text, for a title attribute or a screen reader label. */
export function sentenceText(parts: readonly SentencePart[]): string {
  return parts.map((part) => part.text).join("");
}

function fieldPart(field: SentenceField, value: unknown, optionLabels: OptionLabels): SentencePart {
  if (value === ANY_CONDITION) {
    return { kind: "field", fieldId: field.id, text: field.anyText ?? `any ${lowerLabel(field)}`, state: "any" };
  }
  if (value === undefined || value === "") {
    return {
      kind: "field",
      fieldId: field.id,
      text: field.missingText ?? withArticle(lowerLabel(field)),
      state: "missing",
    };
  }
  return { kind: "field", fieldId: field.id, text: displayValue(field, value, optionLabels), state: "value" };
}

/** A configured value as the sentence shows it: an option's label rather than its stored id. */
export function displayValue(field: SentenceField, value: unknown, optionLabels: OptionLabels = new Map()): string {
  const key = String(value);
  const staticLabel = field.options?.find((option) => option.value === key)?.label;
  const loadedLabel = optionLabels.get(field.id)?.get(key);
  if (staticLabel ?? loadedLabel) {
    return (staticLabel ?? loadedLabel) as string;
  }
  if (field.type === "number" && typeof value === "number") {
    return withOperator(`${value.toLocaleString()}${field.unit ? ` ${field.unit}` : ""}`, field.operator);
  }
  if (field.type === "toggle") {
    return value === true ? lowerLabel(field) : `not ${lowerLabel(field)}`;
  }
  if (field.type === "text" && typeof value === "string") {
    return `“${value}”`;
  }
  if (typeof value === "object" && value !== null) {
    return formatConfigValue(value as Parameters<typeof formatConfigValue>[0], field.unit);
  }
  return key;
}

function withOperator(amount: string, operator: SentenceField["operator"]): string {
  switch (operator) {
    case "gte":
      return `${amount} or more`;
    case "lte":
      return `${amount} or fewer`;
    case "gt":
      return `more than ${amount}`;
    case "lt":
      return `fewer than ${amount}`;
    default:
      return amount;
  }
}

function lowerLabel(field: SentenceField): string {
  return field.label.toLowerCase();
}

function withArticle(noun: string): string {
  return /^[aeiou]/.test(noun) ? `an ${noun}` : `a ${noun}`;
}

function capitalizeFirst(parts: SentencePart[]): SentencePart[] {
  if (parts.length === 0) {
    return parts;
  }
  const [first, ...rest] = parts;
  return [{ ...first, text: first.text.charAt(0).toUpperCase() + first.text.slice(1) }, ...rest];
}
