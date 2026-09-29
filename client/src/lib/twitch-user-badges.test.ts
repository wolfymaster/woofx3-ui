import { describe, expect, test } from "bun:test";
import { twitchUserBadges } from "@/lib/twitch-user-badges";

describe("twitchUserBadges", () => {
  test("partner or affiliate from the broadcaster type", () => {
    expect(twitchUserBadges({ broadcasterType: "partner" })).toEqual(["Partner"]);
    expect(twitchUserBadges({ broadcasterType: "affiliate" })).toEqual(["Affiliate"]);
    expect(twitchUserBadges({ broadcasterType: "" })).toEqual([]);
  });

  test("channel roles only when known to be held", () => {
    expect(twitchUserBadges({ broadcasterType: "affiliate", isModerator: true, isVip: true })).toEqual([
      "Affiliate",
      "Moderator",
      "VIP",
    ]);
    expect(twitchUserBadges({ isModerator: false, isVip: undefined })).toEqual([]);
  });
});
