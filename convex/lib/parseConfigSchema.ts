/**
 * Server-side configSchema / paramsSchema parsing (mirrors client/src/lib/parse-config-fields.ts).
 */

const FIELD_TYPES = new Set(["number", "range", "text", "select", "media", "toggle", "color", "asset", "resource_ref"]);

function normalizeFieldType(raw: string): string | null {
  if (raw === "boolean") {
    return "toggle";
  }
  if (FIELD_TYPES.has(raw)) {
    return raw;
  }
  return null;
}

function parseConfigFieldSource(raw: unknown): unknown | undefined {
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
          payload: req.payload && typeof req.payload === "object" ? req.payload : undefined,
        },
        timeoutMs: typeof o.timeoutMs === "number" ? o.timeoutMs : undefined,
      };
    }
  }
  return undefined;
}

function parseConfigField(item: unknown): Record<string, unknown> | null {
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
  const field: Record<string, unknown> = {
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
    dataSchema: typeof o.dataSchema === "string" ? o.dataSchema : undefined,
    eventPath: typeof o.eventPath === "string" ? o.eventPath : undefined,
    operator: typeof o.operator === "string" ? o.operator : undefined,
    mediaType: o.mediaType === "image" || o.mediaType === "audio" || o.mediaType === "video" ? o.mediaType : undefined,
    kinds: Array.isArray(o.kinds) ? o.kinds.filter((k): k is string => typeof k === "string") : undefined,
    resourceKind: typeof o.kind === "string" && type === "resource_ref" ? o.kind : undefined,
  };
  if (Array.isArray(o.options)) {
    field.options = o.options.filter(
      (opt) =>
        !!opt &&
        typeof opt === "object" &&
        typeof (opt as { value?: unknown }).value === "string" &&
        typeof (opt as { label?: unknown }).label === "string"
    );
  }
  const source = parseConfigFieldSource(o.source);
  if (source) {
    field.source = source;
  }
  return field;
}

export function parseConfigFields(raw: unknown): Record<string, unknown>[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: Record<string, unknown>[] = [];
  for (const item of raw) {
    const f = parseConfigField(item);
    if (f) {
      out.push(f);
    }
  }
  return out;
}

export function parseConfigSchemaPayload(parsed: unknown): {
  fields: Record<string, unknown>[];
  color?: string;
  icon?: string;
} {
  if (Array.isArray(parsed)) {
    return { fields: parseConfigFields(parsed) };
  }
  if (!parsed || typeof parsed !== "object") {
    return { fields: [] };
  }
  const obj = parsed as Record<string, unknown>;
  const nested = obj.ui && typeof obj.ui === "object" ? (obj.ui as Record<string, unknown>) : obj;
  const rawFields = Array.isArray(nested.fields)
    ? nested.fields
    : Array.isArray(nested.configFields)
      ? nested.configFields
      : [];
  return {
    fields: parseConfigFields(rawFields),
    color: typeof nested.color === "string" ? nested.color : undefined,
    icon: typeof nested.icon === "string" ? nested.icon : undefined,
  };
}

export function parseConfigSchemaString(raw: string | undefined): ReturnType<typeof parseConfigSchemaPayload> {
  if (!raw) {
    return { fields: [] };
  }
  try {
    return parseConfigSchemaPayload(JSON.parse(raw));
  } catch {
    return { fields: [] };
  }
}
