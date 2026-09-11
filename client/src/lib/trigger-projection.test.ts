import { describe, expect, test } from "bun:test";
import type { Doc } from "@convex/_generated/dataModel";
import { escapeDollarKeys } from "@/lib/dollar-keys";
import {
  buildWorkflowDefinition,
  nextTaskId,
  type ProjectedTrigger,
  projectWorkflow,
  UNCONDITIONAL_TRIGGER_ID,
} from "@/lib/trigger-projection";

function row(definition: unknown, overrides: Partial<Doc<"workflows">> = {}): Doc<"workflows"> {
  return {
    engineWorkflowId: "wf-1",
    isEnabled: true,
    definition: escapeDollarKeys(definition),
    ...overrides,
  } as Doc<"workflows">;
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

describe("buildWorkflowDefinition", () => {
  const triggers: ProjectedTrigger[] = [
    {
      id: "rule_1",
      // biome-ignore lint/suspicious/noTemplateCurlyInString: canonical engine selector syntax
      conditions: [{ field: "${trigger.data.amount}", operator: "gte", value: 1000 }],
      actions: [
        {
          id: "act_1",
          handlerType: "function",
          functionCall: "builtin:media_alert",
          parameters: {},
          concurrentWithPrevious: false,
        },
        {
          id: "act_2",
          handlerType: "function",
          functionCall: "builtin:log",
          parameters: {},
          concurrentWithPrevious: true,
        },
        {
          id: "act_3",
          handlerType: "function",
          functionCall: "builtin:log",
          parameters: {},
          concurrentWithPrevious: false,
        },
      ],
    },
  ];

  test("lists every action in onTrue, because skipping is not transitive", () => {
    const definition = buildWorkflowDefinition({ event: "cheer.channel.twitch", name: "Cheer", triggers, shared: [] });
    const condition = definition.tasks.find((t) => t.id === "rule_1");
    expect(condition).toMatchObject({ type: "condition", onTrue: ["act_1", "act_2", "act_3"] });
  });

  test("stages actions: concurrent shares a dependency, sequential waits for the stage", () => {
    const definition = buildWorkflowDefinition({ event: "cheer.channel.twitch", name: "Cheer", triggers, shared: [] });
    const byId = new Map(definition.tasks.map((t) => [t.id, t as { dependsOn?: string[] }]));
    expect(byId.get("act_1")?.dependsOn).toEqual(["rule_1"]);
    expect(byId.get("act_2")?.dependsOn).toEqual(["rule_1"]);
    expect(byId.get("act_3")?.dependsOn).toEqual(["act_1", "act_2"]);
  });

  test("guards a shared action on its triggers' results rather than branch membership", () => {
    const definition = buildWorkflowDefinition({
      event: "cheer.channel.twitch",
      name: "Cheer",
      triggers: [
        { id: "rule_1", conditions: [{ field: "a", operator: "eq", value: 1 }], actions: [] },
        { id: "rule_2", conditions: [{ field: "b", operator: "eq", value: 2 }], actions: [] },
      ],
      shared: [
        {
          id: "shared_1",
          handlerType: "function",
          functionCall: "builtin:log",
          parameters: {},
          concurrentWithPrevious: false,
          triggerIds: ["rule_1", "rule_2"],
        },
      ],
    });

    const shared = definition.tasks.find((t) => t.id === "shared_1") as {
      conditions?: { field: string }[];
      conditionLogic?: string;
      dependsOn?: string[];
    };
    expect(shared.conditionLogic).toBe("or");
    // biome-ignore lint/suspicious/noTemplateCurlyInString: canonical engine selector syntax
    expect(shared.conditions?.map((c) => c.field)).toEqual(["${rule_1.result}", "${rule_2.result}"]);
    expect(shared.dependsOn).toEqual(["rule_1", "rule_2"]);
    // Never listed in a branch: a missed condition would skip it for the whole run.
    for (const task of definition.tasks) {
      expect((task as { onTrue?: string[] }).onTrue ?? []).not.toContain("shared_1");
    }
  });

  test("emits no condition task for an unconditional trigger", () => {
    const definition = buildWorkflowDefinition({
      event: "cheer.channel.twitch",
      name: "Cheer",
      triggers: [
        {
          id: UNCONDITIONAL_TRIGGER_ID,
          conditions: [],
          actions: [
            {
              id: "act_1",
              handlerType: "function",
              functionCall: "builtin:log",
              parameters: {},
              concurrentWithPrevious: false,
            },
          ],
        },
      ],
      shared: [],
    });

    expect(definition.tasks.every((t) => t.type === "action")).toBe(true);
    expect((definition.tasks[0] as { dependsOn?: string[] }).dependsOn).toBeUndefined();
  });

  test("round-trips through the engine's storage shape", () => {
    const definition = buildWorkflowDefinition({
      event: "cheer.channel.twitch",
      name: "Cheer",
      triggers,
      shared: [],
      engineWorkflowId: "wf-1",
    });

    const result = projectWorkflow(row(definition));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.projection.triggers[0].actions.map((a) => [a.id, a.concurrentWithPrevious])).toEqual([
      ["act_1", false],
      ["act_2", true],
      ["act_3", false],
    ]);
  });
});

describe("nextTaskId", () => {
  test("skips ids already taken", () => {
    expect(nextTaskId("rule", ["rule_1", "rule_2"])).toBe("rule_3");
    expect(nextTaskId("act", [])).toBe("act_1");
  });
});
