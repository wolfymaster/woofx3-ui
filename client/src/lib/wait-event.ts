import type { AggregationConfig, ConditionConfig, ConditionOperator } from "@woofx3/api";
import type { ConfigField, DataShapeField } from "@woofx3/api/ui-schema";
import type { CatalogTriggerRow } from "@/hooks/use-workflow-catalog";
import { taxonomyLabel } from "@/lib/alert-groups";
import { type OptionLabels, type SentencePart, sentenceParts, sentenceText } from "@/lib/condition-sentence";
import { conditionValueText } from "@/lib/condition-value";
import { fieldOptionsOwnerFromCanonicalId, withFieldOptionsOwner } from "@/lib/field-options-reference";
import { isCommandsSource, parseConfigFields, parseDataShapeFields, withModuleName } from "@/lib/parse-config-fields";
import { DEFAULT_AGGREGATION, type EventWaitConfig, formatDelay, parseGoDuration } from "@/lib/wait-config";
import type { TriggerConfigValues } from "@/lib/workflow-presets";
import { conditionsToFieldValues, decodeConditionValue, fieldValuesToConditions } from "@/lib/workflow-presets-json";

/**
 * The model behind the inline wait editor: which catalog event a wait listens for, how
 * its conditions split into that event's own settings and extra checks, and how many
 * events it takes. Everything here reads and writes the engine's wait config directly,
 * so a wait the editor does not touch is saved exactly as it was loaded.
 */

/** The segment of a catalog event that names one of many, as in `chat.command.*`. */
const WILDCARD = "*";

/** A catalog event a wait can listen for, with the settings its trigger declares. */
export interface WaitEventChoice {
  row: CatalogTriggerRow;
  /** The trigger's settings, which a wait saves as conditions on the event's payload. */
  fields: ConfigField[];
  /** What the event's payload carries, from the trigger's `emits`. */
  emits: DataShapeField[];
  /**
   * For an event named with a wildcard (`chat.command.*`), the setting that names which
   * one: the wait has to name it, since the engine matches a wait's event exactly. Kept
   * out of `fields`, because it is part of the event rather than a condition.
   */
  wildcardField?: ConfigField;
}

export interface WaitEventGroup {
  key: string;
  label: string;
  /** Lower lists first. */
  rank: number;
  choices: WaitEventChoice[];
}

/**
 * Where an event is listed: its platform when it names one (Twitch), else what it is
 * about (`system.counter` lists under Counters), else its module. The named groups
 * mirror the step picker's objects, so a counter's events sit where its actions do.
 */
const SYSTEM_GROUPS: Record<string, { label: string; rank: number }> = {
  chat: { label: "Chat", rank: 1 },
  counter: { label: "Counters", rank: 2 },
  timer: { label: "Timers", rank: 3 },
  queue: { label: "Queues", rank: 4 },
  viewer: { label: "Viewers", rank: 5 },
};
const PLATFORM_RANK = 0;
const MODULE_RANK = 6;
const ADVANCED_RANK = 7;
const ADVANCED_GROUP = { key: "advanced", label: "Advanced" };

function placement(row: CatalogTriggerRow): { key: string; label: string; rank: number } {
  const taxonomy = row.taxonomy ?? [];
  const platform = taxonomy.find((entry) => entry.startsWith("platform.") && entry !== "platform.system");
  if (platform) {
    const name = platform.split(".")[1] ?? "";
    if (name !== "") {
      return { key: `platform:${name}`, label: taxonomyLabel(name), rank: PLATFORM_RANK };
    }
  }
  for (const entry of taxonomy) {
    const [family, what] = entry.split(".");
    const group = family === "system" && what ? SYSTEM_GROUPS[what] : undefined;
    if (group) {
      return { key: `system:${what}`, ...group };
    }
  }
  if (taxonomy.length === 0 && row.moduleLabel) {
    return { key: `module:${row.moduleLabel}`, label: row.moduleLabel, rank: MODULE_RANK };
  }
  return { ...ADVANCED_GROUP, rank: ADVANCED_RANK };
}

/**
 * Only an event the bus delivers can end a wait: a trigger of another transport
 * (a schedule) fires its workflow directly and never reaches a waiting run.
 */
function isWaitable(row: CatalogTriggerRow): row is CatalogTriggerRow & { event: string } {
  return Boolean(row.event) && (row.transport === undefined || row.transport === "eventbus");
}

/** A catalog trigger as a wait sees it. */
export function waitEventChoice(row: CatalogTriggerRow): WaitEventChoice {
  const all = withFieldOptionsOwner(
    withModuleName(parseConfigFields(row.configFields), row.moduleName),
    fieldOptionsOwnerFromCanonicalId(row.canonicalRef)
  ).filter((field) => !isCommandsSource(field));
  const wildcardField = hasWildcard(row.event ?? "") ? wildcardNameField(all) : undefined;
  return {
    row,
    fields: wildcardField ? all.filter((field) => field !== wildcardField) : all,
    emits: parseDataShapeFields(row.emits),
    wildcardField,
  };
}

/**
 * The setting that names the wildcard's one: a text setting the event's payload is not
 * read for, such as a chat command's `command`. Absent when the trigger declares none,
 * and the wait then asks for the name in plain words.
 */
function wildcardNameField(fields: ConfigField[]): ConfigField | undefined {
  return fields.find((field) => field.type === "text" && !field.eventPath);
}

/** Every event a wait can listen for, grouped as the editor lists them. */
export function waitEventGroups(catalogTriggers: readonly CatalogTriggerRow[]): WaitEventGroup[] {
  const groups = new Map<string, WaitEventGroup>();
  const seenEvents = new Set<string>();
  for (const row of catalogTriggers) {
    if (!isWaitable(row) || seenEvents.has(row.event)) {
      continue;
    }
    seenEvents.add(row.event);
    const place = placement(row);
    const group = groups.get(place.key) ?? { ...place, choices: [] };
    group.choices.push(waitEventChoice(row));
    groups.set(place.key, group);
  }
  const sorted = Array.from(groups.values());
  for (const group of sorted) {
    group.choices.sort((a, b) => a.row.name.localeCompare(b.row.name));
  }
  return sorted.sort((a, b) => a.rank - b.rank || a.label.localeCompare(b.label));
}

/** Events whose name or group matches `query`, in list order. */
export function searchWaitEvents(groups: readonly WaitEventGroup[], query: string): WaitEventChoice[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") {
    return [];
  }
  return groups.flatMap((group) =>
    group.choices.filter(
      (choice) =>
        choice.row.name.toLowerCase().includes(needle) ||
        group.label.toLowerCase().includes(needle) ||
        (choice.row.event ?? "").toLowerCase().includes(needle)
    )
  );
}

function hasWildcard(event: string): boolean {
  return event.split(".").includes(WILDCARD);
}

/** The pattern's wildcard segment as a regex group; a wildcard at the end may span dots. */
function patternRegex(pattern: string): RegExp {
  const segments = pattern.split(".");
  const source = segments
    .map((segment, index) => {
      if (segment !== WILDCARD) {
        return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      }
      return index === segments.length - 1 ? "(.+)" : "([^.]+)";
    })
    .join("\\.");
  return new RegExp(`^${source}$`);
}

/** The catalog event a wait listens for, and the name filling its wildcard if it has one. */
export interface ResolvedWaitEvent {
  choice: WaitEventChoice;
  /** What fills the wildcard; empty while the creator has not named it. */
  wildcardValue: string;
}

/**
 * Finds the catalog event a stored wait event belongs to. An exact match wins; a
 * wildcard event matches a stored event that fills it, and the stored pattern itself
 * (a wait whose name has not been filled in yet).
 */
export function resolveWaitEvent(
  event: string,
  catalogTriggers: readonly CatalogTriggerRow[]
): ResolvedWaitEvent | null {
  const trimmed = event.trim();
  if (trimmed === "") {
    return null;
  }
  const waitable = catalogTriggers.filter(isWaitable);
  const exact = waitable.find((row) => row.event === trimmed);
  if (exact) {
    return { choice: waitEventChoice(exact), wildcardValue: "" };
  }
  for (const row of waitable) {
    if (!hasWildcard(row.event)) {
      continue;
    }
    const match = patternRegex(row.event).exec(trimmed);
    if (match) {
      return { choice: waitEventChoice(row), wildcardValue: match[1] };
    }
  }
  return null;
}

/** The event a wait saves: the catalog event, its wildcard filled with `value` when it has one. */
export function waitEventName(choice: WaitEventChoice, value: string): string {
  const pattern = choice.row.event ?? "";
  const name = value.trim();
  if (!hasWildcard(pattern) || name === "") {
    return pattern;
  }
  return pattern.replace(WILDCARD, name);
}

/** Whether the wait's event still has a wildcard nobody filled, which the engine would never match. */
export function waitEventIncomplete(event: string): boolean {
  return hasWildcard(event);
}

/** "userName" or "user_name" → "User name": a payload field as a streamer reads it. */
export function payloadFieldLabel(path: string): string {
  const last = path.split(".").pop() ?? path;
  const words = last
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase());
  const text = words.join(" ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The payload fields an aggregation can read a number from. */
export function numericPayloadFields(emits: readonly DataShapeField[]): DataShapeField[] {
  return emits.filter((field) => field.type === "number");
}

/** The aggregation `field` for a payload path: the engine roots it at the event, as `data.bits`. */
export function aggregationFieldFor(path: string): string {
  return `data.${path}`;
}

// ---------------------------------------------------------------------------------
// Conditions: the event's own settings, then extra checks
// ---------------------------------------------------------------------------------

export interface WaitConditionSplit {
  /** The event's settings, decoded from the conditions they were saved as. */
  values: TriggerConfigValues;
  /** Every other condition, in its saved order. */
  checks: ConditionConfig[];
}

function sameCondition(a: ConditionConfig, b: ConditionConfig): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Splits a wait's conditions into the event's settings and the extra checks. A
 * condition counts as a setting only when the setting would save it back exactly as it
 * is, so a condition the sentence cannot show as written (another operator, a second
 * condition on the same field) stays a check and keeps its meaning.
 */
export function splitWaitConditions(
  fields: readonly ConfigField[],
  conditions: readonly ConditionConfig[]
): WaitConditionSplit {
  const values = conditionsToFieldValues([...fields], [], "event");
  const claimed = new Set<number>();
  for (const field of fields) {
    const index = conditions.findIndex((condition, i) => {
      if (claimed.has(i)) {
        return false;
      }
      const decoded = decodeConditionValue(field, [condition], "event");
      if (decoded === undefined || decoded === null) {
        return false;
      }
      const encoded = fieldValuesToConditions([field], { [field.id]: decoded }, "event");
      return encoded.length === 1 && sameCondition(encoded[0], condition);
    });
    if (index >= 0) {
      claimed.add(index);
      values[field.id] = decodeConditionValue(field, [conditions[index]], "event") as TriggerConfigValues[string];
    }
  }
  return { values, checks: conditions.filter((_, i) => !claimed.has(i)) };
}

/** The conditions a wait saves for its settings and checks: settings first, then checks. */
export function joinWaitConditions(
  fields: readonly ConfigField[],
  values: TriggerConfigValues,
  checks: readonly ConditionConfig[]
): ConditionConfig[] | undefined {
  const conditions = [...fieldValuesToConditions([...fields], values, "event"), ...checks];
  return conditions.length > 0 ? conditions : undefined;
}

/** How a check on one of the event's payload fields compares it. */
export type CheckOperatorChoice = { id: string; label: string; operator: ConditionOperator; value?: boolean };

const TEXT_CHECKS: CheckOperatorChoice[] = [
  { id: "eq", label: "is", operator: "eq" },
  { id: "ne", label: "is not", operator: "ne" },
  { id: "contains", label: "contains", operator: "contains" },
  { id: "starts_with", label: "starts with", operator: "starts_with" },
  { id: "ends_with", label: "ends with", operator: "ends_with" },
  { id: "regex", label: "matches the pattern", operator: "regex" },
  { id: "exists", label: "has a value", operator: "exists" },
  { id: "not_exists", label: "has no value", operator: "not_exists" },
];

const NUMBER_CHECKS: CheckOperatorChoice[] = [
  { id: "eq", label: "is", operator: "eq" },
  { id: "ne", label: "is not", operator: "ne" },
  { id: "gt", label: "is more than", operator: "gt" },
  { id: "gte", label: "is at least", operator: "gte" },
  { id: "lt", label: "is less than", operator: "lt" },
  { id: "lte", label: "is at most", operator: "lte" },
  { id: "exists", label: "has a value", operator: "exists" },
];

const BOOLEAN_CHECKS: CheckOperatorChoice[] = [
  { id: "true", label: "is true", operator: "eq", value: true },
  { id: "false", label: "is false", operator: "eq", value: false },
];

const OTHER_CHECKS: CheckOperatorChoice[] = [
  { id: "exists", label: "has a value", operator: "exists" },
  { id: "not_exists", label: "has no value", operator: "not_exists" },
];

export function checkOperators(type: DataShapeField["type"]): CheckOperatorChoice[] {
  switch (type) {
    case "string":
      return TEXT_CHECKS;
    case "number":
      return NUMBER_CHECKS;
    case "boolean":
      return BOOLEAN_CHECKS;
    default:
      return OTHER_CHECKS;
  }
}

/** A check the editor can show as field, comparison and value. */
export interface WaitCheck {
  field: DataShapeField;
  choice: CheckOperatorChoice;
  /** The value as typed; unused by a comparison that takes none. */
  value: string;
}

const EVENT_DATA_REFERENCE = /^\$\{event\.data\.([^{}]+)\}$/;

/**
 * Reads a condition as a check on one of the event's payload fields, or null when it
 * is something else (another source, a compound expression, an operator the field's
 * type does not offer), which the editor then keeps as written.
 */
export function readWaitCheck(condition: ConditionConfig, emits: readonly DataShapeField[]): WaitCheck | null {
  const path = EVENT_DATA_REFERENCE.exec(condition.field.trim())?.[1];
  const field = path === undefined ? undefined : emits.find((candidate) => candidate.path === path);
  if (!field) {
    return null;
  }
  const choice = checkOperators(field.type).find((candidate) => {
    if (candidate.operator !== condition.operator) {
      return false;
    }
    return candidate.value === undefined ? typeof condition.value !== "boolean" : candidate.value === condition.value;
  });
  if (!choice) {
    return null;
  }
  if (choice.value === undefined && condition.value !== undefined && typeof condition.value === "object") {
    return null;
  }
  return { field, choice, value: conditionValueText(condition.value) };
}

/** Whether a comparison is complete without a typed value. */
export function checkTakesValue(choice: CheckOperatorChoice): boolean {
  return choice.value === undefined && choice.operator !== "exists" && choice.operator !== "not_exists";
}

/** A check as the condition the engine evaluates. */
export function writeWaitCheck(check: WaitCheck): ConditionConfig {
  const field = `\${event.data.${check.field.path}}`;
  if (check.choice.value !== undefined) {
    return { field, operator: check.choice.operator, value: check.choice.value };
  }
  if (!checkTakesValue(check.choice)) {
    return { field, operator: check.choice.operator };
  }
  const text = check.value;
  const number = check.field.type === "number" && text.trim() !== "" ? Number(text) : Number.NaN;
  return { field, operator: check.choice.operator, value: Number.isFinite(number) ? number : text };
}

/** A new check on `field`, with the first comparison its type offers. */
export function newWaitCheck(field: DataShapeField): ConditionConfig {
  return writeWaitCheck({ field, choice: checkOperators(field.type)[0], value: "" });
}

// ---------------------------------------------------------------------------------
// How many
// ---------------------------------------------------------------------------------

/** How many events end the wait: the first one, a number of them, a running total, or one big enough. */
export type WaitHowMany = "first" | AggregationConfig["strategy"];

/** Read from the aggregation rather than the type: the engine aggregates whenever one is present. */
export function waitHowMany(wait: EventWaitConfig): WaitHowMany {
  return wait.aggregation ? wait.aggregation.strategy : "first";
}

/**
 * Changes how many events end the wait. A running total and "one big enough" need a
 * number from the event, so they take the event's first numeric field unless the wait
 * already reads one; the threshold and window carry over between the counting ones.
 */
export function setWaitHowMany(
  wait: EventWaitConfig,
  how: WaitHowMany,
  numericFields: readonly DataShapeField[]
): EventWaitConfig {
  const { aggregation, ...rest } = wait;
  if (how === "first") {
    return { ...rest, type: "event" };
  }
  const next: AggregationConfig = { ...(aggregation ?? DEFAULT_AGGREGATION), strategy: how };
  if (how === "count") {
    delete next.field;
  } else if (next.field === undefined && numericFields.length > 0) {
    next.field = aggregationFieldFor(numericFields[0].path);
  }
  // A count and a total measure different things, so a threshold set for one is no
  // starting point for the other.
  const wasCount = aggregation?.strategy === "count";
  if (how === "count" && (!aggregation || !wasCount)) {
    next.threshold = DEFAULT_COUNT;
  } else if (how !== "count" && (!aggregation || wasCount)) {
    next.threshold = DEFAULT_TOTAL;
  }
  return { ...rest, type: "aggregation", aggregation: next };
}

const DEFAULT_COUNT = 5;
const DEFAULT_TOTAL = 100;

/** Why an aggregation's threshold can't be used, or null when it can. */
export function thresholdProblem(how: WaitHowMany, threshold: number): string | null {
  if (!Number.isFinite(threshold)) {
    return "Enter a number.";
  }
  if (how === "count" && (threshold < 1 || !Number.isInteger(threshold))) {
    return "Enter a whole number, 1 or more.";
  }
  if (how !== "count" && threshold <= 0) {
    return "Enter a number above 0.";
  }
  return null;
}

/** The label of the payload field an aggregation reads, for sentences. */
function aggregationFieldLabel(field: string | undefined): string {
  if (!field) {
    return "amount";
  }
  return payloadFieldLabel(field.replace(/^data\./, "")).toLowerCase();
}

// ---------------------------------------------------------------------------------
// Reading a wait as a sentence
// ---------------------------------------------------------------------------------

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

const CHECK_PHRASES: Partial<Record<ConditionOperator, string>> = {
  eq: "is",
  ne: "is not",
  gt: "is more than",
  gte: "is at least",
  lt: "is less than",
  lte: "is at most",
  contains: "contains",
  starts_with: "starts with",
  ends_with: "ends with",
  regex: "matches",
  exists: "has a value",
  not_exists: "has no value",
  in: "is one of",
  not_in: "is not one of",
  between: "is between",
};

/** One extra check as words: "message contains “hype”". */
export function waitCheckText(condition: ConditionConfig, emits: readonly DataShapeField[]): string {
  const check = readWaitCheck(condition, emits);
  if (check) {
    const label = payloadFieldLabel(check.field.path).toLowerCase();
    if (!checkTakesValue(check.choice)) {
      return `${label} ${check.choice.label}`;
    }
    const value = check.field.type === "number" ? check.value : `“${check.value}”`;
    return `${label} ${check.choice.label} ${value}`;
  }
  const phrase = CHECK_PHRASES[condition.operator] ?? condition.operator;
  if (condition.operator === "exists" || condition.operator === "not_exists") {
    return `${condition.field} ${phrase}`;
  }
  return `${condition.field} ${phrase} ${conditionValueText(condition.value)}`;
}

/**
 * A trigger sentence placed after "Wait until": it starts lower case, unless it starts
 * with a chosen value, which is a name ("Hype changes").
 */
export function sentenceAfterWaitUntil(parts: SentencePart[]): SentencePart[] {
  if (parts.length === 0 || (parts[0].kind === "field" && parts[0].state === "value")) {
    return parts;
  }
  const [first, ...rest] = parts;
  return [{ ...first, text: lowerFirst(first.text) }, ...rest];
}

/** What the wait is waiting for, as the event's own sentence: "someone joins Song requests". */
export function waitEventPhrase(
  wait: EventWaitConfig,
  resolved: ResolvedWaitEvent | null,
  optionLabels: OptionLabels = new Map()
): string {
  if (!resolved) {
    return wait.event.trim() === "" ? "" : `${wait.event} happens`;
  }
  const { choice } = resolved;
  const { values } = splitWaitConditions(choice.fields, wait.conditions ?? []);
  const name = lowerFirst(choice.row.name);
  const which = resolved.wildcardValue === "" ? "" : ` ${resolved.wildcardValue}`;
  const template = choice.row.sentence;
  if (template && template.trim() !== "" && choice.fields.length > 0) {
    return sentenceText(sentenceAfterWaitUntil(sentenceParts(template, choice.fields, values, optionLabels)));
  }
  // Without a template the settings read as "Label: value", which only the set ones need.
  const set = choice.fields.filter((field) => values[field.id] !== null && values[field.id] !== undefined);
  const settings = set.length > 0 ? ` (${sentenceText(sentenceParts(undefined, set, values, optionLabels))})` : "";
  return `${name}${which} happens${settings}`;
}

/** How many events end the wait, as the end of its sentence: " 5 times", ", until the total of their bits reaches 500". */
function howManyPhrase(wait: EventWaitConfig): string {
  const aggregation = wait.aggregation;
  if (!aggregation) {
    return "";
  }
  const threshold = aggregation.threshold;
  const field = aggregationFieldLabel(aggregation.field);
  let phrase: string;
  switch (aggregation.strategy) {
    case "count":
      phrase = threshold === 1 ? " once" : ` ${threshold} times`;
      break;
    case "sum":
      phrase = `, until the total of their ${field} reaches ${threshold}`;
      break;
    case "threshold":
      phrase = `, once one has ${field} of at least ${threshold}`;
      break;
  }
  const windowMs = aggregation.timeWindow === undefined ? null : parseGoDuration(String(aggregation.timeWindow));
  return windowMs === null || windowMs === 0 ? phrase : `${phrase} within ${formatDelay(windowMs)}`;
}

/** The streamer's names for the counters, timers and queues the event's settings pick, by field. */
export function resourceFieldLabels(
  fields: readonly ConfigField[],
  resourceLabels: ReadonlyMap<string, string> | undefined
): Map<string, ReadonlyMap<string, string>> {
  const labels = new Map<string, ReadonlyMap<string, string>>();
  if (!resourceLabels) {
    return labels;
  }
  for (const field of fields) {
    if (field.type === "resource_ref") {
      labels.set(field.id, resourceLabels);
    }
  }
  return labels;
}

/**
 * A collapsed event wait as one sentence: "Wait until someone cheers where message
 * contains “hype”, until the total of their bits reaches 500 within 5m".
 */
export function waitSentence(
  wait: EventWaitConfig,
  catalogTriggers: readonly CatalogTriggerRow[],
  resourceLabels?: ReadonlyMap<string, string>
): string {
  const resolved = resolveWaitEvent(wait.event, catalogTriggers);
  const optionLabels = resourceFieldLabels(resolved?.choice.fields ?? [], resourceLabels);
  const what = waitEventPhrase(wait, resolved, optionLabels);
  if (what === "") {
    return "Wait for an event";
  }
  const checks = resolved
    ? splitWaitConditions(resolved.choice.fields, wait.conditions ?? []).checks
    : (wait.conditions ?? []);
  const emits = resolved?.choice.emits ?? [];
  const where = checks.length > 0 ? ` where ${checks.map((check) => waitCheckText(check, emits)).join(" and ")}` : "";
  return `Wait until ${what}${where}${howManyPhrase(wait)}`;
}
