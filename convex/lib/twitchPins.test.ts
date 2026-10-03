import { describe, expect, it } from "bun:test";
import { parsePinsResponse } from "./twitchPins";

const pinned = {
  data: [
    {
      message_id: "abc-123",
      broadcaster_id: "1",
      sender_user_id: "2",
      sender_user_login: "viewer",
      sender_user_name: "Viewer",
      pinned_by_user_id: "1",
      message: { text: "Giveaway at 9pm!", fragments: [] },
      starts_at: "2026-10-03T20:00:00Z",
      ends_at: null,
      updated_at: "2026-10-03T20:00:00Z",
    },
  ],
};

describe("parsePinsResponse", () => {
  it("reads the message text, sender and timing", () => {
    expect(parsePinsResponse(pinned)).toEqual({
      messageId: "abc-123",
      text: "Giveaway at 9pm!",
      senderName: "Viewer",
      pinnedAtMs: Date.parse("2026-10-03T20:00:00Z"),
      endsAt: null,
    });
  });

  it("is null when nothing is pinned", () => {
    expect(parsePinsResponse({ data: [] })).toBeNull();
    expect(parsePinsResponse({})).toBeNull();
    expect(parsePinsResponse(null)).toBeNull();
  });

  it("keeps the pin when Twitch leaves out the text", () => {
    const parsed = parsePinsResponse({ data: [{ message_id: "abc-123" }] });
    expect(parsed).toEqual({ messageId: "abc-123", text: null, senderName: null, pinnedAtMs: null, endsAt: null });
  });

  it("falls back to the login when there is no display name", () => {
    const parsed = parsePinsResponse({ data: [{ message_id: "a", sender_user_login: "viewer" }] });
    expect(parsed?.senderName).toBe("viewer");
  });
});
