import type { ViewerFact } from "@shared/viewer-facts";

export type { ViewerFact };

/**
 * The engine's `${viewer.*}` values as the condition builder sees them. `unavailable`
 * is an engine without `listViewerFacts`, or one that could not be asked: the builder
 * then offers no viewer values, since every one of them comes from the engine.
 */
export type ViewerFactsState =
  | { status: "loading" }
  | { status: "ready"; facts: ViewerFact[] }
  | { status: "unavailable"; reason: "unsupported" | "failed" };
