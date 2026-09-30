import { describe, expect, test } from "bun:test";
import { type InstanceHosting, MAIN_NAV_SECTIONS, UTILITY_SECTIONS } from "@/components/layout/nav-config";
import { navigationCommands } from "./navigation-commands";

function hrefs(hosting: InstanceHosting): string[] {
  return navigationCommands(hosting).flatMap((command) =>
    command.action.type === "navigate" ? [command.action.href] : []
  );
}

describe("navigationCommands", () => {
  // The palette reads the menu rather than listing pages itself, so a page added to the
  // menu can be reached from it without anyone remembering to add it here too.
  test("reaches every menu destination", () => {
    const destinations = [...MAIN_NAV_SECTIONS, ...UTILITY_SECTIONS].flatMap((section) =>
      section.children ? section.children.map((child) => child.href) : [section.href]
    );
    expect(hrefs("external")).toEqual(expect.arrayContaining(destinations));
  });

  test("leaves out Storage for a managed engine", () => {
    expect(hrefs("external")).toContain("/admin/storage");
    expect(hrefs("managed")).not.toContain("/admin/storage");
  });

  test("gives every entry a unique id", () => {
    const ids = navigationCommands("external").map((command) => command.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
