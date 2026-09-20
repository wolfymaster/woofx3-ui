import type { ConfigField, ConfigFieldOption, DataShapeField, DataShapeFieldType } from "@woofx3/api/ui-schema";
import { emptyValueOf } from "@/lib/test-event-payload";
import type { TriggerPreset } from "@/lib/workflow-presets";

/**
 * One editable field of a test event, derived from the trigger's own declaration
 * of what it emits.
 *
 * The catalog decides what a test form asks for: a trigger that declares
 * `emits` gets labelled controls for exactly the paths a workflow can read off
 * it, so improving a module's declaration improves its test form with no change
 * here.
 */
export interface TestEventField {
  /** Dot path into `trigger.data`, e.g. `viewers` or `channel.title`. */
  path: string;
  /** The path's last segment in words, e.g. `fromBroadcasterUserName` -> "From broadcaster user name". */
  label: string;
  type: DataShapeFieldType;
  description?: string;
  /** The choices the trigger's own config declares for this path, when it declares any. */
  options?: ConfigFieldOption[];
  /** What the field starts at; see `seedValue`. */
  initial: unknown;
}

/** Types whose value is edited as JSON rather than with a single control. */
export function isJsonValueType(type: DataShapeFieldType): boolean {
  return type === "object" || type === "array" || type === "unknown";
}

/**
 * The fields to show for `preset`, in the order it declares them.
 *
 * A declared parent object is dropped when the same declaration also describes
 * what is inside it — `{channel}` alongside `channel.title` is one value, and
 * the leaves are the editable version of it.
 */
export function testEventFields(preset: TriggerPreset): TestEventField[] {
  const emits = preset.emits ?? [];
  const configFields = preset.config?.fields ?? [];
  const samples = examplePayloads(configFields);
  const configByPath = configFieldsByEventPath(configFields);

  return emits
    .filter((field) => !isDescribedByItsChildren(field, emits))
    .map((field) => {
      const config = configByPath.get(field.path);
      const options = config?.type === "select" ? config.options : undefined;
      return {
        path: field.path,
        label: humanize(field.path),
        type: field.type,
        description: field.description ?? undefined,
        options,
        initial: seedValue(field, samples, options, config),
      };
    });
}

/** Each field at its starting value, keyed by path — the form's initial state. */
export function initialValues(fields: readonly TestEventField[]): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const field of fields) {
    values[field.path] = field.initial;
  }
  return values;
}

/**
 * The event payload the current field values describe. Dot paths nest, so
 * `channel.title` becomes `{ channel: { title } }`.
 */
export function payloadFromValues(
  fields: readonly TestEventField[],
  values: Readonly<Record<string, unknown>>
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const field of fields) {
    setPath(payload, field.path, values[field.path]);
  }
  return payload;
}

/**
 * The field values a payload holds, for the paths it actually carries — so
 * hand-edited JSON can be read back into the fields without inventing values
 * for whatever it left out.
 */
export function valuesFromPayload(
  fields: readonly TestEventField[],
  payload: Readonly<Record<string, unknown>>
): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const field of fields) {
    const value = readPath(payload, field.path);
    if (value !== undefined) {
      values[field.path] = value;
    }
  }
  return values;
}

/**
 * A field whose value the declaration describes in pieces: an object path that
 * another declared path nests inside.
 */
function isDescribedByItsChildren(field: DataShapeField, emits: readonly DataShapeField[]): boolean {
  if (field.type !== "object") {
    return false;
  }
  const prefix = `${field.path}.`;
  return emits.some((other) => other.path.startsWith(prefix));
}

/**
 * What a field starts at: its declared example, else the same path in an
 * example payload the trigger's config carries, else the first valid choice,
 * else an empty value of its type.
 *
 * A `null` example counts as no example. The engine stores an undeclared one as
 * null, and a form that opens on `null` asks the user to fill in what the
 * declaration was supposed to supply.
 */
function seedValue(
  field: DataShapeField,
  samples: readonly Record<string, unknown>[],
  options: ConfigFieldOption[] | undefined,
  config: ConfigField | undefined
): unknown {
  if (field.example !== undefined && field.example !== null) {
    return field.example;
  }
  for (const sample of samples) {
    const value = readPath(sample, field.path);
    if (value !== undefined && value !== null && !isElision(value)) {
      return value;
    }
  }
  if (options && options.length > 0) {
    const preferred = options.find((option) => option.value === config?.defaultValue);
    return (preferred ?? options[0]).value;
  }
  return emptyValueOf(field.type);
}

/**
 * The trigger's config fields by the event path they read.
 *
 * A field binds to a path either explicitly through `eventPath` or, for the
 * plain case a module writes most often, by sharing the payload key's name.
 */
function configFieldsByEventPath(fields: readonly ConfigField[]): Map<string, ConfigField> {
  const byPath = new Map<string, ConfigField>();
  for (const field of fields) {
    const path = field.eventPath ?? field.id;
    if (!byPath.has(path)) {
      byPath.set(path, field);
    }
  }
  return byPath;
}

/**
 * The `examplePayload` illustrations the trigger's config carries, parsed.
 *
 * They are illustrations rather than declarations (see `ConfigField.examplePayload`),
 * which is exactly what a test form wants: plausible values a person can fire
 * without typing a name into every box. Anything unparseable is ignored.
 */
function examplePayloads(fields: readonly ConfigField[]): Record<string, unknown>[] {
  const payloads: Record<string, unknown>[] = [];
  for (const field of fields) {
    if (!field.examplePayload) {
      continue;
    }
    try {
      const parsed: unknown = JSON.parse(field.examplePayload);
      if (isPlainObject(parsed)) {
        payloads.push(parsed);
      }
    } catch {
      // An illustration nothing reads must never break the form it seeds.
    }
  }
  return payloads;
}

/**
 * An example payload may elide a value it does not care to illustrate, writing
 * it as "..." — which is a worse starting point than an empty box, since it
 * reads as a real value and fires as one.
 */
function isElision(value: unknown): boolean {
  return typeof value === "string" && /^[.…]+$/.test(value.trim());
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readPath(source: Readonly<Record<string, unknown>>, path: string): unknown {
  let current: unknown = source;
  for (const segment of path.split(".")) {
    if (!isPlainObject(current)) {
      return undefined;
    }
    current = current[segment];
  }
  return current;
}

function setPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const segments = path.split(".").filter(Boolean);
  const leaf = segments.pop();
  if (!leaf) {
    return;
  }
  let cursor = target;
  for (const segment of segments) {
    const existing = cursor[segment];
    if (isPlainObject(existing)) {
      cursor = existing;
    } else {
      const created: Record<string, unknown> = {};
      cursor[segment] = created;
      cursor = created;
    }
  }
  cursor[leaf] = value;
}

/** A path's last segment as words: `fromBroadcasterUserName` -> "From broadcaster user name". */
function humanize(path: string): string {
  const leaf = path.split(".").pop() ?? path;
  const words = leaf
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim()
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
