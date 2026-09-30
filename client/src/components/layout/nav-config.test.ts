import { describe, expect, test } from "bun:test";
import { ADMIN_ITEMS, isNavItemActive, navItemsFor, STREAM_ITEMS } from "@/components/layout/nav-config";
import { alertEditorPath } from "@/lib/alert-editor-route";
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
    expect(isNavItemActive(alerts, alertEditorPath({ event: "channel.follow", triggerId: "t1", actionId: "a1" }))).toBe(
      true
    );
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
