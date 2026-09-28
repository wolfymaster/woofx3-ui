import { describe, expect, test } from "bun:test";
import { macroTriggerExamples, macroTriggerStatusLabel } from "./macro-trigger-examples";

const TOKEN = "wfxm_abc";
const TARGET = {
  endpoint: "https://x.convex.site/api/macros/trigger",
  url: `https://x.convex.site/api/macros/trigger/${TOKEN}`,
  token: TOKEN,
};

describe("macroTriggerExamples", () => {
  test("a macro without variables gets a bare POST with the token in a header", () => {
    const curl = macroTriggerExamples(TARGET, [], false).find((example) => example.id === "curl");
    expect(curl?.text).toBe(`curl -X POST '${TARGET.endpoint}' -H 'Authorization: Bearer ${TOKEN}'`);
  });

  test("variables become a JSON body", () => {
    const curl = macroTriggerExamples(TARGET, ["channel"], false).find((example) => example.id === "curl");
    expect(curl?.text).toBe(
      `curl -X POST '${TARGET.endpoint}' -H 'Authorization: Bearer ${TOKEN}' -H 'Content-Type: application/json' -d '{"channel":"<channel>"}'`
    );
  });

  test("devices that can set headers never get the token in the URL", () => {
    for (const example of macroTriggerExamples(TARGET, ["a"], false)) {
      expect(example.text).not.toContain(TARGET.url);
      expect(example.text).toContain(TOKEN);
    }
  });

  test("the GET-only Website action appears only when GET is allowed, with the token in the path", () => {
    expect(macroTriggerExamples(TARGET, [], false).map((example) => example.id)).not.toContain("stream-deck-website");
    const website = macroTriggerExamples(TARGET, ["channel"], true).find(
      (example) => example.id === "stream-deck-website"
    );
    expect(website?.text).toContain(`${TARGET.url}?channel=<channel>`);
  });
});

describe("macroTriggerStatusLabel", () => {
  test("says never used for a fresh trigger", () => {
    expect(macroTriggerStatusLabel({ useCount: 0, needsConfirmation: false })).toBe("Enabled · never used");
  });

  test("names the last use and the count", () => {
    const label = macroTriggerStatusLabel({
      lastUsedAt: Date.now() - 5 * 60_000,
      useCount: 1,
      needsConfirmation: false,
    });
    expect(label).toBe("Enabled · last used 5 minutes ago · 1 use");
  });

  test("mentions a failure newer than the last success", () => {
    const label = macroTriggerStatusLabel({
      lastUsedAt: Date.now() - 10 * 60_000,
      lastFailedAt: Date.now() - 5 * 60_000,
      useCount: 2,
      needsConfirmation: false,
    });
    expect(label).toContain("last press failed 5 minutes ago");
  });

  test("says paused when it needs re-confirming", () => {
    expect(macroTriggerStatusLabel({ useCount: 3, needsConfirmation: true })).toBe(
      "Paused · an owner or admin must re-confirm it"
    );
  });
});
