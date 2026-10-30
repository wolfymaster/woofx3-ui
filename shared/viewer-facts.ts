/**
 * One value a workflow reads as `${viewer.<path>}`, from the engine's
 * `listViewerFacts()` (capability `workflow.viewerFacts`). Declared here because
 * the engine checkout this repo builds against may predate it. Must match
 * `ViewerFact` in woofx3 `shared/clients/typescript/api/api.ts`.
 */
export interface ViewerFact {
  /** The path after `viewer.`, e.g. `"id"` or `"user.apple_mentions"`. */
  path: string;
  name: string;
  description: string;
  /** A timestamp is epoch milliseconds, compared as a number. */
  valueKind: "string" | "number" | "timestamp";
  /** Absent on `id`, `platform` and `name`, which are not facts. */
  window?: "lifetime" | "session";
}

const VALUE_KINDS: ReadonlySet<string> = new Set(["string", "number", "timestamp"]);
const WINDOWS: ReadonlySet<string> = new Set(["lifetime", "session"]);
const PATH = /^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*$/;

/**
 * The engine's answer as ViewerFacts, keeping its order. An entry that is not
 * well formed is dropped: offering a path the engine might not resolve would
 * build a condition that never matches.
 */
export function parseViewerFacts(raw: unknown): ViewerFact[] {
  if (!Array.isArray(raw)) {
    throw new Error("The engine's viewer facts are not a list");
  }
  const facts: ViewerFact[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const { path, name, description, valueKind, window } = entry as Record<string, unknown>;
    if (typeof path !== "string" || !PATH.test(path) || typeof valueKind !== "string" || !VALUE_KINDS.has(valueKind)) {
      continue;
    }
    const fact: ViewerFact = {
      path,
      name: typeof name === "string" && name !== "" ? name : path,
      description: typeof description === "string" ? description : "",
      valueKind: valueKind as ViewerFact["valueKind"],
    };
    if (typeof window === "string" && WINDOWS.has(window)) {
      fact.window = window as NonNullable<ViewerFact["window"]>;
    }
    facts.push(fact);
  }
  return facts;
}
