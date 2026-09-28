import { describe, expect, test } from "bun:test";
import { canManageTwitchLink, relinkRefusal } from "./twitchLinkPolicy";

describe("canManageTwitchLink", () => {
  test("owners and admins may connect Twitch", () => {
    expect(canManageTwitchLink("owner")).toBe(true);
    expect(canManageTwitchLink("admin")).toBe(true);
  });

  test("members and non-members may not", () => {
    expect(canManageTwitchLink("member")).toBe(false);
    expect(canManageTwitchLink(null)).toBe(false);
    expect(canManageTwitchLink(undefined)).toBe(false);
  });
});

describe("relinkRefusal", () => {
  const existing = { platformUserId: "111", platformUsername: "broadcaster" };

  test("a first connect is allowed for any account", () => {
    expect(relinkRefusal(null, "222")).toBeNull();
  });

  test("reconnecting as the linked account is allowed", () => {
    expect(relinkRefusal(existing, "111")).toBeNull();
  });

  test("reconnecting as another account is refused, naming the linked one", () => {
    expect(relinkRefusal(existing, "222")).toContain("@broadcaster");
  });
});
