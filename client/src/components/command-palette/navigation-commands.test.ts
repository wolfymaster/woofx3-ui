import { describe, expect, test } from "bun:test";
import { Boxes } from "lucide-react";
import { type InstanceHosting, MAIN_NAV_SECTIONS, UTILITY_SECTIONS } from "@/components/layout/nav-config";
import { navigationCommands } from "./navigation-commands";

function hrefs(hosting: InstanceHosting, isAdmin = true): string[] {
  return navigationCommands(hosting, isAdmin).flatMap((command) =>
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

  test("leaves out instance settings for a member", () => {
    expect(hrefs("external", true)).toContain("/admin/engine");
    expect(hrefs("external", false).filter((href) => href.startsWith("/admin"))).toEqual([]);
    expect(hrefs("external", false)).toContain("/team");
  });

  test("reaches the page of each kind an installed module declares, under Stream", () => {
    const wheels = {
      id: "resource-kind:wheel_spin:wheel",
      label: "Wheels",
      icon: Boxes,
      href: "/stream/resources/wheel_spin/wheel",
    };
    const command = navigationCommands("external", true, [wheels]).find((entry) => entry.id === `page:${wheels.id}`);
    expect(command?.action).toEqual({ type: "navigate", href: wheels.href });
    expect(command?.subtitle).toBe("Stream");
  });

  test("gives every entry a unique id", () => {
    const ids = navigationCommands("external", true).map((command) => command.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
