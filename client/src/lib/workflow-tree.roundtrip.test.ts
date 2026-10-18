// biome-ignore-all lint/suspicious/noTemplateCurlyInString: fixtures hold engine ${...} expressions as plain strings
import { describe, expect, test } from "bun:test";
import { compileWorkflow } from "@convex/lib/setupImport/compile";
import type { ImportStep, ImportWorkflowSpec } from "@convex/lib/setupImport/types";
import {
  buildStarterWorkflow,
  STARTER_PACKS,
  type StarterCatalog,
  type StarterWorkflowItem,
  starterPackDefaults,
} from "@convex/lib/starterPacks";
import type { TaskDefinition, WorkflowDefinition } from "@woofx3/api";
import { buildWorkflowDefinition, type ProjectedAction } from "./trigger-projection";
import {
  definitionToTree,
  type TreeLayout,
  type TreeShapeProblem,
  treeToDefinition,
  updateStepInTree,
  type WorkflowTree,
} from "./workflow-tree";

/**
 * The tree round trip is lossless: every definition the editor can open saves back as itself.
 * The one normalisation is the order of `tasks`, which `treeToDefinition` writes in reading
 * order (a step, then its then-branch, then its else-branch). The engine orders tasks by
 * `dependsOn` alone, so array order carries no meaning.
 */

function readTree(def: WorkflowDefinition): WorkflowTree {
  const result = definitionToTree(def);
  if (!result.editable) {
    throw new Error(result.message);
  }
  return result.tree;
}

function expectRoundTrip(def: WorkflowDefinition, layout?: TreeLayout): void {
  const tree = readTree(def);
  expect(treeToDefinition(tree)).toEqual(def);
  if (layout) {
    expect(tree.layout).toBe(layout);
  }
}

function expectNotATree(def: WorkflowDefinition, problem: TreeShapeProblem): void {
  const result = definitionToTree(def);
  expect(result.editable).toBe(false);
  if (!result.editable) {
    expect(result.problem).toEqual(problem);
    expect(result.message.length).toBeGreaterThan(0);
  }
}

function definition(tasks: unknown[], extra: Record<string, unknown> = {}): WorkflowDefinition {
  return {
    id: "wf-1",
    name: "Fixture",
    trigger: { type: "event", event: "channel.cheer", conditions: [] },
    tasks: tasks as TaskDefinition[],
    ...extra,
  } as WorkflowDefinition;
}

const say = (id: string, message: string, dependsOn?: string) => ({
  id,
  type: "action",
  action: "function",
  function: "twitch.chat.send",
  $ref: "twitch_platform:action:chat.send",
  parameters: { message },
  ...(dependsOn ? { dependsOn: [dependsOn] } : {}),
});

describe("every task field and type survives the round trip", () => {
  test("an action carrying every field the engine accepts, plus ones it doesn't know", () => {
    expectRoundTrip(
      definition([
        {
          id: "shout",
          type: "action",
          action: "function",
          function: "twitch.shoutout",
          $ref: "twitch_platform:action:shoutout",
          parameters: { user: "${trigger.data.user}", nested: { list: [1, "two", { three: true }] } },
          disabled: true,
          onError: "continue",
          timeout: "30s",
          exports: { who: "user" },
          condition: { field: "${trigger.data.amount}", operator: "gte", value: 100 },
          conditions: [{ field: "${trigger.data.user}", operator: "exists" }],
          conditionLogic: "or",
          notes: "kept by a newer editor",
          wait: { type: "event", event: "ignored-on-an-action" },
        },
      ])
    );
  });

  test("log and sub-workflow tasks", () => {
    expectRoundTrip(
      definition([
        { id: "log-1", type: "log", parameters: { message: "cheered ${trigger.data.amount}" }, disabled: false },
        {
          id: "run-1",
          type: "workflow",
          dependsOn: ["log-1"],
          workflow: {
            workflowId: "wf-thanks",
            waitUntilCompletion: true,
            event: "custom.thanks",
            eventData: { user: "${trigger.data.user}" },
            timeout: 5_000_000_000,
          },
          exports: { result: "result" },
          onError: "fail",
          timeout: "1m",
          conditions: [{ field: "${log-1.message}", operator: "contains", value: "cheered" }],
        },
      ])
    );
  });

  test("waits of every type", () => {
    expectRoundTrip(
      definition([
        {
          id: "w-event",
          type: "wait",
          wait: {
            type: "event",
            event: "channel.follow",
            conditions: [{ field: "${event.data.user}", operator: "eq", value: "${trigger.data.user}" }],
            timeout: "5m",
            onTimeout: "continue",
          },
        },
        {
          id: "w-count",
          type: "wait",
          dependsOn: ["w-event"],
          wait: {
            type: "aggregation",
            event: "channel.cheer",
            aggregation: { strategy: "count", threshold: 3, timeWindow: "10m" },
          },
        },
        {
          id: "w-sum",
          type: "wait",
          dependsOn: ["w-count"],
          wait: {
            type: "aggregation",
            event: "channel.cheer",
            aggregation: { strategy: "sum", field: "amount", threshold: 1000 },
            timeout: "1h",
            onTimeout: "fail",
          },
        },
        {
          id: "w-threshold",
          type: "wait",
          dependsOn: ["w-sum"],
          wait: { type: "aggregation", event: "channel.cheer", aggregation: { strategy: "threshold", threshold: 500 } },
        },
        { id: "w-delay", type: "wait", dependsOn: ["w-threshold"], wait: { type: "delay", durationMs: 2000 } },
      ])
    );
  });

  test("a condition with a single condition, a list, logic, and fields the editor doesn't model", () => {
    expectRoundTrip(
      definition([
        {
          id: "big",
          type: "condition",
          condition: { field: "${trigger.data.amount}", operator: "gte", value: 100 },
          conditions: [{ field: "${trigger.data.amount}", operator: "between", value: [100, 1000] }],
          conditionLogic: "or",
          disabled: true,
          exports: { matched: "result" },
          parameters: { unused: true },
          onTrue: ["thanks"],
          onFalse: [],
        },
        say("thanks", "Thank you!", "big"),
      ])
    );
  });

  test("an unknown task type is kept whole, including branch-like fields it carries", () => {
    expectRoundTrip(
      definition([
        say("first", "hi"),
        {
          id: "mystery",
          type: "teleport",
          dependsOn: ["first"],
          destination: { x: 1, y: 2 },
          onTrue: ["first"],
          parameters: null,
        },
        say("last", "bye", "mystery"),
      ])
    );
    const tree = readTree(definition([{ id: "mystery", type: "teleport", destination: "moon" }]));
    expect(tree.steps[0]).toEqual({
      type: "unknown",
      id: "mystery",
      taskType: "teleport",
      extra: { destination: "moon" },
      emptyAs: { dependsOn: "absent" },
    });
  });

  test("fields left out, null, or empty save back the way they were written", () => {
    expectRoundTrip(
      definition([
        { id: "a", type: "action", action: "noop", parameters: null, dependsOn: [] },
        { id: "b", type: "action", action: "", dependsOn: ["a"] },
        { id: "c", type: "condition", dependsOn: ["b"] },
        { id: "d", type: "condition", dependsOn: ["c"], conditions: null, onTrue: null, onFalse: [] },
        { id: "e", type: "wait", dependsOn: ["d"] },
      ])
    );
    expectRoundTrip({
      id: "wf-2",
      name: "No conditions",
      trigger: { type: "event", event: "channel.raid" },
      tasks: [say("a", "hi")] as TaskDefinition[],
    });
    expectRoundTrip({
      id: "wf-3",
      name: "Null conditions",
      trigger: { type: "event", event: "channel.raid", conditions: null },
      tasks: [say("a", "hi")],
    } as unknown as WorkflowDefinition);
  });

  test("schedule triggers and workflow-level fields", () => {
    expectRoundTrip({
      id: "wf-4",
      name: "Hourly",
      description: "Says hi every hour",
      options: { timeout: "10m", maxConcurrent: 2 },
      owner: "a field a newer engine adds",
      trigger: {
        type: "schedule",
        schedule: "0 * * * *",
        conditions: [{ field: "${trigger.data.live}", operator: "eq", value: true }],
        $ref: "core:trigger:schedule",
        timezone: "Europe/London",
      },
      tasks: [say("hi", "hello")],
    } as unknown as WorkflowDefinition);
  });
});

/** Outer condition with a nested condition in each branch, and a third level inside the first. */
function threeDeepNested(): WorkflowDefinition {
  return definition([
    say("start", "start"),
    { id: "c1", type: "condition", dependsOn: ["start"], conditions: [], onTrue: ["t1", "c2"], onFalse: ["c3"] },
    say("t1", "level 1 true", "c1"),
    { id: "c2", type: "condition", dependsOn: ["t1"], conditions: [], onTrue: ["c4"], onFalse: ["f2"] },
    {
      id: "c4",
      type: "condition",
      dependsOn: ["c2"],
      conditions: [],
      onTrue: ["t4", "w4"],
      onFalse: [],
    },
    say("t4", "level 3 true", "c4"),
    { id: "w4", type: "wait", dependsOn: ["t4"], wait: { type: "delay", durationMs: 500 } },
    say("f2", "level 2 false", "c2"),
    { id: "c3", type: "condition", dependsOn: ["c1"], conditions: [], onTrue: [], onFalse: ["f3"] },
    say("f3", "level 2 false of false", "c3"),
    say("end", "end", "c1"),
  ]);
}

describe("branch layouts", () => {
  test("nested: each list its own chain, branch heads on their condition (what the editor writes)", () => {
    const def = threeDeepNested();
    expectRoundTrip(def, "nested");
    const tree = readTree(def);
    expect(tree.steps.map((s) => s.id)).toEqual(["start", "c1", "end"]);
    const c1 = tree.steps[1];
    if (c1.type !== "condition") {
      throw new Error("expected condition");
    }
    expect(c1.thenBranch.map((s) => s.id)).toEqual(["t1", "c2"]);
    expect(c1.elseBranch.map((s) => s.id)).toEqual(["c3"]);
  });

  test("chained: one chain in reading order, conditions listing every task under them", () => {
    const def = definition([
      say("start", "start"),
      {
        id: "c1",
        type: "condition",
        dependsOn: ["start"],
        conditions: [],
        onTrue: ["t1", "c2", "c4", "t4", "f2"],
        onFalse: ["c3", "f3"],
      },
      say("t1", "level 1 true", "c1"),
      { id: "c2", type: "condition", dependsOn: ["t1"], conditions: [], onTrue: ["c4", "t4"], onFalse: ["f2"] },
      { id: "c4", type: "condition", dependsOn: ["c2"], conditions: [], onTrue: ["t4"], onFalse: [] },
      say("t4", "level 3 true", "c4"),
      say("f2", "level 2 false", "t4"),
      { id: "c3", type: "condition", dependsOn: ["f2"], conditions: [], onTrue: [], onFalse: ["f3"] },
      say("f3", "level 2 false of false", "c3"),
      say("end", "end", "f3"),
    ]);
    expectRoundTrip(def, "chained");
  });

  test("listed: branch steps without dependsOn, everything else on the task written before it", () => {
    const def = definition([
      say("start", "start"),
      { id: "c1", type: "condition", dependsOn: ["start"], conditions: [], onTrue: ["t1", "c2"], onFalse: ["f1"] },
      say("t1", "true"),
      { id: "c2", type: "condition", conditions: [], onTrue: ["t2"], onFalse: [] },
      say("t2", "nested true"),
      say("f1", "false"),
      say("end", "end", "f1"),
    ]);
    expectRoundTrip(def, "listed");
  });

  test("a straight chain reads as nested, the editor's own layout", () => {
    expectRoundTrip(definition([say("a", "1"), say("b", "2", "a"), say("c", "3", "b")]), "nested");
  });

  test("an edit keeps the layout the workflow was read in and touches only the edited task", () => {
    const def = threeDeepNested();
    const chained = compileWorkflow(importSpec(nestedImportSteps()), importCatalog, new Map()) as WorkflowDefinition;
    for (const source of [def, chained]) {
      const tree = readTree(source);
      const target = source.tasks.find((task) => task.type === "action" && task.id !== source.tasks[0].id);
      if (!target) {
        throw new Error("fixture has no action to edit");
      }
      const edited = treeToDefinition({
        ...tree,
        steps: updateStepInTree(tree.steps, target.id, (step) =>
          step.type === "action" ? { ...step, parameters: { message: "edited" } } : step
        ),
      });
      const expected = source.tasks.map((task) =>
        task.id === target.id ? { ...task, parameters: { message: "edited" } } : task
      );
      expect(edited.tasks).toEqual(expected);
    }
  });
});

describe("task order is the one normalisation", () => {
  test("tasks out of reading order read as the same tree and save in reading order", () => {
    const def = threeDeepNested();
    const shuffled = { ...def, tasks: [...def.tasks].reverse() };
    const tree = readTree(shuffled);
    expect(tree).toEqual(readTree(def));
    expect(treeToDefinition(tree)).toEqual(def);
  });
});

describe("definitions that aren't a tree are refused, not mangled", () => {
  test("a step waiting on two others", () => {
    expectNotATree(definition([say("a", "1"), say("b", "2"), { ...say("c", "3"), dependsOn: ["a", "b"] }]), {
      kind: "joined-step",
      taskId: "c",
    });
  });

  test("steps that run side by side", () => {
    expectNotATree(definition([say("a", "1"), say("b", "2")]), { kind: "unsequenced-step", taskId: "b" });
  });

  test("a step after a condition that depends on the end of one branch, in the nested layout", () => {
    expectNotATree(
      definition([
        { id: "c1", type: "condition", conditions: [], onTrue: ["a1"], onFalse: ["a2"] },
        say("a1", "yes", "c1"),
        say("a2", "no", "c1"),
        say("after", "after", "a1"),
      ]),
      { kind: "unsequenced-step", taskId: "after" }
    );
  });

  test("a step in two sibling conditions' branches", () => {
    expectNotATree(
      definition([
        { id: "c1", type: "condition", conditions: [], onTrue: ["shared"] },
        { id: "c2", type: "condition", dependsOn: ["c1"], conditions: [], onTrue: ["shared"] },
        say("shared", "both", "c2"),
      ]),
      { kind: "shared-branch-step", taskId: "shared" }
    );
  });

  test("a step on both sides of one condition", () => {
    expectNotATree(definition([{ id: "c1", type: "condition", onTrue: ["a"], onFalse: ["a"] }, say("a", "x", "c1")]), {
      kind: "shared-branch-step",
      taskId: "a",
    });
  });

  test("conditions inside each other's branches", () => {
    expectNotATree(
      definition([
        { id: "c1", type: "condition", onTrue: ["c2"] },
        { id: "c2", type: "condition", dependsOn: ["c1"], onTrue: ["c1"] },
      ]),
      { kind: "branch-cycle", taskId: "c2" }
    );
  });

  test("a dependency loop", () => {
    expectNotATree(definition([{ ...say("a", "1"), dependsOn: ["b"] }, say("b", "2", "a")]), {
      kind: "dependency-cycle",
      taskId: "a",
    });
  });

  test("duplicate ids, missing ids and references to steps that don't exist", () => {
    expectNotATree(definition([say("a", "1"), say("a", "2", "a")]), { kind: "duplicate-task-id", taskId: "a" });
    expectNotATree(definition([{ type: "action", action: "x" }]), { kind: "malformed", detail: "task 1 has no id" });
    expectNotATree(definition([say("a", "1", "ghost")]), {
      kind: "unknown-task-reference",
      taskId: "a",
      field: "dependsOn",
      reference: "ghost",
    });
    expectNotATree(definition([{ id: "c1", type: "condition", onFalse: ["ghost"] }]), {
      kind: "unknown-task-reference",
      taskId: "c1",
      field: "onFalse",
      reference: "ghost",
    });
  });
});

// ---------------------------------------------------------------------------
// Definitions the app itself writes
// ---------------------------------------------------------------------------

const importCatalog: StarterCatalog = {
  triggers: [{ event: "channel.raid", canonicalRef: "woofx3_twitch:trigger:channel_raid" }],
  actions: [{ canonicalRef: "woofx3:action:chat.reply", handlerType: "chat.reply" }],
};

const reply = (message: string): ImportStep => ({
  kind: "action",
  label: "Send chat message",
  ref: "woofx3:action:chat.reply",
  parameters: { message },
});

function importSpec(steps: ImportStep[], trigger?: ImportWorkflowSpec["trigger"]): ImportWorkflowSpec {
  return {
    name: "Raid",
    description: "",
    enabled: true,
    trigger: trigger ?? { kind: "event", event: "channel.raid", conditions: [], logic: "and" },
    steps,
  };
}

function nestedImportSteps(): ImportStep[] {
  const branch = (label: string, whenTrue: ImportStep[], whenFalse: ImportStep[]): ImportStep => ({
    kind: "branch",
    label,
    conditions: [{ field: "${trigger.data.viewers}", operator: "gt", value: 10 }],
    logic: "and",
    whenTrue,
    whenFalse,
  });
  return [
    reply("start"),
    branch(
      "Level 1",
      [
        reply("big"),
        branch(
          "Level 2",
          [branch("Level 3", [reply("huge"), { kind: "delay", label: "Pause", ms: 500 }], [])],
          [reply("medium")]
        ),
      ],
      [reply("small")]
    ),
    reply("after"),
  ];
}

describe("definitions the app writes round-trip", () => {
  test("setup import, with branches three deep", () => {
    const def = compileWorkflow(importSpec(nestedImportSteps()), importCatalog, new Map());
    expectRoundTrip(def as WorkflowDefinition, "chained");
  });

  test("setup import, with filters any of which may pass", () => {
    const def = compileWorkflow(
      importSpec([reply("hi")], {
        kind: "event",
        event: "channel.raid",
        conditions: [
          { field: "${trigger.data.viewers}", operator: "gt", value: 10 },
          { field: "${trigger.data.fromBroadcasterUserName}", operator: "eq", value: "friend" },
        ],
        logic: "or",
      }),
      importCatalog,
      new Map()
    );
    expectRoundTrip(def as WorkflowDefinition);
  });

  test("setup import, on a schedule", () => {
    const def = compileWorkflow(
      importSpec([reply("hourly")], { kind: "schedule", schedule: "0 * * * *" }),
      importCatalog,
      new Map()
    );
    expectRoundTrip(def as WorkflowDefinition);
  });

  const starterItems = STARTER_PACKS.flatMap((pack) =>
    pack.items.filter((item): item is StarterWorkflowItem => item.kind === "workflow").map((item) => ({ pack, item }))
  );

  const starterCatalog: StarterCatalog = {
    triggers: starterItems.map(({ item }) => ({
      event: item.trigger.event,
      canonicalRef: `fixture:trigger:${item.trigger.event}`,
    })),
    actions: [
      ...new Set(
        starterItems.flatMap(({ item }) => item.steps.flatMap((s) => (s.kind === "action" ? [s.action] : [])))
      ),
    ].map((ref) => ({ canonicalRef: ref, handlerType: "function", functionCall: ref.split(":").at(-1) })),
  };

  test("there are starter pack workflows to check", () => {
    expect(starterItems.length).toBeGreaterThan(0);
  });

  for (const { pack, item } of starterItems) {
    test(`starter pack ${pack.id} / ${item.id}`, () => {
      const def = buildStarterWorkflow(item, starterPackDefaults(pack), starterCatalog);
      expectRoundTrip({ id: `starter-${item.id}`, ...def } as WorkflowDefinition);
    });
  }

  const projected = (id: string, message: string, concurrentWithPrevious = false): ProjectedAction => ({
    id,
    handlerType: "function",
    functionCall: "twitch.chat.send",
    parameters: { message },
    concurrentWithPrevious,
  });

  test("an Alerts workflow with one trigger is a tree", () => {
    const def = buildWorkflowDefinition({
      event: "channel.cheer",
      name: "Cheers",
      engineWorkflowId: "wf-cheers",
      triggers: [
        {
          id: "rule_1",
          enabled: true,
          conditions: [{ field: "${trigger.data.amount}", operator: "gte", value: 100 }],
          actions: [projected("a1", "thanks"), projected("a2", "again")],
        },
      ],
      shared: [],
    });
    expectRoundTrip(def as WorkflowDefinition, "nested");
  });

  test("an Alerts workflow with two triggers, a shared action or concurrent actions is not", () => {
    const rule = (id: string, actions: ProjectedAction[]) => ({
      id,
      enabled: true,
      conditions: [{ field: "${trigger.data.amount}", operator: "gte" as const, value: 100 }],
      actions,
    });
    const twoTriggers = buildWorkflowDefinition({
      event: "channel.cheer",
      name: "Cheers",
      engineWorkflowId: "wf-cheers",
      triggers: [rule("rule_1", [projected("a1", "one")]), rule("rule_2", [projected("a2", "two")])],
      shared: [],
    });
    expect(definitionToTree(twoTriggers as WorkflowDefinition).editable).toBe(false);

    const shared = buildWorkflowDefinition({
      event: "channel.cheer",
      name: "Cheers",
      engineWorkflowId: "wf-cheers",
      triggers: [rule("rule_1", []), rule("rule_2", [])],
      shared: [{ ...projected("s1", "either"), triggerIds: ["rule_1", "rule_2"] }],
    });
    expectNotATree(shared as WorkflowDefinition, { kind: "joined-step", taskId: "s1" });

    const concurrent = buildWorkflowDefinition({
      event: "channel.cheer",
      name: "Cheers",
      engineWorkflowId: "wf-cheers",
      triggers: [rule("rule_1", [projected("a1", "one"), projected("a2", "two", true)])],
      shared: [],
    });
    expectNotATree(concurrent as WorkflowDefinition, { kind: "unsequenced-step", taskId: "a2" });
  });
});
