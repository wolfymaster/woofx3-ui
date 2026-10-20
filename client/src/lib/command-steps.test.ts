import { describe, expect, test } from "bun:test";
import type { TaskDefinition } from "@woofx3/api";
import { chainActions, commandFlow, commandSteps, commandTrigger } from "@/lib/command-steps";

const reply = (id: string, message: string): TaskDefinition => ({
  id,
  type: "action",
  action: "chat.reply",
  parameters: { message },
});

describe("commandTrigger", () => {
  test("names the command's own event", () => {
    expect(commandTrigger("Hug")).toEqual({ type: "command", event: "chat.command.hug" });
  });

  test("a word that can't be a subject yet still gives a trigger to edit against", () => {
    expect(commandTrigger("").type).toBe("command");
  });
});

describe("chainActions", () => {
  test("runs actions in order, keeping ids and dependencies they declare", () => {
    const tasks = chainActions([{ id: "a", action: "x" }, { action: "y" }, { id: "c", action: "z", dependsOn: ["a"] }]);
    expect(tasks.map((task) => [task.id, task.type, task.dependsOn])).toEqual([
      ["a", "action", undefined],
      ["action-2", "action", ["a"]],
      ["c", "action", ["a"]],
    ]);
  });
});

describe("commandFlow", () => {
  test("a command's stored steps save back unchanged", () => {
    const steps: TaskDefinition[] = [
      {
        id: "check",
        type: "condition",
        conditions: [{ field: "${trigger.data.chatter}", operator: "eq", value: "wolfy" }],
        onTrue: ["pause"],
      },
      { id: "pause", type: "wait", dependsOn: ["check"], wait: { type: "delay", durationMs: 2000 } },
      reply("after", "done"),
    ];
    steps[2].dependsOn = ["check"];
    const flow = commandFlow("hug", steps, []);
    if (!flow.editable) {
      throw new Error(flow.reason);
    }
    expect(flow.tree.steps.map((step) => step.type)).toEqual(["condition", "action"]);
    expect(commandSteps(flow.tree)).toEqual(steps);
  });

  test("a command not linked to a workflow opens its actions as steps in order", () => {
    const flow = commandFlow(
      "hug",
      [],
      [
        { id: "one", action: "chat.reply" },
        { id: "two", action: "chat.reply" },
      ]
    );
    if (!flow.editable) {
      throw new Error(flow.reason);
    }
    expect(flow.tree.steps.map((step) => step.id)).toEqual(["one", "two"]);
    expect(commandSteps(flow.tree).map((task) => [task.id, task.dependsOn])).toEqual([
      ["one", undefined],
      ["two", ["one"]],
    ]);
  });

  test("a command with no steps opens empty and saves none", () => {
    const flow = commandFlow("lurk", [], []);
    if (!flow.editable) {
      throw new Error(flow.reason);
    }
    expect(flow.tree.steps).toEqual([]);
    expect(commandSteps(flow.tree)).toEqual([]);
  });

  test("steps the tree can't hold are not editable, with the reason", () => {
    const flow = commandFlow("hug", [{ ...reply("a", "x"), dependsOn: ["missing"] }], []);
    expect(flow.editable).toBe(false);
  });
});
