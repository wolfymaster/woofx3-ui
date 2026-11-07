import { describe, expect, test } from "bun:test";
import { externalLinkTarget } from "./external-links";

const APP = "http://tauri.localhost";

describe("externalLinkTarget", () => {
  const cases: { name: string; href: string; expected: string | null }[] = [
    {
      name: "another site",
      href: "https://www.twitch.tv/activate",
      expected: "https://www.twitch.tv/activate",
    },
    { name: "a clip", href: "https://clips.twitch.tv/abc", expected: "https://clips.twitch.tv/abc" },
    {
      name: "the local engine's overlay",
      href: "http://127.0.0.1:9101/overlay",
      expected: "http://127.0.0.1:9101/overlay",
    },
    { name: "an app page", href: "/admin/integrations", expected: null },
    { name: "an in-page anchor", href: "#section", expected: null },
    { name: "a mail link", href: "mailto:someone@example.com", expected: null },
    { name: "a script link", href: "javascript:alert(1)", expected: null },
    { name: "a file link", href: "file:///C:/Windows/notepad.exe", expected: null },
  ];

  for (const { name, href, expected } of cases) {
    test(name, () => {
      expect(externalLinkTarget(href, APP)).toBe(expected);
    });
  }
});
