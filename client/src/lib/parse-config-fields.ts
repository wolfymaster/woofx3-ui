import type { ConditionOperator } from "@woofx3/api";
import {
  CONFIG_FIELD_TYPES,
  type ConfigField,
  type ConfigFieldSource,
  type ConfigFieldType,
  type DataShapeField,
} from "@woofx3/api/ui-schema";

// Taken from the SDK rather than restated, so a new field type cannot be
// accepted by the engine and silently dropped here.
const FIELD_TYPES = new Set<string>(CONFIG_FIELD_TYPES);

/**
 * Narrow a stored type token.
 *
 * No aliases: the engine validates the declaration at install, so `boolean`
 * and `string` cannot reach a stored row. Anything unrecognised is a row
 * written before that validation existed, and dropping the field beats
 * rendering a control the author did not ask for.
 */
function normalizeFieldType(raw: string): ConfigFieldType | null {
  return FIELD_TYPES.has(raw) ? (raw as ConfigFieldType) : null;
}

export function parseConfigFieldSource(raw: unknown): ConfigFieldSource | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const o = raw as Record<string, unknown>;
  if (o.kind === "commands") {
    return { kind: "commands" };
  }
  if (o.kind === "internal" && o.request && typeof o.request === "object") {
    const req = o.request as Record<string, unknown>;
    if (typeof req.event === "string") {
      return {
        kind: "internal",
        request: {
          event: req.event,
          payload:
            req.payload && typeof req.payload === "object" ? (req.payload as Record<string, unknown>) : undefined,
        },
        timeoutMs: typeof o.timeoutMs === "number" ? o.timeoutMs : undefined,
      };
    }
  }
  return undefined;
}

const OPERATORS = new Set<ConditionOperator>([
  "eq",
  "ne",
  "gt",
  "gte",
  "lt",
  "lte",
  "contains",
  "starts_with",
  "ends_with",
  "in",
  "not_in",
  "exists",
  "not_exists",
  "regex",
  "between",
]);

export function parseConfigField(item: unknown): ConfigField | null {
  if (!item || typeof item !== "object") {
    return null;
  }
  const o = item as Record<string, unknown>;
  const id = typeof o.id === "string" ? o.id : null;
  const label = typeof o.label === "string" ? o.label : null;
  const typeRaw = typeof o.type === "string" ? o.type : null;
  const type = typeRaw ? normalizeFieldType(typeRaw) : null;
  if (!id || !label || !type) {
    return null;
  }
  const field: ConfigField = {
    id,
    label,
    type,
    required: o.required === true,
    placeholder: typeof o.placeholder === "string" ? o.placeholder : undefined,
    unit: typeof o.unit === "string" ? o.unit : undefined,
    min: typeof o.min === "number" ? o.min : undefined,
    max: typeof o.max === "number" ? o.max : undefined,
    defaultValue: o.defaultValue,
    description: typeof o.description === "string" ? o.description : undefined,
    hint: typeof o.hint === "string" ? o.hint : undefined,
    examplePayload: typeof o.examplePayload === "string" ? o.examplePayload : undefined,
    eventPath: typeof o.eventPath === "string" ? o.eventPath : undefined,
    operator:
      typeof o.operator === "string" && OPERATORS.has(o.operator as ConditionOperator)
        ? (o.operator as ConditionOperator)
        : undefined,
    mediaType: o.mediaType === "image" || o.mediaType === "audio" || o.mediaType === "video" ? o.mediaType : undefined,
    kinds: Array.isArray(o.kinds) ? o.kinds.filter((k): k is string => typeof k === "string") : undefined,
    resourceKind: type === "resource_ref" && typeof o.resourceKind === "string" ? o.resourceKind : undefined,
  };
  if (Array.isArray(o.options)) {
    field.options = o.options
      .filter(
        (opt): opt is { value: string; label: string } =>
          !!opt &&
          typeof opt === "object" &&
          typeof (opt as { value?: unknown }).value === "string" &&
          typeof (opt as { label?: unknown }).label === "string"
      )
      .map((opt) => ({ value: opt.value, label: opt.label }));
  }
  const source = parseConfigFieldSource(o.source);
  if (source) {
    field.source = source;
  }
  return field;
}

export function parseConfigFields(raw: unknown): ConfigField[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: ConfigField[] = [];
  for (const item of raw) {
    const f = parseConfigField(item);
    if (f) {
      out.push(f);
    }
  }
  return out;
}

/**
 * resource_ref fields need the owning module's engine-facing name to create
 * new instances (POST /modules/{moduleName}/resources/{kind}). ConfigField
 * itself carries no module link, so it rides along as an extra property
 * picked up by ConfigurationForm's FieldDescriptor catch-all.
 */
export function withModuleName(fields: ConfigField[], moduleName: string | undefined): ConfigField[] {
  if (!moduleName) {
    return fields;
  }
  return fields.map((field) => (field.type === "resource_ref" ? { ...field, moduleName } : field));
}

export function isCommandsSource(field: ConfigField): boolean {
  return field.source?.kind === "commands";
}

export function isInternalSource(field: ConfigField): boolean {
  return field.source?.kind === "internal";
}

/**
 * Narrow an already-parsed `emits` / `returns` array from a catalog row.
 *
 * The sibling of `parseConfigFields`, for the other vocabulary: a DataShape
 * names values that exist at runtime, so its entries carry `path` rather than
 * the `id`/`label` a rendered control needs. `parseDataShape` in the SDK does
 * the same job for a JSON string; this one takes what Convex already stored.
 */
export function parseDataShapeFields(raw: unknown): DataShapeField[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.filter(
    (entry): entry is DataShapeField =>
      !!entry &&
      typeof entry === "object" &&
      typeof (entry as DataShapeField).path === "string" &&
      (entry as DataShapeField).path.length > 0
  );
}
