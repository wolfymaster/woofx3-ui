import { describe, expect, test } from "bun:test";
import type { ActionStep } from "@woofx3/api";
import { argumentNames, commandActionVariables, commandStepVariables } from "@/lib/command-variables";
import type { ActionPreset } from "@/lib/workflow-presets";

describe("argumentNames", () => {
  test("reads each placeholder once, in order", () => {
    expect(argumentNames("{userA} {userB} {userA}")).toEqual(["userA", "userB"]);
  });

  test("a pattern with no placeholders declares no arguments", () => {
    expect(argumentNames("")).toEqual([]);
    expect(argumentNames("plain words")).toEqual([]);
  });
});

describe("commandActionVariables", () => {
  test("offers the invoking message, whatever the command captures", () => {
    const values = commandActionVariables("").map((option) => option.value);
    expect(values).toEqual([
      "${trigger.data.chatter}",
      "${trigger.data.text}",
      "${trigger.data.command}",
      "${trigger.data.rawMessage}",
    ]);
  });

  test("adds each declared argument under variables", () => {
    const options = commandActionVariables("{songTitle}");
    const argument = options.find((option) => option.label === "songTitle");
    expect(argument?.value).toBe("${trigger.data.variables.songTitle}");
  });
});

describe("commandStepVariables", () => {
  const counter = {
    id: "a1",
    name: "Increment Counter",
    config: { fields: [], outputs: [{ path: "next", type: "number" }] },
  } as unknown as ActionPreset;
  const step = (id: string | undefined, dependsOn?: string[]): ActionStep => ({
    id,
    action: "function",
    function: "counter.increment",
    dependsOn,
  });
  const stepValues = (steps: ActionStep[], index: number) =>
    commandStepVariables("", steps, index, () => counter)
      .map((option) => option.value)
      .filter((value) => !value.startsWith("${trigger."));

  test("offers the outputs of every step before this one", () => {
    expect(stepValues([step("first"), step("second"), step("third")], 2)).toEqual(["${first.next}", "${second.next}"]);
  });

  test("the first step sees only what the command captured", () => {
    const options = commandStepVariables("{song}", [step("first")], 0, () => counter);
    expect(options.map((option) => option.value)).toEqual(commandActionVariables("{song}").map((o) => o.value));
  });

  test("a step with no id is referenced as the engine names it", () => {
    expect(stepValues([step(undefined), step(undefined)], 1)).toEqual(["${action-1.next}"]);
  });

  test("an empty dependsOn still waits for the step before, as the engine runs it", () => {
    const steps = [step("first"), step("second"), step("third", [])];
    expect(stepValues(steps, 2)).toEqual(["${first.next}", "${second.next}"]);
  });

  test("follows declared dependencies rather than position", () => {
    const steps = [step("first"), step("second", ["ghost"]), step("third", ["second"])];
    expect(stepValues(steps, 2)).toEqual(["${second.next}"]);
  });

  test("a step whose action declares no outputs offers none", () => {
    const options = commandStepVariables("", [step("first"), step("second")], 1, () => undefined);
    expect(options.map((option) => option.value)).toEqual(commandActionVariables("").map((o) => o.value));
  });
});
