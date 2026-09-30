import { describe, expect, test } from "bun:test";
import { MAIN_NAV_SECTIONS, UTILITY_SECTIONS } from "@/components/layout/nav-config";
import { navigationCommands } from "./navigation-commands";

function hrefs(): string[] {
  return navigationCommands().flatMap((command) => (command.action.type === "navigate" ? [command.action.href] : []));
}

describe("navigationCommands", () => {
  // The palette reads the menu rather than listing pages itself, so a page added to the
  // menu can be reached from it without anyone remembering to add it here too.
  test("reaches every menu destination", () => {
    const destinations = [...MAIN_NAV_SECTIONS, ...UTILITY_SECTIONS].flatMap((section) =>
      section.children ? section.children.map((child) => child.href) : [section.href]
    );
    expect(hrefs()).toEqual(expect.arrayContaining(destinations));
  });

  test("gives every entry a unique id", () => {
    const ids = navigationCommands().map((command) => command.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
