import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { WidgetInspectorTabs } from "./widget-inspector-tabs";

function render() {
  return renderToStaticMarkup(
    <WidgetInspectorTabs
      settings={<p>Widget settings</p>}
      transitions={<p>Transitions pane</p>}
      effects={<p>Effects pane</p>}
      idPrefix="scene-node-1"
    />
  );
}

describe("WidgetInspectorTabs", () => {
  test("offers Settings, Transitions and Effects as three triggers", () => {
    const html = render();
    for (const tab of ["settings", "transitions", "effects"]) {
      expect(html).toContain(`data-testid="widget-inspector-tab-${tab}"`);
    }
    for (const label of ["Settings", "Transitions", "Effects"]) {
      expect(html).toContain(label);
    }
  });

  test("opens on Settings, leaving the other panes closed", () => {
    const html = render();
    expect(html).toContain("Widget settings");
    expect(html).not.toContain("Transitions pane");
    expect(html).not.toContain("Effects pane");
  });
});
