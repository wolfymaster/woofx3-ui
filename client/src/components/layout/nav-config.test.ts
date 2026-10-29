import { describe, expect, test } from "bun:test";
import {
  ADMIN_ITEMS,
  flattenNavItems,
  isNavGroupOpen,
  isNavItemActive,
  type NavItem,
  navItemsFor,
  navItemsServed,
  STREAM_ITEMS,
  withAlertsChildren,
} from "@/components/layout/nav-config";
import { libraryAlertEditorPath } from "@/lib/alert-editor-route";
import { alertRunPath } from "@/lib/alert-run-route";

const alerts = STREAM_ITEMS.find((item) => item.id === "alerts");
if (!alerts) {
  throw new Error("the Alerts entry is missing from STREAM_ITEMS");
}

describe("isNavItemActive", () => {
  test("its own page marks it", () => {
    expect(isNavItemActive(alerts, "/stream/alerts")).toBe(true);
  });

  test("a page below it marks it", () => {
    expect(isNavItemActive(alerts, "/stream/alerts/twitch/subscription")).toBe(true);
  });

  test("a run it owns marks it, though the path sits beside it", () => {
    expect(isNavItemActive(alerts, alertRunPath("run-1"))).toBe(true);
  });

  test("an editor it owns marks it", () => {
    expect(isNavItemActive(alerts, libraryAlertEditorPath("comp-1"))).toBe(true);
  });

  test("another page does not mark it", () => {
    expect(isNavItemActive(alerts, "/stream/commands")).toBe(false);
  });

  test("a path its own only prefixes does not mark it", () => {
    expect(isNavItemActive(alerts, "/stream/alerts-elsewhere")).toBe(false);
  });
});

describe("navItemsFor", () => {
  function ids(hosting: Parameters<typeof navItemsFor>[1]): string[] {
    return navItemsFor(ADMIN_ITEMS, hosting).map((item) => item.id);
  }

  test("a managed instance loses the self-hosted entries", () => {
    expect(ids("managed")).not.toContain("storage");
    expect(ids("managed")).toContain("engine");
  });

  test("a self-hosted instance keeps every entry", () => {
    expect(ids("external")).toEqual(ADMIN_ITEMS.map((item) => item.id));
  });

  test("an instance with no recorded hosting keeps every entry", () => {
    expect(ids(undefined)).toEqual(ADMIN_ITEMS.map((item) => item.id));
  });
});

describe("isNavGroupOpen", () => {
  test("its own page opens it", () => {
    expect(isNavGroupOpen(alerts, "/stream/alerts")).toBe(true);
  });

  test("a nested entry's page keeps it open", () => {
    expect(isNavGroupOpen(alerts, "/stream/counters/death_count")).toBe(true);
    expect(isNavGroupOpen(alerts, "/stream/workflows")).toBe(true);
  });

  test("an unrelated page leaves it closed", () => {
    expect(isNavGroupOpen(alerts, "/stream/scenes")).toBe(false);
  });

  test("an entry with nothing nested never opens", () => {
    const commands = STREAM_ITEMS.find((item) => item.id === "commands");
    if (!commands) {
      throw new Error("the Commands entry is missing from STREAM_ITEMS");
    }
    expect(isNavGroupOpen(commands, "/stream/commands")).toBe(false);
  });
});

describe("flattenNavItems", () => {
  test("nested entries follow their parent", () => {
    const ids = flattenNavItems(STREAM_ITEMS).map((item) => item.id);
    expect(ids.slice(ids.indexOf("alerts"), ids.indexOf("alerts") + 5)).toEqual([
      "alerts",
      "counters",
      "timers",
      "queues",
      "workflows",
    ]);
  });
});

describe("withAlertsChildren", () => {
  const wheels = {
    id: "resource-kind:wheel_spin:wheel",
    label: "Wheels",
    icon: alerts.icon,
    href: "/stream/resources/wheel_spin/wheel",
  };

  test("nests the extra entries under Alerts, ahead of Workflows", () => {
    const merged = withAlertsChildren(STREAM_ITEMS, [wheels]);
    const ids = merged.find((item) => item.id === "alerts")?.children?.map((child) => child.id);
    expect(ids).toEqual(["counters", "timers", "queues", "resource-kind:wheel_spin:wheel", "workflows"]);
  });

  test("leaves a menu without Alerts as it is", () => {
    const helpOnly = [{ id: "learning", label: "Learning", icon: alerts.icon, href: "/help/learning" }];
    expect(withAlertsChildren(helpOnly, [wheels])).toEqual(helpOnly);
  });

  test("a page for an extra entry keeps Alerts open", () => {
    const merged = withAlertsChildren(STREAM_ITEMS, [wheels]);
    const mergedAlerts = merged.find((item) => item.id === "alerts");
    if (!mergedAlerts) {
      throw new Error("the Alerts entry is missing");
    }
    expect(isNavGroupOpen(mergedAlerts, "/stream/resources/wheel_spin/wheel/prizes")).toBe(true);
  });
});

describe("navItemsServed", () => {
  const icon = () => null;
  const items: NavItem[] = [
    { id: "a", label: "A", icon, href: "/a" },
    {
      id: "s",
      label: "S",
      icon,
      href: "/s",
      children: [
        { id: "s1", label: "S1", icon, href: "/s/1" },
        { id: "s2", label: "S2", icon, href: "/s/2" },
      ],
    },
  ];

  test("keeps served entries and their served children", () => {
    const served = navItemsServed(items, (href) => ["/a", "/s", "/s/2"].includes(href));
    expect(served.map((item) => item.id)).toEqual(["a", "s"]);
    expect(served[1].children?.map((item) => item.id)).toEqual(["s2"]);
  });

  test("an entry without its own page leads to its first served child", () => {
    const served = navItemsServed(items, (href) => href === "/s/2");
    expect(served).toHaveLength(1);
    expect(served[0]).toMatchObject({ id: "s", href: "/s/2" });
  });

  test("drops an entry with nothing served", () => {
    expect(navItemsServed(items, () => false)).toEqual([]);
  });
});
