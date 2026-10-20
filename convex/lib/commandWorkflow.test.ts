import { describe, expect, test } from "bun:test";
import { isCommandWorkflow } from "./commandWorkflow";

describe("isCommandWorkflow", () => {
  test("a workflow with a command trigger belongs to its command", () => {
    expect(isCommandWorkflow({ trigger: { type: "command", event: "chat.command.hug" }, tasks: [] })).toBe(true);
  });

  test("any other workflow, including one listening for the command, does not", () => {
    expect(isCommandWorkflow({ trigger: { type: "event", event: "chat.command.hug" } })).toBe(false);
    expect(isCommandWorkflow({ trigger: { type: "schedule", schedule: "* * * * *" } })).toBe(false);
    expect(isCommandWorkflow({})).toBe(false);
    expect(isCommandWorkflow(null)).toBe(false);
  });
});
