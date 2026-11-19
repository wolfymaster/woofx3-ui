export type WidgetPreviewKind = "glyph" | "data" | "wordmark" | "swatch";

export interface WidgetPreview {
  /** How the sample is drawn in the tile's preview area. */
  kind: WidgetPreviewKind;
  /** The short sample of what the widget puts on screen. Absent for a swatch. */
  sample?: string;
  /** Whether the sample comes from a source that keeps changing. */
  live: boolean;
}

/**
 * A sample of a widget's content, not a picture of its category.
 *
 * An icon says "this is a database widget"; a sample says "this shows one value
 * from a source". That distinction matters here: a Database value draws text
 * much like Text does, and a category icon would make them look unrelated while
 * an honest sample makes the live value the thing you notice. Taxonomy keys the
 * well-known samples; anything else falls back to a wordmark of its own name,
 * which is a shape rather than an invented icon.
 */
const SAMPLE_BY_TAXONOMY: Record<string, WidgetPreview> = {
  text: { kind: "glyph", sample: "Aa", live: false },
  alert: { kind: "wordmark", sample: "ALERT", live: false },
  "data.counter": { kind: "data", sample: "1,024", live: true },
  "data.timer": { kind: "data", sample: "00:42", live: true },
  "data.queue": { kind: "data", sample: "1 → 2", live: true },
  "data.database": { kind: "data", sample: "{value}", live: true },
};

/** Up to two words: enough to read as a wordmark at tile width, not a caption. */
function wordmarkOf(name: string): string {
  const words = name.trim().split(/\s+/).slice(0, 2).join(" ").toUpperCase();
  return words === "" ? "WIDGET" : words;
}

export function widgetPreviewFor(widget: { name: string; taxonomy?: readonly string[] }): WidgetPreview {
  const entries = (widget.taxonomy ?? []).map((entry) => entry.trim().toLowerCase()).filter((entry) => entry !== "");

  for (const entry of entries) {
    const sample = SAMPLE_BY_TAXONOMY[entry];
    if (sample) {
      return sample;
    }
    // A module may declare a family without the specific axis we know.
    if (entry.startsWith("data.")) {
      return { kind: "data", sample: "{value}", live: true };
    }
    if (entry.startsWith("text.")) {
      return { kind: "glyph", sample: "Aa", live: false };
    }
    if (entry.startsWith("media.")) {
      return { kind: "swatch", live: false };
    }
  }

  return { kind: "wordmark", sample: wordmarkOf(widget.name), live: false };
}
