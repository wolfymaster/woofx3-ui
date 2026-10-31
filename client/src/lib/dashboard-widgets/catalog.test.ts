import { describe, expect, test } from "bun:test";
import { Radio, Zap } from "lucide-react";
import { type DashboardCatalog, findDashboardWidget, noPinnedRailItem } from "./catalog";

const empty = () => null;
const catalog: DashboardCatalog = {
  widgets: [
    { type: "events", label: "Events", description: "", icon: Zap, category: "stream", component: empty },
    { type: "stream-status", label: "Status", description: "", icon: Radio, category: "stream", component: empty },
  ],
  usePinnedRailItem: noPinnedRailItem,
  Notice: null,
};

describe("findDashboardWidget", () => {
  const cases: Array<{ name: string; type: string; expected: string | undefined }> = [
    { name: "a type the catalog has", type: "stream-status", expected: "stream-status" },
    { name: "a replaced type renders its replacement", type: "live-events", expected: "events" },
    { name: "another replaced type", type: "alert-log", expected: "events" },
    { name: "a type this catalog lacks", type: "macro-pad", expected: undefined },
  ];
  for (const { name, type, expected } of cases) {
    test(name, () => {
      expect(findDashboardWidget(catalog, type)?.type).toBe(expected);
    });
  }
});
