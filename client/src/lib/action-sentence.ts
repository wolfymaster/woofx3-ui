import type { ConfigField } from "@woofx3/api/ui-schema";
import { isEmptySetting, isWholeReference } from "@/lib/action-settings";
import {
  displayValue,
  fillSentence,
  finishSentence,
  lowerLabel,
  type OptionLabels,
  type SentencePart,
  withArticle,
} from "@/lib/condition-sentence";
import { toMediaValue } from "@/lib/media-value";
import { alertLayoutSummary } from "@/lib/workflow-node-summary";

/**
 * A configured action step as one line of plain English: "Add 5 to Deaths".
 *
 * The module declares the template on the action (`sentence`), with a `{fieldId}`
 * placeholder per setting, using the trigger sentence grammar (see condition-sentence.ts).
 * Each placeholder shows, in order of preference:
 *
 * - the configured value, or the label of the option or thing it names
 * - the short name of a value taken from earlier in the workflow (`next` for `${increment.next}`)
 * - the field's `missingText`, or "a counter", while a required setting is empty
 * - "the default amount" while an optional setting is empty, since the action then
 *   uses its own default: the sentence says what the step will do, never leaves a gap
 *
 * An action declaring no template reads as its name followed by the settings it has.
 */
export function actionSentenceParts(
  action: { name: string; sentence?: string },
  fields: readonly ConfigField[],
  parameters: Record<string, unknown>,
  optionLabels: OptionLabels = new Map()
): SentencePart[] {
  const partOf = (field: ConfigField) => actionFieldPart(field, parameters[field.id], optionLabels);
  if (action.sentence !== undefined && action.sentence.trim() !== "") {
    return fillSentence(action.sentence, fields, partOf);
  }
  return labelSentence(action.name, fields, parameters, partOf);
}

/**
 * "Set widget visibility: scene Main, widget Camera, not visible". A switch and a
 * missing setting read as their own words; an optional setting left empty is left out,
 * since without a template there is nowhere natural to say it falls back to its default.
 */
function labelSentence(
  name: string,
  fields: readonly ConfigField[],
  parameters: Record<string, unknown>,
  partOf: (field: ConfigField) => SentencePart
): SentencePart[] {
  const parts: SentencePart[] = [{ kind: "text", text: name }];
  let first = true;
  for (const field of fields) {
    const value = parameters[field.id];
    if (field.type === "button" || (!field.required && field.type !== "toggle" && isEmptySetting(value))) {
      continue;
    }
    parts.push({ kind: "text", text: first ? ": " : ", " });
    first = false;
    const part = partOf(field);
    // A switch's words and a missing setting's words already name the setting.
    const named =
      part.kind === "field" && (part.state === "missing" || (field.type === "toggle" && part.state === "value"));
    if (!named) {
      parts.push({ kind: "text", text: `${lowerLabel(field)} ` });
    }
    parts.push(part);
  }
  return finishSentence(parts);
}

function actionFieldPart(field: ConfigField, value: unknown, optionLabels: OptionLabels): SentencePart {
  const part = (text: string, state: "value" | "missing" | "variable" | "default"): SentencePart => ({
    kind: "field",
    fieldId: field.id,
    text,
    state,
  });
  if (isWholeReference(value)) {
    return part(variableName(value), "variable");
  }
  if (field.type === "toggle") {
    // Unset, a switch shows off, and the step reads the way its control does.
    return part(displayValue(field, value === true), "value");
  }
  if (isEmptySetting(value)) {
    if (field.required) {
      return part(field.missingText ?? withArticle(lowerLabel(field)), "missing");
    }
    return part(`the default ${lowerLabel(field)}`, "default");
  }
  return part(settingText(field, value, optionLabels), "value");
}

/** A configured value in words, for the kinds of value the trigger sentence never holds. */
function settingText(field: ConfigField, value: unknown, optionLabels: OptionLabels): string {
  const loaded = typeof value === "string" ? optionLabels.get(field.id)?.get(value) : undefined;
  if (loaded) {
    return loaded;
  }
  switch (field.type) {
    case "asset":
      return typeof value === "string" ? assetName(value) : String(value);
    case "media":
      return toMediaValue(value)?.name ?? "a file";
    case "layout":
      return alertLayoutSummary(value) || "an alert";
    case "list": {
      const count = Array.isArray(value) ? value.length : 0;
      return `${count} ${count === 1 ? "row" : "rows"}`;
    }
    case "text":
      if (typeof value !== "string") {
        return String(value);
      }
      // A name picked from the streamer's own things is a name, not words to quote.
      return field.source ? value : `“${shortenReferences(value)}”`;
    default:
      return displayValue(field, value, optionLabels);
  }
}

/** `${increment.next}` reads as `next`, the way text fields show a reference. */
function variableName(reference: string): string {
  const path = reference.trim().slice(2, -1);
  return path.split(".").pop() || path;
}

/** Every `${a.b.c}` in a text as `{c}`. */
function shortenReferences(text: string): string {
  return text.replace(/\$\{([^{}]*)\}/g, (_match, path: string) => `{${path.split(".").pop()}}`);
}

/** An asset's canonical id (`module:asset:bell.mp3`) by the name its module gave the file. */
function assetName(canonicalId: string): string {
  return canonicalId.split(":asset:")[1] ?? canonicalId;
}
