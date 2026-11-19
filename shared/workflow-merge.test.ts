// biome-ignore-all lint/suspicious/noTemplateCurlyInString: fixtures hold engine ${...} expressions as plain strings
import { describe, expect, test } from "bun:test";
import type { WorkflowDefinition } from "@woofx3/api";
import { appendSteps, findMergeTarget, isModuleWorkflowName, type MergeWorkflowFields } from "./workflow-merge";

function definition(id: string, trigger: Record<string, unknown>, tasks: unknown[] = []): WorkflowDefinition {
  return { id, name: id, trigger, tasks } as unknown as WorkflowDefinition;
}

function candidate(
  overrides: Partial<MergeWorkflowFields> & { id: string; trigger?: Record<string, unknown>; tasks?: unknown[] }
): MergeWorkflowFields & { id: string } {
  return {
    isEnabled: true,
    managed: false,
    ...overrides,
    definition: overrides.definition ?? definition(overrides.id, overrides.trigger ?? {}, overrides.tasks),
  };
}

describe("appendSteps", () => {
  test("puts the new chain after the old one", () => {
    const existing = [{ id: "a" }, { id: "b", dependsOn: ["a"] }];
    const added = [{ id: "c" }, { id: "d", dependsOn: ["c"] }];
    expect(appendSteps(existing, added)).toEqual([
      { id: "a" },
      { id: "b", dependsOn: ["a"] },
      { id: "c", dependsOn: ["b"] },
      { id: "d", dependsOn: ["c"] },
    ]);
  });

  test("renames taken ids and everything that points at them", () => {
    const existing = [{ id: "step_1" }];
    const added = [
      { id: "step_1", parameters: { message: "Hi ${step_1.result} and ${trigger.data.name}" } },
      { id: "step_2", dependsOn: ["step_1"], onTrue: ["branch_child"] },
      { id: "branch_child", parameters: { note: "${step_1.result}" } },
    ];
    expect(appendSteps(existing, added)).toEqual([
      { id: "step_1" },
      {
        id: "step_1_2",
        dependsOn: ["step_1"],
        parameters: { message: "Hi ${step_1_2.result} and ${trigger.data.name}" },
      },
      { id: "step_2", dependsOn: ["step_1_2"], onTrue: ["branch_child"] },
      { id: "branch_child", parameters: { note: "${step_1_2.result}" } },
    ]);
  });

  test("refuses lists that are not one chain or that export the same name", () => {
    expect(() => appendSteps([{ id: "a" }, { id: "b" }], [{ id: "c" }])).toThrow();
    expect(() => appendSteps([{ id: "a", exports: { total: "x" } }], [{ id: "c", exports: { total: "y" } }])).toThrow();
  });
});

describe("findMergeTarget", () => {
  const cheer = {
    type: "event",
    event: "channel.cheer",
    conditions: [{ field: "amount", operator: "gte", value: 100 }],
  };
  const other = { type: "event", event: "channel.cheer", conditions: [] };
  const step = { id: "a" };

  test("picks the matching, switched-on, streamer-owned workflow", () => {
    const match = candidate({ id: "match", trigger: cheer, tasks: [step] });
    expect(findMergeTarget([candidate({ id: "other", trigger: other, tasks: [step] }), match], cheer)?.id).toBe(
      "match"
    );
  });

  test("never picks a paused or module-owned workflow", () => {
    const paused = candidate({ id: "paused", trigger: cheer, tasks: [step], isEnabled: false });
    const module = candidate({ id: "module", trigger: cheer, tasks: [step], managed: true });
    expect(findMergeTarget([paused, module], cheer)).toBeUndefined();
  });

  test("skips a workflow whose steps are not one chain", () => {
    const split = candidate({ id: "split", trigger: cheer, tasks: [{ id: "a" }, { id: "b" }] });
    expect(findMergeTarget([split], cheer)).toBeUndefined();
  });

  test("an unmergeable trigger matches nothing", () => {
    const match = candidate({ id: "match", trigger: cheer, tasks: [step] });
    expect(findMergeTarget([match], { type: "schedule", schedule: "* * * * *" })).toBeUndefined();
  });

  test("a module workflow name is recognised from barkloader's convention", () => {
    expect(isModuleWorkflowName("twitch/follow alert")).toBe(true);
    expect(isModuleWorkflowName("Follow alert")).toBe(false);
  });
});
