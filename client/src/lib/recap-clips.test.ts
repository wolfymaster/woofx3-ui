import { describe, expect, it } from "bun:test";
import { buildClipShareMessage, formatClipDuration, formatStreamOffset } from "./recap-clips";

describe("formatStreamOffset", () => {
  it("writes hours, minutes and seconds", () => {
    expect(formatStreamOffset(0)).toBe("0:00:00");
    expect(formatStreamOffset(65_900)).toBe("0:01:05");
    expect(formatStreamOffset((3 * 3600 + 7 * 60 + 9) * 1000)).toBe("3:07:09");
  });

  it("does not wrap past a day or go negative", () => {
    expect(formatStreamOffset(26 * 3600 * 1000)).toBe("26:00:00");
    expect(formatStreamOffset(-5_000)).toBe("0:00:00");
  });
});

describe("formatClipDuration", () => {
  it("rounds Twitch's fractional seconds", () => {
    expect(formatClipDuration(29.8)).toBe("0:30");
    expect(formatClipDuration(59.4)).toBe("0:59");
    expect(formatClipDuration(61)).toBe("1:01");
  });
});

describe("buildClipShareMessage", () => {
  const clip = { title: "Clutch round", creatorName: "some_mod", url: "https://clips.twitch.tv/abc" };

  it("names the title, the clipper and the link", () => {
    expect(buildClipShareMessage(clip)).toBe("Clutch round (clipped by some_mod): https://clips.twitch.tv/abc");
  });

  it("falls back when the title or creator is blank", () => {
    expect(buildClipShareMessage({ ...clip, title: "  ", creatorName: "" })).toBe("Clip: https://clips.twitch.tv/abc");
  });

  it("shortens the title, never the link, to fit", () => {
    const message = buildClipShareMessage({ ...clip, title: "x".repeat(600) });
    expect(message.length).toBe(500);
    expect(message.endsWith("… (clipped by some_mod): https://clips.twitch.tv/abc")).toBe(true);
  });
});
