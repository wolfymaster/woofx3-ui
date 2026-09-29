import { describe, expect, test } from "bun:test";
import { channelInfoFromHelix } from "./twitchChannels";

describe("channelInfoFromHelix", () => {
  test("reads title, category and tags", () => {
    const body = {
      data: [
        {
          broadcaster_id: "1",
          title: "Building things",
          game_id: "509670",
          game_name: "Science & Technology",
          tags: ["English", "Programming"],
        },
      ],
    };
    expect(channelInfoFromHelix(body)).toEqual({
      title: "Building things",
      categoryId: "509670",
      categoryName: "Science & Technology",
      tags: ["English", "Programming"],
    });
  });

  test("an unset category arrives as empty strings, not missing fields", () => {
    const info = channelInfoFromHelix({ data: [{ title: "", game_id: "", game_name: "", tags: [] }] });
    expect(info).toEqual({ title: "", categoryId: "", categoryName: "", tags: [] });
  });

  test("null when Twitch returned no channel", () => {
    expect(channelInfoFromHelix({ data: [] })).toBeNull();
    expect(channelInfoFromHelix(null)).toBeNull();
  });
});
