import { describe, expect, it } from "bun:test";
import { hasRecordedTriggerEvent } from "./runTriggerEvent";

describe("hasRecordedTriggerEvent", () => {
  it("is true for a stored event", () => {
    expect(hasRecordedTriggerEvent('{"type":"channel.raid"}')).toBe(true);
  });

  it("is false for nothing, an empty object, or null", () => {
    expect(hasRecordedTriggerEvent(undefined)).toBe(false);
    expect(hasRecordedTriggerEvent("  ")).toBe(false);
    expect(hasRecordedTriggerEvent(" {} ")).toBe(false);
    expect(hasRecordedTriggerEvent("null")).toBe(false);
  });
});
