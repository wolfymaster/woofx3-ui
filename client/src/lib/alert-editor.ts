import type { WidgetKind } from "@woofx3/scene/editor";
import type { ResolvedTimeline } from "@woofx3/scene/model";

/**
 * What the alert editor shows about its layers: their lengths, the alert's
 * length, and the label a layer goes by. Geometry, defaults and edits are
 * the composition editor's (`@woofx3/scene/editor`); these only read.
 *
 * A layer's length is its `settings.duration` in seconds, the setting the
 * bundled alert widgets complete by.
 */

/** A layer as these read it: a placement's id and settings. */
export interface TimedLayer {
  id: string;
  settings: Record<string, unknown>;
}

export function durationOf(layer: Pick<TimedLayer, "settings">): number {
  const value = layer.settings.duration;
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

/** How long the alert plays: until its longest layer ends. Zero when no layer has a length. */
export function alertLengthSeconds(layers: readonly Pick<TimedLayer, "settings">[]): number {
  return layers.reduce((longest, layer) => Math.max(longest, durationOf(layer)), 0);
}

/**
 * How long the alert plays, in seconds, as the overlay plays it: until every
 * layer has left, exit transitions included, which is the editor's estimated
 * tracks' `finishMs` and the length the live preview reports. An alert whose
 * layers have no length holds UNTIMED_ALERT_MS rather than ending at once.
 * Without tracks (nothing resolved yet) it falls back to the longest layer.
 */
export function playedLengthSeconds(
  tracks: Pick<ResolvedTimeline, "finishMs"> | null,
  layers: readonly Pick<TimedLayer, "settings">[]
): number {
  if (tracks !== null && tracks.finishMs !== null) {
    return tracks.finishMs / 1000;
  }
  return alertLengthSeconds(layers);
}

/** Seconds as the editor's readouts show them: whole seconds bare, anything else to a tenth. */
export function formatSeconds(seconds: number): string {
  return `${Number.isInteger(seconds) ? seconds : seconds.toFixed(1)}s`;
}

/**
 * What a layer is called in the layers list and on the stage: a Text layer
 * by its text (as the page shows it, variables shortened), a media layer by
 * its name and file, anything else by its name.
 */
export function layerLabel(
  layer: { kind: WidgetKind; name: string; settings: Record<string, unknown> },
  displayText: (text: string) => string
): string {
  if (layer.kind === "text") {
    const text = typeof layer.settings.text === "string" ? displayText(layer.settings.text).trim() : "";
    return text || layer.name;
  }
  const file = fileName(layer.settings.src);
  return file ? `${layer.name} · ${file}` : layer.name;
}

/** A media setting's file name: an uploaded asset carries one, a URL ends in one. */
export function fileName(src: unknown): string {
  if (typeof src === "object" && src !== null && typeof (src as { name?: unknown }).name === "string") {
    return (src as { name: string }).name;
  }
  if (typeof src === "string" && src) {
    return src.split("/").pop() ?? src;
  }
  return "";
}
