// Pure parsers for the engine's scene webhook payloads (widgetsJson, layoutJson,
// behaviorsJson, inputsJson and the kind), extracted from the webhook upserts so
// they can be unit-tested without the Convex runtime. All are total: malformed or
// unexpected input yields safe defaults rather than throwing — webhook handlers
// must never crash on bad data.

export interface SceneLayout {
  width?: number;
  height?: number;
  backgroundColor?: string;
}

export function parseSceneWidgets(widgetsJson: string): unknown[] {
  try {
    const parsed = JSON.parse(widgetsJson || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function parseSceneLayout(layoutJson: string): SceneLayout {
  try {
    const parsed = JSON.parse(layoutJson || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as SceneLayout;
    }
    return {};
  } catch {
    return {};
  }
}

/** What a row of the engine's scenes table composes; see `CompositionKind` in `@woofx3/api`. */
export type CompositionKind = "scene" | "alert";

/**
 * The kind a `scene.*` webhook names. An engine that predates alert
 * compositions sends none, and holds only scenes.
 */
export function parseCompositionKind(kind: unknown): CompositionKind {
  return kind === "alert" ? "alert" : "scene";
}

/**
 * The cache tables a `scene.deleted` webhook may name a row of. Without a
 * kind (an older engine) the id is looked for in both; ids are unique across
 * the engine's scenes table, so at most one matches.
 */
export function tablesForDeletedComposition(kind: unknown): Array<"scenes" | "alertCompositions"> {
  if (kind === "scene") {
    return ["scenes"];
  }
  if (kind === "alert") {
    return ["alertCompositions"];
  }
  return ["scenes", "alertCompositions"];
}

/** A composition's behaviors (`behaviorsJson`), a JSON object keyed by behavior id. */
export function parseSceneBehaviors(behaviorsJson: string | undefined): Record<string, unknown> {
  try {
    const parsed = JSON.parse(behaviorsJson || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

/**
 * One input a composition declares: the engine's ConfigField, of which the
 * cache needs only that it is an object with an id. Everything else is kept
 * as the engine sent it, for the form that fills the input in.
 */
export interface CompositionInput {
  id: string;
  [key: string]: unknown;
}

/**
 * A composition's inputs (`inputsJson`), a JSON array of input fields. An
 * entry that is not an object with a non-empty string `id`, or repeats an
 * earlier id, is dropped: a step could not address it.
 */
export function parseCompositionInputs(inputsJson: string | undefined): CompositionInput[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(inputsJson || "[]");
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) {
    return [];
  }
  const seen = new Set<string>();
  const inputs: CompositionInput[] = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      continue;
    }
    const id = (entry as { id?: unknown }).id;
    if (typeof id !== "string" || id === "" || seen.has(id)) {
      continue;
    }
    seen.add(id);
    inputs.push(entry as CompositionInput);
  }
  return inputs;
}
