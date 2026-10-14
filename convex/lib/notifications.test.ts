import { describe, expect, it } from "bun:test";
import { notificationLinkKind, parseNotificationContent } from "./notifications";

describe("notificationLinkKind", () => {
  it("accepts paths in the app", () => {
    expect(notificationLinkKind("/admin/engine")).toBe("internal");
    expect(notificationLinkKind("/")).toBe("internal");
    expect(notificationLinkKind("/workflows?tab=runs#top")).toBe("internal");
  });

  it("accepts https URLs", () => {
    expect(notificationLinkKind("https://github.com/wolfymaster/woofx3/releases")).toBe("external");
  });

  it("refuses links that leave the app while looking internal, or are not https", () => {
    expect(notificationLinkKind("//evil.example")).toBeNull();
    expect(notificationLinkKind("/\\evil.example")).toBeNull();
    expect(notificationLinkKind("/a b")).toBeNull();
    expect(notificationLinkKind("http://example.com")).toBeNull();
    expect(notificationLinkKind("javascript:alert(1)")).toBeNull();
    expect(notificationLinkKind("admin/engine")).toBeNull();
    expect(notificationLinkKind(`/${"a".repeat(500)}`)).toBeNull();
  });
});

describe("parseNotificationContent", () => {
  it("trims and keeps valid content", () => {
    expect(
      parseNotificationContent({
        heading: "  Update ",
        description: " New engine ",
        link: " /admin ",
        actionLabel: null,
      })
    ).toEqual({
      ok: true,
      value: { heading: "Update", description: "New engine", link: "/admin", actionLabel: null },
    });
  });

  it("treats an empty or missing link as none", () => {
    expect(parseNotificationContent({ heading: "a", description: "b", link: "", actionLabel: null })).toEqual({
      ok: true,
      value: { heading: "a", description: "b", link: null, actionLabel: null },
    });
    expect(
      parseNotificationContent({ heading: "a", description: "b", link: undefined, actionLabel: null })
    ).toMatchObject({ ok: true });
  });

  it("enforces the length limits", () => {
    expect(
      parseNotificationContent({ heading: "x".repeat(50), description: "y".repeat(150), link: null, actionLabel: null })
        .ok
    ).toBe(true);
    expect(
      parseNotificationContent({ heading: "x".repeat(51), description: "y", link: null, actionLabel: null }).ok
    ).toBe(false);
    expect(
      parseNotificationContent({ heading: "x", description: "y".repeat(151), link: null, actionLabel: null }).ok
    ).toBe(false);
    expect(parseNotificationContent({ heading: "   ", description: "y", link: null, actionLabel: null }).ok).toBe(
      false
    );
    expect(parseNotificationContent({ heading: "x", description: "", link: null, actionLabel: null }).ok).toBe(false);
  });

  it("keeps an action label only alongside a link", () => {
    expect(
      parseNotificationContent({
        heading: "a",
        description: "b",
        link: "/admin/engine",
        actionLabel: " Upgrade engine ",
      })
    ).toMatchObject({ ok: true, value: { actionLabel: "Upgrade engine" } });
    expect(parseNotificationContent({ heading: "a", description: "b", link: "/x", actionLabel: "  " })).toMatchObject({
      ok: true,
      value: { actionLabel: null },
    });
    expect(parseNotificationContent({ heading: "a", description: "b", link: null, actionLabel: "Go" }).ok).toBe(false);
    expect(
      parseNotificationContent({ heading: "a", description: "b", link: "/x", actionLabel: "x".repeat(25) }).ok
    ).toBe(false);
    expect(parseNotificationContent({ heading: "a", description: "b", link: "/x", actionLabel: 3 }).ok).toBe(false);
  });

  it("refuses wrong types and bad links", () => {
    expect(parseNotificationContent({ heading: 1, description: "y", link: null, actionLabel: null }).ok).toBe(false);
    expect(parseNotificationContent({ heading: "x", description: "y", link: 5, actionLabel: null }).ok).toBe(false);
    expect(parseNotificationContent({ heading: "x", description: "y", link: "//evil", actionLabel: null }).ok).toBe(
      false
    );
  });
});
