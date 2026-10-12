import { describe, expect, test } from "bun:test";
import { importedWorkflowEnabled } from "./setupImportLedger";

describe("importedWorkflowEnabled", () => {
  test("keeps the enabled state the workflow had in the source setup", () => {
    expect(importedWorkflowEnabled({ name: "Follow thanks", enabled: true })).toBe(true);
    expect(importedWorkflowEnabled({ name: "Old raid alert", enabled: false })).toBe(false);
  });

  test("refuses a spec without an enabled state rather than guessing", () => {
    expect(() => importedWorkflowEnabled({ name: "Broken" })).toThrow();
    expect(() => importedWorkflowEnabled(null)).toThrow();
  });
});
