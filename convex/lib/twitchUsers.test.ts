import { describe, expect, test } from "bun:test";
import { canReadChannelRole, normalizeTwitchLogin, twitchUserFromHelix } from "./twitchUsers";

describe("normalizeTwitchLogin", () => {
  test("strips a leading @ and lowercases", () => {
    expect(normalizeTwitchLogin("  @SomeOne_42 ")).toBe("someone_42");
    expect(normalizeTwitchLogin("wolfy")).toBe("wolfy");
  });

  test("refuses what cannot be a login", () => {
    for (const input of ["", "@", "two words", "émile", "a".repeat(26), "name!"]) {
      expect(normalizeTwitchLogin(input)).toBeNull();
    }
  });
});

describe("twitchUserFromHelix", () => {
  test("reads the first user", () => {
    const body = {
      data: [
        {
          id: "1234",
          login: "someone",
          display_name: "SomeOne",
          profile_image_url: "https://static-cdn.jtvnw.net/a.png",
          broadcaster_type: "affiliate",
        },
      ],
    };
    expect(twitchUserFromHelix(body)).toEqual({
      twitchUserId: "1234",
      login: "someone",
      displayName: "SomeOne",
      profileImageUrl: "https://static-cdn.jtvnw.net/a.png",
      broadcasterType: "affiliate",
    });
  });

  test("nobody found, as for a missing or suspended account, is null", () => {
    expect(twitchUserFromHelix({ data: [] })).toBeNull();
    expect(twitchUserFromHelix({})).toBeNull();
    expect(twitchUserFromHelix(null)).toBeNull();
  });

  test("falls back to the login when there is no display name, and drops an empty avatar", () => {
    const user = twitchUserFromHelix({
      data: [{ id: "1", login: "someone", display_name: "", profile_image_url: "" }],
    });
    expect(user?.displayName).toBe("someone");
    expect(user?.profileImageUrl).toBeUndefined();
  });
});

describe("canReadChannelRole", () => {
  test("any one of the accepted scopes is enough", () => {
    expect(canReadChannelRole("moderator", ["moderator:read:moderators"])).toBe(true);
    expect(canReadChannelRole("moderator", ["moderation:read"])).toBe(true);
    expect(canReadChannelRole("vip", ["moderator:read:vips"])).toBe(true);
  });

  test("without one, the role is not read", () => {
    expect(canReadChannelRole("moderator", ["moderator:read:vips"])).toBe(false);
    expect(canReadChannelRole("vip", [])).toBe(false);
  });
});
