/**
 * Readers for the untrusted JSON another tool exported. Every field of a
 * Firebot or Streamer.bot file may be missing or of another type in some
 * version, so the converters read through these and never trust a shape.
 */

export type JsonRecord = Record<string, unknown>;

export function asRecord(value: unknown): JsonRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as JsonRecord) : null;
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function asRecords(value: unknown): JsonRecord[] {
  return asArray(value)
    .map(asRecord)
    .filter((entry): entry is JsonRecord => entry !== null);
}

/** A list of records, or the values of a record keyed by id, the way some files store collections. */
export function asCollection(value: unknown): JsonRecord[] {
  if (Array.isArray(value)) {
    return asRecords(value);
  }
  const record = asRecord(value);
  return record ? asRecords(Object.values(record)) : [];
}

export function asString(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return "";
}

/** A number, including one written as text; null when it is neither. */
export function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** A flag that is on unless the file says otherwise, the way both tools default `enabled`/`active`. */
export function asFlag(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/** "Death Count" -> "death_count", matching the counters page's suggestion for a new counter's id. */
export function resourceIdFromName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/**
 * A chat command word woofx3 accepts: the leading `!` dropped, and nothing a
 * NATS subject segment cannot hold. Null when nothing usable is left.
 */
export function commandWord(trigger: string): string | null {
  const word = trigger.trim().replace(/^!+/, "");
  if (word === "" || /[.*>\s]/.test(word)) {
    return null;
  }
  return word.toLowerCase();
}
