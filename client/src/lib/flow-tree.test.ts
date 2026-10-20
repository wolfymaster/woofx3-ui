import { describe, expect, test } from "bun:test";
import {
  descendantIds,
  findStepPlace,
  insertAtPoint,
  insertPointKey,
  moveStepInTree,
  sameInsertPoint,
  stepForPick,
  stepNumbers,
} from "@/lib/flow-tree";
import { DEFAULT_DELAY_MS } from "@/lib/wait-config";
import type { ActionPreset } from "@/lib/workflow-presets";
import type { ConditionNode, StepNode } from "@/lib/workflow-tree";

function action(id: string): StepNode {
  return { type: "action", id, action: "function", parameters: {} };
}

function condition(id: string, thenBranch: StepNode[], elseBranch: StepNode[] = []): ConditionNode {
  return { type: "condition", id, conditions: [], thenBranch, elseBranch };
}

function ids(steps: StepNode[]): string[] {
  return steps.map((step) => step.id);
}

function branch(steps: StepNode[], id: string, side: "thenBranch" | "elseBranch"): StepNode[] {
  const step = steps.find((candidate) => candidate.id === id);
  if (!step || step.type !== "condition") {
    throw new Error(`no condition ${id}`);
  }
  return step[side];
}

const icon = (() => null) as unknown as ActionPreset["icon"];

const sendMessage: ActionPreset = {
  id: "row-1",
  canonicalRef: "woofx3:action:chat.reply",
  name: "Send a chat message",
  description: "",
  icon,
  category: "Chat",
  color: "#888",
  source: "Chat",
  handlerType: "function",
  functionCall: "woofx3:function:chat.reply",
};

describe("insertAtPoint", () => {
  const steps = [action("a"), condition("c", [action("t1")], [action("e1")]), action("b")];

  test("before the first step, between steps and at the end of the top list", () => {
    expect(ids(insertAtPoint(steps, { path: null, index: 0 }, action("new")))).toEqual(["new", "a", "c", "b"]);
    expect(ids(insertAtPoint(steps, { path: null, index: 2 }, action("new")))).toEqual(["a", "c", "new", "b"]);
    expect(ids(insertAtPoint(steps, { path: null, index: 3 }, action("new")))).toEqual(["a", "c", "b", "new"]);
  });

  test("into either branch of a condition", () => {
    const intoThen = insertAtPoint(steps, { path: { parentId: "c", branch: "thenBranch" }, index: 1 }, action("new"));
    expect(ids(branch(intoThen, "c", "thenBranch"))).toEqual(["t1", "new"]);
    expect(ids(branch(intoThen, "c", "elseBranch"))).toEqual(["e1"]);

    const intoElse = insertAtPoint(steps, { path: { parentId: "c", branch: "elseBranch" }, index: 0 }, action("new"));
    expect(ids(branch(intoElse, "c", "elseBranch"))).toEqual(["new", "e1"]);
  });

  test("into a branch of a nested condition", () => {
    const nested = [condition("outer", [condition("inner", [])])];
    const next = insertAtPoint(nested, { path: { parentId: "inner", branch: "elseBranch" }, index: 0 }, action("new"));
    const inner = branch(next, "outer", "thenBranch");
    expect(ids(branch(inner, "inner", "elseBranch"))).toEqual(["new"]);
  });

  test("names each point once", () => {
    expect(insertPointKey({ path: null, index: 1 })).not.toBe(
      insertPointKey({ path: { parentId: "c", branch: "thenBranch" }, index: 1 })
    );
    expect(
      sameInsertPoint(
        { path: { parentId: "c", branch: "elseBranch" }, index: 0 },
        { path: { parentId: "c", branch: "elseBranch" }, index: 0 }
      )
    ).toBe(true);
  });
});

describe("moveStepInTree", () => {
  const steps = [action("a"), condition("c", [action("t1"), action("t2")], [action("e1")]), action("b")];

  test("swaps a step with its neighbour in the top list", () => {
    expect(ids(moveStepInTree(steps, "b", -1))).toEqual(["a", "b", "c"]);
    expect(ids(moveStepInTree(steps, "a", 1))).toEqual(["c", "a", "b"]);
  });

  test("moves inside a branch without leaving it", () => {
    const next = moveStepInTree(steps, "t2", -1);
    expect(ids(branch(next, "c", "thenBranch"))).toEqual(["t2", "t1"]);
    expect(ids(next)).toEqual(["a", "c", "b"]);
  });

  test("leaves the tree as it is at either end of a list", () => {
    expect(moveStepInTree(steps, "a", -1)).toBe(steps);
    expect(moveStepInTree(steps, "b", 1)).toBe(steps);
    expect(moveStepInTree(steps, "e1", 1)).toBe(steps);
    expect(moveStepInTree(steps, "missing", 1)).toBe(steps);
  });

  test("a condition moves with its branches", () => {
    const next = moveStepInTree(steps, "c", -1);
    expect(ids(next)).toEqual(["c", "a", "b"]);
    expect(ids(branch(next, "c", "thenBranch"))).toEqual(["t1", "t2"]);
  });
});

describe("findStepPlace", () => {
  test("gives the list, index and list length", () => {
    const steps = [action("a"), condition("c", [action("t1"), action("t2")])];
    expect(findStepPlace(steps, "a")).toEqual({ path: null, index: 0, count: 2 });
    expect(findStepPlace(steps, "t2")).toEqual({ path: { parentId: "c", branch: "thenBranch" }, index: 1, count: 2 });
    expect(findStepPlace(steps, "missing")).toBeNull();
  });
});

describe("stepNumbers", () => {
  test("numbers the top list, then each branch under its condition's number", () => {
    const steps = [
      action("a"),
      condition("c", [action("t1"), condition("inner", [action("deep")])], [action("e1")]),
      action("b"),
    ];
    const numbers = stepNumbers(steps);
    expect(Object.fromEntries(numbers)).toEqual({
      a: "1",
      c: "2",
      t1: "2.1",
      inner: "2.2",
      deep: "2.2.1",
      e1: "2.3",
      b: "3",
    });
  });

  test("an empty Then branch leaves Otherwise starting at .1", () => {
    const numbers = stepNumbers([condition("c", [], [action("e1")])]);
    expect(numbers.get("e1")).toBe("1.1");
  });
});

describe("descendantIds", () => {
  test("lists every step inside a condition at any depth", () => {
    const step = condition("c", [condition("inner", [action("deep")])], [action("e1")]);
    expect(descendantIds(step)).toEqual(["inner", "deep", "e1"]);
    expect(descendantIds(action("a"))).toEqual([]);
  });
});

describe("stepForPick", () => {
  const existing = [action("pause"), action("send-a-chat-message")];

  test("an action keeps the picked parameters and gets an unused id", () => {
    const step = stepForPick({ kind: "action", preset: sendMessage, parameters: { message: "hi" } }, existing);
    expect(step).toEqual({
      type: "action",
      id: "send-a-chat-message-2",
      action: "function",
      function: "woofx3:function:chat.reply",
      ref: "woofx3:action:chat.reply",
      parameters: { message: "hi" },
    });
  });

  test("pause is a delay wait with the default duration", () => {
    const step = stepForPick({ kind: "pause" }, existing);
    expect(step).toEqual({ type: "wait", id: "pause-2", wait: { type: "delay", durationMs: DEFAULT_DELAY_MS } });
  });

  test("wait is an event wait with no event yet", () => {
    expect(stepForPick({ kind: "wait" }, [])).toEqual({ type: "wait", id: "wait", wait: { type: "event", event: "" } });
  });

  test("condition is empty with two empty branches", () => {
    expect(stepForPick({ kind: "condition" }, [])).toEqual({
      type: "condition",
      id: "condition",
      conditions: [],
      thenBranch: [],
      elseBranch: [],
    });
  });

  test("ids are unique across branches too", () => {
    const step = stepForPick({ kind: "wait" }, [condition("c", [action("wait")])]);
    expect(step.id).toBe("wait-2");
  });
});
