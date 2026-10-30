import { describe, expect, it } from "bun:test";
import { buildTriggerOptions, dryRunWouldDo, MAX_TRIGGER_DATA_BYTES } from "./workflow-test-run";

describe("dryRunWouldDo", () => {
  it("reads the description a dry-run step recorded", () => {
    expect(dryRunWouldDo('{"dryRun":true,"wouldDo":"Send chat message \\"hi\\""}')).toBe('Send chat message "hi"');
  });

  it("is null for a step that really ran, or unreadable outputs", () => {
    expect(dryRunWouldDo(undefined)).toBeNull();
    expect(dryRunWouldDo('{"sent":true}')).toBeNull();
    expect(dryRunWouldDo('{"dryRun":false,"wouldDo":"x"}')).toBeNull();
    expect(dryRunWouldDo('{"dryRun":true,"wouldDo":""}')).toBeNull();
    expect(dryRunWouldDo("not json")).toBeNull();
  });
});

describe("buildTriggerOptions", () => {
  it("sends the sample with its platform and skip, and the dry run", () => {
    const built = buildTriggerOptions({
      triggerData: { viewers: 5 },
      platform: "twitch",
      skipConditions: true,
      dryRun: true,
    });
    expect(built).toEqual({
      ok: true,
      options: { triggerData: { viewers: 5 }, platform: "twitch", skipConditions: true, dryRun: true },
    });
  });

  it("drops platform and skipConditions without a sample, which the engine refuses alone", () => {
    expect(buildTriggerOptions({ platform: "twitch", skipConditions: true, dryRun: true })).toEqual({
      ok: true,
      options: { dryRun: true },
    });
    expect(buildTriggerOptions({})).toEqual({ ok: true, options: {} });
  });

  it("refuses a sample over the engine's limit", () => {
    const built = buildTriggerOptions({ triggerData: { text: "x".repeat(MAX_TRIGGER_DATA_BYTES) } });
    expect(built.ok).toBe(false);
  });
});
