import { describe, expect, test } from "bun:test";
import type { WorkflowRecord } from "@/engine/types";
import { escapeDollarKeys } from "@/lib/dollar-keys";
import { projectWorkflow, UNCONDITIONAL_TRIGGER_ID } from "@/lib/trigger-projection";

function row(definition: unknown, overrides: Partial<WorkflowRecord> = {}): WorkflowRecord {
  return {
    engineWorkflowId: "wf-1",
    isEnabled: true,
    definition: escapeDollarKeys(definition),
    ...overrides,
  };
}

function action(id: string, extra: Record<string, unknown> = {}) {
  return { id, type: "action", action: "function", function: "builtin:media_alert", parameters: {}, ...extra };
}

const cheer = { type: "event", event: "cheer.channel.twitch" };

describe("projectWorkflow", () => {
  test("reads each condition task as a configured trigger", () => {
    const result = projectWorkflow(
      row({
        name: "Cheer",
        trigger: cheer,
        tasks: [
          {
            id: "rule_1",
            type: "condition",
            // biome-ignore lint/suspicious/noTemplateCurlyInString: canonical engine selector syntax
            conditions: [{ field: "${trigger.data.amount}", operator: "gte", value: 1000 }],
            onTrue: ["act_1_1"],
          },
          action("act_1_1", { dependsOn: ["rule_1"] }),
        ],
      })
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.projection.event).toBe("cheer.channel.twitch");
    expect(result.projection.triggers).toHaveLength(1);
    expect(result.projection.triggers[0].conditions).toHaveLength(1);
    expect(result.projection.triggers[0].actions.map((a) => a.id)).toEqual(["act_1_1"]);
  });

  test("reads a plain single-step workflow as one unconditional trigger", () => {
    const result = projectWorkflow(row({ name: "Song request", trigger: cheer, tasks: [action("a")] }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.projection.triggers).toEqual([
      expect.objectContaining({ id: UNCONDITIONAL_TRIGGER_ID, conditions: [] }),
    ]);
  });

  test("marks actions sharing a dependency stage as concurrent", () => {
    const result = projectWorkflow(
      row({
        name: "Cheer",
        trigger: cheer,
        tasks: [
          { id: "rule_1", type: "condition", conditions: [], onTrue: ["a", "b", "c"] },
          action("a", { dependsOn: ["rule_1"] }),
          action("b", { dependsOn: ["rule_1"] }),
          action("c", { dependsOn: ["a", "b"] }),
        ],
      })
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.projection.triggers[0].actions.map((a) => a.concurrentWithPrevious)).toEqual([false, true, false]);
  });

  test("reads a guarded action as shared by the triggers its guard names", () => {
    const result = projectWorkflow(
      row({
        name: "Cheer",
        trigger: cheer,
        tasks: [
          { id: "rule_1", type: "condition", conditions: [], onTrue: [] },
          { id: "rule_2", type: "condition", conditions: [], onTrue: [] },
          action("shared_1", {
            dependsOn: ["rule_1", "rule_2"],
            conditions: [
              // biome-ignore lint/suspicious/noTemplateCurlyInString: canonical engine selector syntax
              { field: "${rule_1.result}", operator: "eq", value: true },
              // biome-ignore lint/suspicious/noTemplateCurlyInString: canonical engine selector syntax
              { field: "${rule_2.result}", operator: "eq", value: true },
            ],
            conditionLogic: "or",
          }),
        ],
      })
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.projection.shared).toHaveLength(1);
    expect(result.projection.shared[0].triggerIds).toEqual(["rule_1", "rule_2"]);
  });

  test.each([
    [
      "conditions on the trigger, which gate everything",
      { trigger: { ...cheer, conditions: [{ field: "x", operator: "eq", value: 1 }] }, tasks: [] },
    ],
    ["an else branch", { trigger: cheer, tasks: [{ id: "r", type: "condition", onTrue: [], onFalse: ["a"] }] }],
    ["a wait step", { trigger: cheer, tasks: [{ id: "w", type: "wait" }] }],
    ["a schedule trigger", { trigger: { type: "schedule", schedule: "0 * * * *" }, tasks: [] }],
    [
      "an action claimed by two conditions, which the engine would skip",
      {
        trigger: cheer,
        tasks: [
          { id: "r1", type: "condition", conditions: [], onTrue: ["a"] },
          { id: "r2", type: "condition", conditions: [], onTrue: ["a"] },
          action("a"),
        ],
      },
    ],
  ])("refuses %s", (_label, definition) => {
    const result = projectWorkflow(row({ name: "x", ...definition }));
    expect(result.ok).toBe(false);
  });
});
