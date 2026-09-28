import { describe, expect, test } from "bun:test";
import { acceptRefusal, invitationTarget } from "./invitationTarget";

describe("invitationTarget", () => {
  test("an email row targets that email", () => {
    expect(invitationTarget({ email: "mod@example.com" })).toEqual({ kind: "email", email: "mod@example.com" });
  });

  test("a platform row targets that platform account", () => {
    expect(invitationTarget({ platform: "twitch", platformUserId: "1234" })).toEqual({
      kind: "platform",
      platform: "twitch",
      platformUserId: "1234",
    });
  });

  test("a row with both or neither target is refused", () => {
    expect(() => invitationTarget({})).toThrow();
    expect(() => invitationTarget({ email: "" })).toThrow();
    expect(() => invitationTarget({ email: "a@b.c", platform: "twitch", platformUserId: "1" })).toThrow();
  });

  test("a platform row missing its user id is refused", () => {
    expect(() => invitationTarget({ platform: "twitch" })).toThrow();
    expect(() => invitationTarget({ platform: "twitch", platformUserId: "" })).toThrow();
  });
});

describe("acceptRefusal", () => {
  const twitchInvite = invitationTarget({ platform: "twitch", platformUserId: "1234" });
  const emailInvite = invitationTarget({ email: "mod@example.com" });

  test("a Twitch invite admits only the matching Twitch user id", () => {
    expect(acceptRefusal(twitchInvite, { email: null, twitchUserId: "1234" })).toBeNull();
    expect(acceptRefusal(twitchInvite, { email: null, twitchUserId: "9999" })).toBe(
      "Sign in with the Twitch account this invitation was sent to"
    );
  });

  test("a Twitch invite refuses a user who never signed in with Twitch, whatever their email", () => {
    expect(acceptRefusal(twitchInvite, { email: "mod@example.com", twitchUserId: null })).not.toBeNull();
  });

  test("an email invite admits only the matching email", () => {
    expect(acceptRefusal(emailInvite, { email: "mod@example.com", twitchUserId: null })).toBeNull();
    expect(acceptRefusal(emailInvite, { email: "other@example.com", twitchUserId: "1234" })).toBe(
      "Sign in with the email address this invitation was sent to"
    );
    expect(acceptRefusal(emailInvite, { email: null, twitchUserId: "1234" })).not.toBeNull();
  });
});
