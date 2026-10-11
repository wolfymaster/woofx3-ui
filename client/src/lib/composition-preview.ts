import type { TransientState } from "@woofx3/scene/editor";
import type { CompositionDocument } from "@woofx3/scene/model";
import type { PreviewProblem, PreviewSampleEvent, TransientOverrides } from "@woofx3/scene/runtime";
import { toDisplayText, type VariableNames } from "@/lib/variable-display";
import type { VariableOption } from "@/lib/workflow-variables";

/**
 * The alert editor's live preview: sceneManager's composition preview page,
 * framed behind the stage and driven by `@woofx3/scene/runtime`'s preview
 * protocol (see docs/ui/commands.md, "Alert editor preview"). These are the
 * parts that need no React: what the page is posted, and how its reports
 * are read.
 */

/** How long the document must hold still before the page is posted it again: a load remounts every frame. */
export const PREVIEW_LOAD_DEBOUNCE_MS = 400;

/** How long a framed page may take to say it is listening before the editor asks for a new URL. */
export const PREVIEW_READY_TIMEOUT_MS = 8_000;

/** How many fresh URLs the editor tries before it settles for its stand-ins. */
export const PREVIEW_MAX_ATTEMPTS = 3;

/** A URL is not framed when it has less than this left: the page must load before its token expires. */
const URL_EXPIRY_MARGIN_MS = 15_000;

/**
 * `doc` as the page should play it: every `${…}` reference the step can make
 * shown as the editor's stand-ins show it (`{firstName}`), since the page has
 * no workflow to resolve them. A sample of each value would need data the
 * editor does not have; the short name is what the streamer recognises.
 */
export function previewDocumentOf(doc: CompositionDocument, names: VariableNames): CompositionDocument {
  const widgets: CompositionDocument["widgets"] = {};
  for (const [id, placement] of Object.entries(doc.widgets)) {
    widgets[id] = { ...placement, settings: displayValuesOf(placement.settings, names) as Record<string, unknown> };
  }
  return { ...doc, widgets };
}

/** Step input values as the page binds them, references shortened the same way. */
export function previewInputsOf(inputs: Record<string, unknown>, names: VariableNames): Record<string, unknown> {
  return displayValuesOf(inputs, names) as Record<string, unknown>;
}

function displayValuesOf(value: unknown, names: VariableNames): unknown {
  if (typeof value === "string") {
    return toDisplayText(value, names);
  }
  if (Array.isArray(value)) {
    return value.map((item) => displayValuesOf(item, names));
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, displayValuesOf(item, names)]));
  }
  return value;
}

const TRIGGER_DATA = /^\$\{trigger\.data\.([^{}]+)\}$/;

/**
 * The event the page hands its widgets, as an alert's frames receive one:
 * the trigger's payload, each field the step can reference holding its short
 * name in braces, so a widget that reads the event shows where a value goes.
 */
export function sampleEventOf(variables: readonly VariableOption[], names: VariableNames): PreviewSampleEvent {
  const data: Record<string, unknown> = {};
  for (const variable of variables) {
    const path = TRIGGER_DATA.exec(variable.value)?.[1];
    const name = names.nameByToken.get(variable.value);
    if (path === undefined || name === undefined) {
      continue;
    }
    setPath(data, path.split("."), `{${name}}`);
  }
  return { type: "alert", data };
}

function setPath(target: Record<string, unknown>, segments: readonly string[], value: unknown): void {
  let node = target;
  for (const segment of segments.slice(0, -1)) {
    const next = node[segment];
    if (typeof next !== "object" || next === null || Array.isArray(next)) {
      // A field declared both as a value and as a parent keeps the parent.
      node[segment] = {};
    }
    node = node[segment] as Record<string, unknown>;
  }
  const last = segments[segments.length - 1];
  if (!(typeof node[last] === "object" && node[last] !== null)) {
    node[last] = value;
  }
}

/** A gesture in progress as the page lays it over the document; null when there is none. */
export function overridesOf(transient: TransientState | null): TransientOverrides | null {
  if (transient === null) {
    return null;
  }
  const overrides: Record<string, TransientOverrides[string]> = {};
  for (const [id, box] of Object.entries(transient.boxes)) {
    overrides[id] = { x: box.x, y: box.y, width: box.width, height: box.height, rotation: box.rotation };
  }
  return overrides;
}

/** Problems the page draws nothing for, so the stage keeps that layer's stand-in. */
const UNDRAWN: ReadonlySet<PreviewProblem["kind"]> = new Set(["unknown-widget", "unframed-widget", "invalid-entry"]);

/** The layers the page cannot draw, which keep their stand-ins over the frame. */
export function undrawnIds(problems: readonly PreviewProblem[]): ReadonlySet<string> {
  return new Set(problems.flatMap((problem) => (UNDRAWN.has(problem.kind) && problem.id ? [problem.id] : [])));
}

export function problemKey(problem: PreviewProblem): string {
  return `${problem.kind}\u0000${problem.id ?? ""}\u0000${problem.detail ?? ""}`;
}

/** The problems in `problems` not yet in `seen`, which takes them in, so each is shown once per editor. */
export function unseenProblems(seen: Set<string>, problems: readonly PreviewProblem[]): PreviewProblem[] {
  const fresh: PreviewProblem[] = [];
  for (const problem of problems) {
    const key = problemKey(problem);
    if (!seen.has(key)) {
      seen.add(key);
      fresh.push(problem);
    }
  }
  return fresh;
}

/**
 * A problem in a sentence. `labelOf` names what an id is about: a layer by
 * its label in the layers list, a behavior by the layer it acts on.
 */
export function problemText(problem: PreviewProblem, labelOf: (id: string) => string | undefined): string {
  const named = problem.id === undefined ? undefined : (labelOf(problem.id) ?? problem.id);
  const subject = named ?? "A layer";
  const object = named ?? "a layer";
  const because = problem.detail ? `: ${problem.detail}` : "";
  switch (problem.kind) {
    case "unknown-widget":
      return `${subject} uses a widget that isn't installed on the engine.`;
    case "unframed-widget":
      return `${subject} can't play inside an alert.`;
    case "invalid-entry":
      return `${subject} was left out${because}.`;
    case "bind":
      return `The alert's inputs couldn't be filled in${because}.`;
    case "frames-unavailable":
      return `The engine couldn't load the widgets${because}.`;
    case "timeline":
      return `An animation on ${object} can't be timed as set${because}.`;
    case "plan":
      return `An animation on ${object} isn't played${because}.`;
    case "invalid-message":
      return `The preview refused a message${because}.`;
  }
}

/** A preview URL and when the engine stops accepting it (see convex/compositionPreview.ts). */
export interface PreviewUrl {
  url: string;
  expiresAt: number;
}

export interface PreviewUrlCache {
  /**
   * A URL to frame for `instanceId`: the one held while it has time left,
   * else a new one. `fresh` asks for a new one regardless, after a framed
   * page did not answer. Null when the engine has no preview.
   */
  get(instanceId: string, options?: { fresh?: boolean }): Promise<PreviewUrl | null>;
}

/**
 * Holds each instance's last preview URL until shortly before it expires. The
 * URL is needed only when a frame loads; the page then keeps its own session,
 * so reopening the editor within a few minutes reuses it.
 */
export function createPreviewUrlCache(
  fetchUrl: (instanceId: string) => Promise<PreviewUrl | null>,
  now: () => number = Date.now
): PreviewUrlCache {
  const held = new Map<string, PreviewUrl>();
  return {
    async get(instanceId, options = {}) {
      const cached = held.get(instanceId);
      if (!options.fresh && cached !== undefined && cached.expiresAt - now() > URL_EXPIRY_MARGIN_MS) {
        return cached;
      }
      held.delete(instanceId);
      const answer = await fetchUrl(instanceId);
      if (answer !== null) {
        held.set(instanceId, answer);
      }
      return answer;
    },
  };
}

/** The playhead as the transport shows it: tenths of a second. */
export function formatPlayhead(ms: number): string {
  return `${(Math.max(0, ms) / 1000).toFixed(1)}s`;
}
