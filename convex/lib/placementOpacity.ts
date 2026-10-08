/**
 * `value` with every placement's percent opacity as a fraction. A placement
 * is any object naming a `widgetCanonicalId`, wherever it is nested.
 */
export function rescalePlacements(value: unknown): { value: unknown; changed: boolean } {
  if (Array.isArray(value)) {
    let changed = false;
    const items = value.map((item) => {
      const result = rescalePlacements(item);
      changed ||= result.changed;
      return result.value;
    });
    return changed ? { value: items, changed } : { value, changed };
  }
  if (value === null || typeof value !== "object") {
    return { value, changed: false };
  }
  const record = value as Record<string, unknown>;
  let changed = false;
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(record)) {
    const result = rescalePlacements(child);
    changed ||= result.changed;
    out[key] = result.value;
  }
  if (typeof record.widgetCanonicalId === "string" && typeof record.opacity === "number" && record.opacity > 1) {
    out.opacity = Math.min(1, record.opacity / 100);
    changed = true;
  }
  return changed ? { value: out, changed } : { value, changed };
}
