import { describe, expect, it } from "bun:test";
import { dryRunWouldDo } from "./engineTestRun";

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
