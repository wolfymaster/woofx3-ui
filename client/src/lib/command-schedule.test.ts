import { describe, expect, test } from "bun:test";
import type { WorkflowDefinition } from "@woofx3/api";
import {
  bareCommandWord,
  onlyRunsCommand,
  runsCommand,
  type ScheduleChoice,
  scheduleChoiceProblem,
  withCommandWord,
} from "@/lib/command-schedule";

function definitionRunning(command: string): WorkflowDefinition {
  return {
    id: "wf",
    name: "wf",
    trigger: { type: "event", event: "schedule.fired" },
    tasks: [
      { id: "a", type: "action", action: "command.run", parameters: { command } },
      { id: "b", type: "action", action: "chat.reply", parameters: { message: "hi" } },
    ],
  } as WorkflowDefinition;
}

describe("runsCommand", () => {
  test.each([
    ["hug", "hug", true],
    ["!Hug", "hug", true],
    ["hug", "!HUG", true],
    ["hug", "wave", false],
  ])("a step running %p, asked about %p: %p", (stored, asked, expected) => {
    expect(runsCommand(definitionRunning(stored), asked)).toBe(expected);
  });

  test("a step of another action naming the command does not count", () => {
    const definition = definitionRunning("hug");
    definition.tasks[0] = { id: "a", type: "action", action: "chat.reply", parameters: { command: "hug" } };
    expect(runsCommand(definition, "hug")).toBe(false);
  });
});

describe("onlyRunsCommand", () => {
  test("is false when the workflow does more than run the command", () => {
    expect(onlyRunsCommand(definitionRunning("hug"), "hug")).toBe(false);
  });

  test("is true when running the command is the only step", () => {
    const definition = definitionRunning("hug");
    definition.tasks = definition.tasks.slice(0, 1);
    expect(onlyRunsCommand(definition, "hug")).toBe(true);
  });
});

describe("withCommandWord", () => {
  test("renames only the steps that run the old command", () => {
    const renamed = withCommandWord(definitionRunning("hug"), "!hug", "cuddle");
    expect(renamed.tasks[0]?.parameters?.command).toBe("cuddle");
    expect(renamed.tasks[1]?.parameters?.message).toBe("hi");
  });

  test("leaves a step running another command alone", () => {
    expect(withCommandWord(definitionRunning("wave"), "hug", "cuddle").tasks[0]?.parameters?.command).toBe("wave");
  });
});

describe("bareCommandWord", () => {
  test("drops the prefix and the case", () => {
    expect(bareCommandWord(" !Hug ")).toBe("hug");
  });
});

describe("scheduleChoiceProblem", () => {
  const fresh = (change: Partial<Extract<ScheduleChoice, { kind: "new" }>>): ScheduleChoice => ({
    kind: "new",
    name: "Hugs",
    minutes: 15,
    runWhileOffline: false,
    ...change,
  });

  test.each([
    [{ kind: "none" } as ScheduleChoice, null],
    [{ kind: "existing", canonicalId: "woofx3:schedule:x" } as ScheduleChoice, null],
    [fresh({}), null],
    [fresh({ name: "  " }), "Name the new schedule."],
    [fresh({ minutes: 0 }), "A schedule runs every 1 to 40,320 minutes."],
    [fresh({ minutes: 40321 }), "A schedule runs every 1 to 40,320 minutes."],
    [fresh({ minutes: 1.5 }), "A schedule runs every 1 to 40,320 minutes."],
  ])("%j -> %p", (choice, expected) => {
    expect(scheduleChoiceProblem(choice)).toBe(expected);
  });
});
