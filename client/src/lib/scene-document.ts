import type { PlacementTransition } from "@convex/lib/widgetTransitions";
import json0Module from "ot-json0";

/**
 * The scene as a document, and the json0 ops that change it: the wire format
 * of sceneManager's scene editor socket.
 *
 * Must match the engine's `sceneManager/public/scene-manager/scene-document.ts`
 * (woofx3, docs/services/scene-documents.md): placements keyed by id, stacked
 * by a `z` key that sorts as text, every op a json0 component.
 */

const json0 = json0Module.type;

export interface PlacementDocument {
  widget: string;
  x: number;
  y: number;
  width: number;
  height: number;
  visible: boolean;
  z: string;
  settings: Record<string, unknown>;
  name: string;
  rotation: number;
  opacity: number;
  locked: boolean;
  extra: Record<string, unknown>;
  /** Absent means none; the engine refuses a placement whose transition it cannot play. */
  transitionIn?: PlacementTransition;
  transitionOut?: PlacementTransition;
}

export interface SceneDocument {
  layout: Record<string, unknown>;
  widgets: Record<string, PlacementDocument>;
}

/** What sceneManager works out for a placement from what is installed. */
export interface PlacementMeta {
  moduleId: string;
  hostsSurface: string;
  frameUrl: string;
  linkedResources: Record<string, string>;
}

export interface SceneSnapshot {
  sceneId: string;
  name: string;
  seq: number;
  doc: SceneDocument;
  meta: Record<string, PlacementMeta>;
}

export interface Json0Component {
  p: (string | number)[];
  oi?: unknown;
  od?: unknown;
  si?: string;
  sd?: string;
}

export type SceneVersion = "published" | "draft";

/** `doc` with `ops` applied; `doc` itself is left as it was. */
export function applyOps(doc: SceneDocument, ops: readonly Json0Component[]): SceneDocument {
  return json0.apply(structuredClone(doc), structuredClone([...ops])) as SceneDocument;
}

/** `ops` rewritten to apply after `against`; `left` loses a tie. */
export function transformOps(
  ops: readonly Json0Component[],
  against: readonly Json0Component[],
  side: "left" | "right"
): Json0Component[] {
  return json0.transform(structuredClone([...ops]), structuredClone([...against]), side) as Json0Component[];
}

/** One op with the effect of `first` then `second`. */
export function composeOps(first: readonly Json0Component[], second: readonly Json0Component[]): Json0Component[] {
  return json0.compose(structuredClone([...first]), structuredClone([...second])) as Json0Component[];
}

/** Structural equality for JSON values, ignoring object key order. */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) {
    return false;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, i) => sameValue(item, b[i]));
  }
  const aRecord = a as Record<string, unknown>;
  const bRecord = b as Record<string, unknown>;
  const aKeys = Object.keys(aRecord);
  if (aKeys.length !== Object.keys(bRecord).length) {
    return false;
  }
  return aKeys.every((key) => Object.hasOwn(bRecord, key) && sameValue(aRecord[key], bRecord[key]));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The ops that turn `from` into `to`: objects compared key by key, text as
 * one splice, anything else replaced whole.
 */
export function diffDocuments(from: SceneDocument, to: SceneDocument): Json0Component[] {
  const ops: Json0Component[] = [];
  diffValue([], from, to, ops);
  return ops;
}

function diffValue(path: (string | number)[], from: unknown, to: unknown, ops: Json0Component[]): void {
  if (sameValue(from, to)) {
    return;
  }
  if (isPlainObject(from) && isPlainObject(to)) {
    for (const key of Object.keys(from)) {
      if (!Object.hasOwn(to, key)) {
        ops.push({ p: [...path, key], od: from[key] });
      }
    }
    for (const key of Object.keys(to)) {
      if (!Object.hasOwn(from, key)) {
        ops.push({ p: [...path, key], oi: to[key] });
      } else {
        diffValue([...path, key], from[key], to[key], ops);
      }
    }
    return;
  }
  if (typeof from === "string" && typeof to === "string" && path.length > 0) {
    let start = 0;
    while (start < from.length && start < to.length && from[start] === to[start]) {
      start++;
    }
    let endFrom = from.length;
    let endTo = to.length;
    while (endFrom > start && endTo > start && from[endFrom - 1] === to[endTo - 1]) {
      endFrom--;
      endTo--;
    }
    if (endFrom > start) {
      ops.push({ p: [...path, start], sd: from.slice(start, endFrom) });
    }
    if (endTo > start) {
      ops.push({ p: [...path, start], si: to.slice(start, endTo) });
    }
    return;
  }
  ops.push({ p: path, od: from, oi: to });
}

/** A stacking key for the placement at `index`, bottom first. */
export function zKey(index: number): string {
  return `a${index.toString(36).padStart(4, "0")}`;
}

/** The placement ids, bottom of the stack first. */
export function stackOrder(doc: SceneDocument): string[] {
  return Object.keys(doc.widgets).sort((a, b) => {
    const za = doc.widgets[a]!.z;
    const zb = doc.widgets[b]!.z;
    return za < zb ? -1 : za > zb ? 1 : a < b ? -1 : a > b ? 1 : 0;
  });
}
