import { describe, expect, test } from "bun:test";
import { argumentNames, commandActionVariables } from "@/lib/command-variables";

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
