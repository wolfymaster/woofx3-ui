import { afterEach, describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { WidgetPalette } from "./widget-palette";

const realWindow = globalThis.window;
const recentStorage: Storage = {
  length: 1,
  clear: () => undefined,
  getItem: (key) => (key === "woofx3:widget-palette:recent" ? JSON.stringify(["text", "record"]) : null),
  key: () => "woofx3:widget-palette:recent",
  removeItem: () => undefined,
  setItem: () => undefined,
};

function setWindow(value: Partial<Window> | undefined): void {
  Object.defineProperty(globalThis, "window", { value, configurable: true, writable: true });
}

afterEach(() => {
  setWindow(realWindow);
});

const widgets = [
  {
    widgetId: "text",
    name: "Text",
    description: "Styled text you set once and it stays until you change it.",
    taxonomy: ["text"],
  },
  {
    widgetId: "record",
    name: "Database value",
    description: "One value from a database row. Kept up to date as the row changes.",
    taxonomy: ["data.database"],
  },
  {
    widgetId: "image",
    name: "Image",
    description: "A picture you upload.",
    taxonomy: ["media.image"],
  },
  {
    widgetId: "wheel",
    name: "Wheel Spin",
    description: "A wheel that spins on the overlay.",
    taxonomy: ["overlay.wheel"],
  },
];

function render() {
  return renderToStaticMarkup(
    <WidgetPalette widgets={widgets} onAdd={() => undefined} layout="grid" emptyMessage="No widgets are installed." />
  );
}

describe("WidgetPalette", () => {
  test("shows a two-column shelf of preview tiles in each purpose section", () => {
    const html = render();
    for (const label of ["Content", "Data &amp; sources", "Overlays"]) {
      expect(html).toContain(label);
    }
    expect(html).toContain("grid-cols-2");
    for (const [sample, name] of [
      ["Aa", "Text"],
      ["{value}", "Database value"],
      ["WHEEL SPIN", "Wheel Spin"],
    ]) {
      expect(html).toContain(sample);
      expect(html).toContain(name);
    }
    for (const widget of widgets) {
      expect(html).toContain(`data-testid="add-widget-${widget.widgetId}"`);
    }
  });

  test("keeps each description in the tooltip instead of as a text row", () => {
    const html = render();
    for (const widget of widgets) {
      expect(html).toContain(`title="${widget.description}"`);
      expect(html.split(widget.description)).toHaveLength(2);
    }
  });

  test("centers each preview tile's name under its sample", () => {
    expect(render()).toContain("text-center text-[11px] font-medium leading-tight text-foreground");
  });

  test("shows a Recent section above the taxonomy sections once a widget has been added", () => {
    setWindow({ localStorage: recentStorage });
    const html = render();
    expect(html).toContain('data-testid="widget-section-recent"');
    expect(html).toContain('id="widget-section-content-recent"');
    const recentIndex = html.indexOf('data-testid="widget-section-recent"');
    expect(recentIndex).toBeLessThan(html.indexOf('data-testid="widget-section-content"'));
    // A repeated widget must keep one canonical add id, so a strict locator still finds one tile.
    for (const widgetId of ["text", "record"]) {
      expect(html).toContain(`data-testid="add-widget-recent-${widgetId}"`);
      expect(html.split(`data-testid="add-widget-${widgetId}"`)).toHaveLength(2);
    }
  });

  test("keeps the alert editor's horizontal strip as icon tiles", () => {
    const html = renderToStaticMarkup(
      <WidgetPalette widgets={widgets} onAdd={() => undefined} layout="row" emptyMessage="No widgets are installed." />
    );
    expect(html).not.toContain("grid-cols-2");
    expect(html).toContain("lucide");
    expect(html).toContain('title="Text"');
    for (const widget of widgets) {
      expect(html).toContain(`data-testid="add-widget-${widget.widgetId}"`);
    }
  });

  test("offers a search field for finding a widget by what it does", () => {
    expect(render()).toContain('placeholder="Search widgets"');
  });

  test("keeps the empty state when no widgets are installed", () => {
    const html = renderToStaticMarkup(
      <WidgetPalette widgets={[]} onAdd={() => undefined} layout="grid" emptyMessage="No widgets are installed." />
    );
    expect(html).toContain("No widgets are installed.");
  });
});
