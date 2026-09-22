/**
 * A JSON payload flattened into rows a person can scan: one per leaf value, keyed by
 * the path that reaches it (`data.user.login`, `items[0].amount`).
 *
 * Payloads here are recorded evidence -- trigger events, resolved step parameters,
 * alert envelopes -- and nothing validates their shape, so every reader tolerates
 * anything, and text that is not JSON is reported as such rather than dropped.
 */

export type PayloadFieldKind = "string" | "number" | "boolean" | "null" | "empty";

export interface PayloadField {
  path: string;
  /** The value as it should be shown: strings verbatim, everything else as JSON. */
  value: string;
  kind: PayloadFieldKind;
}

export interface FlattenedPayload {
  fields: PayloadField[];
  /** More leaves existed than the limit; the JSON view still has them all. */
  truncated: boolean;
}

/** Enough rows for any real event, few enough that a runaway array cannot hang the page. */
const DEFAULT_FIELD_LIMIT = 300;

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/** The parsed payload, or undefined when the text is not JSON. */
export function parsePayload(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/** Pretty-printed JSON, or the text as given when it is not JSON. */
export function formatPayload(raw: string): string {
  const parsed = parsePayload(raw);
  return parsed === undefined ? raw : JSON.stringify(parsed, null, 2);
}

function childPath(parent: string, key: string | number): string {
  if (typeof key === "number") {
    return `${parent}[${key}]`;
  }
  if (IDENTIFIER.test(key)) {
    return parent === "" ? key : `${parent}.${key}`;
  }
  return `${parent}[${JSON.stringify(key)}]`;
}

/** Every leaf of a value, in document order, up to `limit` rows. */
export function flattenPayload(value: unknown, limit: number = DEFAULT_FIELD_LIMIT): FlattenedPayload {
  const fields: PayloadField[] = [];
  let truncated = false;

  const push = (field: PayloadField) => {
    if (fields.length >= limit) {
      truncated = true;
      return;
    }
    fields.push(field);
  };

  const walk = (node: unknown, path: string) => {
    if (truncated) {
      return;
    }
    const label = path === "" ? "(value)" : path;
    if (node === null || node === undefined) {
      push({ path: label, value: "null", kind: "null" });
      return;
    }
    if (Array.isArray(node)) {
      if (node.length === 0) {
        push({ path: label, value: "[]", kind: "empty" });
        return;
      }
      for (let index = 0; index < node.length; index++) {
        walk(node[index], childPath(path, index));
      }
      return;
    }
    if (typeof node === "object") {
      const entries = Object.entries(node as Record<string, unknown>);
      if (entries.length === 0) {
        push({ path: label, value: "{}", kind: "empty" });
        return;
      }
      for (const [key, child] of entries) {
        walk(child, childPath(path, key));
      }
      return;
    }
    if (typeof node === "string") {
      push({ path: label, value: node, kind: "string" });
      return;
    }
    if (typeof node === "number") {
      push({ path: label, value: String(node), kind: "number" });
      return;
    }
    if (typeof node === "boolean") {
      push({ path: label, value: String(node), kind: "boolean" });
      return;
    }
    push({ path: label, value: String(node), kind: "string" });
  };

  walk(value, "");
  return { fields, truncated };
}

/** The CloudEvent context attributes and its `data`, read apart so each can be shown on its own. */
export interface CloudEventParts {
  /** Top-level attributes other than `data`: `type`, `source`, `id`, `time`, extensions. */
  attributes: Record<string, unknown>;
  /** The event's `data`, or undefined when it has none. */
  data: unknown;
}

/**
 * A trigger event split into its envelope and its content, or null when the text is
 * not a JSON object. The content is what a streamer cares about -- who followed, how
 * many bits -- and the envelope is what someone debugging routing cares about.
 */
export function splitCloudEvent(raw: string): CloudEventParts | null {
  const parsed = parsePayload(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const { data, ...attributes } = parsed as Record<string, unknown>;
  return { attributes, data };
}
