import type { DataShapeField, DataShapeFieldType } from "@woofx3/api/ui-schema";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A fresh empty value per call — a shared `{}` would be written through by nested paths. */
export function emptyValueOf(type: DataShapeFieldType): unknown {
  switch (type) {
    case "string":
      return "";
    case "number":
      return 0;
    case "boolean":
      return false;
    case "array":
      return [];
    case "object":
      return {};
    default:
      return null;
  }
}

/**
 * A starting payload for a test event, built from the trigger's declared `emits`
 * shape: each path gets its example, or an empty value of its type. Dot paths nest
 * (`channel.title` → `{ channel: { title } }`). A trigger that declares nothing
 * starts from `{}`.
 */
export function examplePayloadFromShape(fields: DataShapeField[]): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const field of fields) {
    const segments = field.path.split(".").filter(Boolean);
    const leaf = segments.pop();
    if (!leaf) {
      continue;
    }
    let target = payload;
    for (const segment of segments) {
      const existing = target[segment];
      if (isPlainObject(existing)) {
        target = existing;
      } else {
        const created: Record<string, unknown> = {};
        target[segment] = created;
        target = created;
      }
    }
    // A parent declared after its children must not wipe them out; an explicit example still wins.
    if (field.example === undefined && target[leaf] !== undefined) {
      continue;
    }
    target[leaf] = field.example !== undefined ? field.example : emptyValueOf(field.type);
  }
  return payload;
}
