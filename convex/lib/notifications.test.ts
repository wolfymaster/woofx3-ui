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
    expect(parseNotificationContent({ heading: "  Update ", description: " New engine ", link: " /admin " })).toEqual({
      ok: true,
      value: { heading: "Update", description: "New engine", link: "/admin" },
    });
  });

  it("treats an empty or missing link as none", () => {
    expect(parseNotificationContent({ heading: "a", description: "b", link: "" })).toEqual({
      ok: true,
      value: { heading: "a", description: "b", link: null },
    });
    expect(parseNotificationContent({ heading: "a", description: "b", link: undefined })).toMatchObject({ ok: true });
  });

  it("enforces the length limits", () => {
    expect(parseNotificationContent({ heading: "x".repeat(50), description: "y".repeat(150), link: null }).ok).toBe(
      true
    );
    expect(parseNotificationContent({ heading: "x".repeat(51), description: "y", link: null }).ok).toBe(false);
    expect(parseNotificationContent({ heading: "x", description: "y".repeat(151), link: null }).ok).toBe(false);
    expect(parseNotificationContent({ heading: "   ", description: "y", link: null }).ok).toBe(false);
    expect(parseNotificationContent({ heading: "x", description: "", link: null }).ok).toBe(false);
  });

  it("refuses wrong types and bad links", () => {
    expect(parseNotificationContent({ heading: 1, description: "y", link: null }).ok).toBe(false);
    expect(parseNotificationContent({ heading: "x", description: "y", link: 5 }).ok).toBe(false);
    expect(parseNotificationContent({ heading: "x", description: "y", link: "//evil" }).ok).toBe(false);
  });
});
