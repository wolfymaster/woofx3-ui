import { describe, expect, test } from "bun:test";
import {
  ADMIN_ITEMS,
  ALERT_GROUPS_ITEM,
  flattenNavItems,
  isNavItemActive,
  type NavItem,
  navItemsFor,
  navItemsServed,
  STREAM_GROUPS,
  STREAM_ITEMS,
  withAlertGroupsItems,
  withInstalledModuleItems,
  withResourceKindItems,
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

describe("Modules group", () => {
  const settings = STREAM_ITEMS.find((item) => item.id === "modules-settings");
  if (!settings) {
    throw new Error("the Settings entry is missing from STREAM_ITEMS");
  }
  const obs = { id: "module:obs", label: "OBS", icon: alerts.icon, href: "/stream/modules/woofx3_obs" };

  test("Settings is marked on its own page only, not on a module's page", () => {
    expect(isNavItemActive(settings, "/stream/modules")).toBe(true);
    expect(isNavItemActive(settings, "/stream/modules/woofx3_obs")).toBe(false);
  });

  test("installed modules follow Settings under the group's heading", () => {
    const merged = withInstalledModuleItems(STREAM_ITEMS, [obs]);
    const at = merged.findIndex((item) => item.id === obs.id);
    expect(merged[at - 1].id).toBe("modules-settings");
    expect(merged[at].group).toBe(STREAM_GROUPS.modules);
  });

  test("leaves a menu without the group as it is", () => {
    const helpOnly = [{ id: "learning", label: "Learning", icon: alerts.icon, href: "/help/learning" }];
    expect(withInstalledModuleItems(helpOnly, [obs])).toEqual(helpOnly);
  });
});

describe("withAlertGroupsItems", () => {
  test("puts Alert Groups right after Alerts", () => {
    const merged = withAlertGroupsItems(STREAM_ITEMS, [ALERT_GROUPS_ITEM]);
    expect(merged.map((item) => item.id).slice(0, 3)).toEqual(["alerts", "alert-groups", "commands"]);
  });

  test("Alerts is not marked on the Alert Groups pages", () => {
    expect(isNavItemActive(alerts, ALERT_GROUPS_ITEM.href)).toBe(false);
    expect(isNavItemActive(ALERT_GROUPS_ITEM, `${ALERT_GROUPS_ITEM.href}/new`)).toBe(true);
  });

  test("leaves a menu without Alerts, or with nothing to add, as it is", () => {
    const helpOnly = [{ id: "learning", label: "Learning", icon: alerts.icon, href: "/help/learning" }];
    expect(withAlertGroupsItems(helpOnly, [ALERT_GROUPS_ITEM])).toEqual(helpOnly);
    expect(withAlertGroupsItems(STREAM_ITEMS, [])).toBe(STREAM_ITEMS);
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

describe("STREAM_ITEMS", () => {
  test("every entry is in a group, and each group is one run", () => {
    const groups = STREAM_ITEMS.map((item) => item.group);
    expect(groups.every((group) => group !== undefined)).toBe(true);
    const runs = groups.filter((group, i) => group !== groups[i - 1]);
    expect(runs).toEqual(Object.values(STREAM_GROUPS));
  });

  test("Workflows and Starter Packs are not in the menu", () => {
    const ids = flattenNavItems(STREAM_ITEMS).map((item) => item.id);
    expect(ids).not.toContain("workflows");
    expect(ids).not.toContain("starter-packs");
  });
});

describe("flattenNavItems", () => {
  test("nested entries follow their parent", () => {
    const parent = { ...alerts, children: [{ ...alerts, id: "child" }] };
    expect(flattenNavItems([parent, { ...alerts, id: "next" }]).map((item) => item.id)).toEqual([
      "alerts",
      "child",
      "next",
    ]);
  });
});

describe("withResourceKindItems", () => {
  const wheels = {
    id: "resource-kind:wheel_spin:wheel",
    label: "Wheels",
    icon: alerts.icon,
    href: "/stream/resources/wheel_spin/wheel",
  };

  test("adds the extra entries at the end of the Data group", () => {
    const merged = withResourceKindItems(STREAM_ITEMS, [wheels]);
    const at = merged.findIndex((item) => item.id === wheels.id);
    expect(merged[at - 1].id).toBe("databases");
    expect(merged[at].group).toBe(STREAM_GROUPS.data);
    expect(merged[at + 1].group).toBe(STREAM_GROUPS.modules);
  });

  test("leaves a menu without a Data group as it is", () => {
    const helpOnly = [{ id: "learning", label: "Learning", icon: alerts.icon, href: "/help/learning" }];
    expect(withResourceKindItems(helpOnly, [wheels])).toEqual(helpOnly);
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
