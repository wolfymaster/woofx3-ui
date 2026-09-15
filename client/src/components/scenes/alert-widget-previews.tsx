import type { ReactNode } from "react";
import type { Widget } from "@/types";

// Stand-ins for the bundled Text and Image widgets on the alert layout canvas,
// which draws placeholders rather than the widgets themselves, so a layout
// reads as the alert will. Each mirrors its widget's own rendering
// (woofx3 modules/woofx3/widgets/*/index.html).

const FITS = ["contain", "cover", "fill"] as const;
const ALIGNMENTS = ["left", "center", "right"] as const;

/** The stand-in for a layout widget, or null for the generic placeholder. */
export function alertWidgetPreview(widget: Widget): ReactNode {
  switch (widget.widgetCanonicalId) {
    case "woofx3:widget:text":
      return <TextWidgetPreview settings={widget.settings} />;
    case "woofx3:widget:image": {
      const src = mediaUrl(widget.settings.src);
      return src ? (
        <img src={src} alt="" className="w-full h-full" style={{ objectFit: fitOf(widget.settings.fit) }} />
      ) : null;
    }
    default:
      return null;
  }
}

/** The Text widget's look: `{primary}…{primary}` segments shown in the highlight color, never as markup. */
export function TextWidgetPreview({ settings }: { settings: Record<string, unknown> }) {
  const text = typeof settings.text === "string" ? settings.text : "";
  const highlight = stringOr(settings.highlightColor, "#ec6758");
  const align = ALIGNMENTS.find((a) => a === settings.align) ?? "center";
  return (
    <div className="w-full h-full flex items-center p-2 box-border">
      <div
        className="w-full font-bold leading-tight whitespace-pre-wrap"
        style={{
          color: stringOr(settings.color, "#ffffff"),
          fontFamily: stringOr(settings.fontFamily, "Roboto, system-ui, sans-serif"),
          fontSize: typeof settings.fontSize === "number" ? settings.fontSize : 48,
          textAlign: align,
          overflowWrap: "anywhere",
          textShadow: "0 2px 8px rgba(0, 0, 0, 0.7)",
        }}
      >
        {text.split("{primary}").map((segment, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: segments are positional and never reorder
          <span key={i} style={i % 2 === 1 ? { color: highlight } : undefined}>
            {segment}
          </span>
        ))}
      </div>
    </div>
  );
}

function mediaUrl(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "object" && value !== null && typeof (value as { url?: unknown }).url === "string") {
    return (value as { url: string }).url;
  }
  return "";
}

function fitOf(value: unknown): (typeof FITS)[number] {
  return FITS.find((fit) => fit === value) ?? "contain";
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() !== "" ? value : fallback;
}
