import { describe, expect, test } from "bun:test";
import { shortcutModifierLabel } from "./shortcut-modifier";

describe("shortcutModifierLabel", () => {
  const cases = [
    { name: "macOS", userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15", label: "⌘" },
    { name: "iPad", userAgent: "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15", label: "⌘" },
    { name: "Windows", userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36", label: "Ctrl" },
    { name: "Linux", userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36", label: "Ctrl" },
    { name: "an empty user agent", userAgent: "", label: "Ctrl" },
  ];

  for (const { name, userAgent, label } of cases) {
    test(name, () => {
      expect(shortcutModifierLabel(userAgent)).toBe(label);
    });
  }
});
