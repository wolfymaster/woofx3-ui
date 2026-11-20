import { describe, expect, test } from "bun:test";
import type { ConfigField } from "@woofx3/api/ui-schema";
import { commitTrigger, type TriggerCommitDeps, type TriggerCommitOutcome } from "@/lib/trigger-commit";
import { type ActionNode, treeToDefinition, type WorkflowTree } from "@/lib/workflow-tree";

const action: ActionNode = { type: "action", id: "show", function: "alert", action: "function", parameters: {} };
const tree: WorkflowTree = {
  trigger: { type: "trigger", id: "trigger", event: "twitch:cheer", conditions: [] },
  steps: [action],
};

function deps(overrides: Partial<TriggerCommitDeps> = {}): TriggerCommitDeps {
  return {
    incompleteConditionFields: () => [],
    treeToDefinition,
    create: async () => ({ engineWorkflowId: "wf-new" }),
    update: async () => ({ conflict: false, engineWorkflowId: "wf-1", revision: 7 }),
    setEnabled: async () => ({ isEnabled: true }),
    ...overrides,
  };
}

function commit(overrides: Partial<Parameters<typeof commitTrigger>[0]> = {}): Promise<TriggerCommitOutcome> {
  return commitTrigger({
    tree,
    saved: undefined,
    conditionFields: [],
    customName: undefined,
    revision: undefined,
    fallbackName: "Cheer alert",
    deps: deps(),
    ...overrides,
  });
}

describe("commitTrigger", () => {
  test("an unfinished field is reported without saving", async () => {
    const outcome = await commit({
      deps: deps({ incompleteConditionFields: () => [{ id: "amount", label: "Minimum bits" } as ConfigField] }),
    });
    expect(outcome).toEqual({ kind: "incomplete", fields: ["minimum bits"] });
  });

  test("a trigger with no steps waits for one instead of asking the engine to store it", async () => {
    const create = async () => ({ engineWorkflowId: "wf-new" });
    const outcome = await commit({ tree: { ...tree, steps: [] }, deps: deps({ create }) });
    expect(outcome).toEqual({ kind: "needs-step" });
  });

  test("a new trigger comes back with the stored record and is switched on", async () => {
    const enabled: string[] = [];
    const outcome = await commit({
      deps: deps({ setEnabled: async (id) => void enabled.push(id) }),
    });
    expect(enabled).toEqual(["wf-new"]);
    expect(outcome).toMatchObject({
      kind: "saved",
      created: { engineWorkflowId: "wf-new", definition: { name: "Cheer alert" } },
      enableFailed: false,
    });
  });

  test("a trigger can be stored but fail to switch on", async () => {
    const outcome = await commit({
      deps: deps({ setEnabled: async () => Promise.reject(new Error("offline")) }),
    });
    expect(outcome).toMatchObject({ kind: "saved", enableFailed: true });
  });

  test("an update keeps the saved id and custom name and reports the new revision", async () => {
    let written: unknown;
    let expectedRevision: number | undefined;
    const update = async (_id: string, definition: unknown, revision: number | undefined) => {
      written = definition;
      expectedRevision = revision;
      return { conflict: false as const, revision: 9 };
    };
    const outcome = await commit({
      saved: { engineWorkflowId: "wf-1", definition: { ...treeToDefinition(tree), id: "wf-1" }, revision: 3 },
      customName: "Renamed",
      revision: 3,
      deps: deps({ update }),
    });
    expect(written).toMatchObject({ id: "wf-1", name: "Renamed" });
    expect(expectedRevision).toBe(3);
    expect(outcome).toEqual({ kind: "saved", revision: 9 });
  });

  test("a conflict returns the stored tree so the caller can replace its own", async () => {
    const stored = treeToDefinition(tree);
    const outcome = await commit({
      saved: { engineWorkflowId: "wf-1", definition: stored, revision: 3 },
      deps: deps({ update: async () => ({ conflict: true, definition: stored, revision: 9 }) }),
    });
    expect(outcome.kind).toBe("conflict");
    if (outcome.kind === "conflict") {
      expect(outcome.revision).toBe(9);
      expect(outcome.tree?.steps[0].id).toBe("show");
    }
  });

  test("an uneditable stored definition still reports the conflict with no tree", async () => {
    const outcome = await commit({
      saved: { engineWorkflowId: "wf-1", definition: treeToDefinition(tree), revision: 3 },
      deps: deps({ update: async () => ({ conflict: true, definition: { trigger: {} }, revision: 9 }) }),
    });
    expect(outcome).toEqual({ kind: "conflict", tree: null, revision: 9 });
  });

  test("a failed engine call comes back as an error for the caller to show", async () => {
    const outcome = await commit({
      deps: deps({ create: async () => Promise.reject(new Error("engine offline")) }),
    });
    expect(outcome).toEqual({ kind: "failed", error: "engine offline" });
  });
});
