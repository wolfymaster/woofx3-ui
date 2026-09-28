import { describe, expect, test } from "bun:test";
import { macroTriggerExamples, macroTriggerStatusLabel } from "./macro-trigger-examples";

const URL_ = "https://x.convex.site/api/macros/trigger/wfxm_abc";

describe("macroTriggerExamples", () => {
  test("a macro without variables gets a bare POST", () => {
    const curl = macroTriggerExamples(URL_, [], false).find((example) => example.id === "curl");
    expect(curl?.text).toBe(`curl -X POST '${URL_}'`);
  });

  test("variables become a JSON body", () => {
    const curl = macroTriggerExamples(URL_, ["channel"], false).find((example) => example.id === "curl");
    expect(curl?.text).toBe(`curl -X POST '${URL_}' -H 'Content-Type: application/json' -d '{"channel":"<channel>"}'`);
  });

  test("the GET-only Website action appears only when GET is allowed", () => {
    expect(macroTriggerExamples(URL_, [], false).map((example) => example.id)).not.toContain("stream-deck-website");
    const website = macroTriggerExamples(URL_, ["channel"], true).find(
      (example) => example.id === "stream-deck-website"
    );
    expect(website?.text).toContain(`${URL_}?channel=<channel>`);
  });

  test("every example carries the URL", () => {
    for (const example of macroTriggerExamples(URL_, ["a"], true)) {
      expect(example.text).toContain(URL_);
    }
  });
});

describe("macroTriggerStatusLabel", () => {
  test("says never used for a fresh trigger", () => {
    expect(macroTriggerStatusLabel({ useCount: 0 })).toBe("Enabled · never used");
  });

  test("names the last use and the count", () => {
    const label = macroTriggerStatusLabel({ lastUsedAt: Date.now() - 5 * 60_000, useCount: 1 });
    expect(label).toBe("Enabled · last used 5 minutes ago · 1 use");
  });
});
