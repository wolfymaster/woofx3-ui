import { describe, expect, test } from "bun:test";
import type { DashboardPanelWidget } from "@shared/dashboard-layout";
import { Radio } from "lucide-react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { type DashboardCatalog, DashboardCatalogProvider, noPinnedRailItem } from "@/lib/dashboard-widgets/catalog";
import { DashboardCanvas } from "./dashboard-canvas";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Status() {
  return <span data-testid="status-widget">live</span>;
}

const catalog: DashboardCatalog = {
  widgets: [
    {
      type: "stream-status",
      label: "Stream Status",
      description: "",
      icon: Radio,
      category: "stream",
      component: Status,
    },
  ],
  usePinnedRailItem: noPinnedRailItem,
  Notice: null,
};

const noop = () => {};

function renderCanvas(widgets: DashboardPanelWidget[]): ReactTestRenderer {
  let renderer: ReactTestRenderer | undefined;
  act(() => {
    renderer = create(
      <DashboardCatalogProvider catalog={catalog}>
        <DashboardCanvas
          panelId="p1"
          layoutId="two-columns"
          widgets={widgets}
          isEditing={false}
          onAddWidget={noop}
          onRemoveWidget={noop}
          onMoveWidget={noop}
          onWidgetConfigChange={noop}
          onResizeWidgets={noop}
        />
      </DashboardCatalogProvider>
    );
  });
  if (!renderer) {
    throw new Error("the canvas did not render");
  }
  return renderer;
}

describe("DashboardCanvas", () => {
  test("a saved widget the catalog lacks shows as unavailable beside the ones it has", () => {
    const renderer = renderCanvas([
      { zoneId: "0-0", slotId: "a", type: "stream-status" },
      { zoneId: "0-1", slotId: "b", type: "macro-pad", config: { macros: [] } },
    ]);
    expect(renderer.root.findAllByProps({ "data-testid": "status-widget" })).toHaveLength(1);
    expect(renderer.root.findAllByProps({ "data-testid": "widget-unavailable-macro-pad" })).toHaveLength(1);
    act(() => renderer.unmount());
  });
});
