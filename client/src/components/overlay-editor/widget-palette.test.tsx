import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { WidgetPalette } from "./widget-palette";

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
  test("lists collapsible purpose sections with every widget's name and description", () => {
    const html = render();
    for (const label of ["Content", "Data &amp; sources", "Overlays"]) {
      expect(html).toContain(label);
    }
    for (const widget of widgets) {
      expect(html).toContain(`data-testid="add-widget-${widget.widgetId}"`);
      expect(html).toContain(widget.name);
      expect(html).toContain(widget.description);
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
