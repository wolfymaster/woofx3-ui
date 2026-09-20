import { describe, expect, test } from "bun:test";
import { joinCommandInput, splitCommandInput } from "@/lib/command-input";

describe("splitCommandInput", () => {
  test("splits the command word from the argument pattern", () => {
    expect(splitCommandInput("sr {songTitle}")).toEqual({ command: "sr", argumentPattern: "{songTitle}" });
  });

  test("a command word alone captures nothing", () => {
    expect(splitCommandInput("lurk")).toEqual({ command: "lurk", argumentPattern: "" });
  });

  test("drops the leading bang and the padding around either half", () => {
    expect(splitCommandInput("  !so   {user}  ")).toEqual({ command: "so", argumentPattern: "{user}" });
  });

  test("keeps every word after the first as one pattern", () => {
    expect(splitCommandInput("quote {index} of {user}")).toEqual({
      command: "quote",
      argumentPattern: "{index} of {user}",
    });
  });
});

describe("joinCommandInput", () => {
  test("round-trips what splitCommandInput produced", () => {
    for (const raw of ["sr {songTitle}", "lurk", "quote {index} of {user}"]) {
      const { command, argumentPattern } = splitCommandInput(raw);
      expect(splitCommandInput(joinCommandInput(command, argumentPattern))).toEqual({ command, argumentPattern });
    }
  });

  test("a command with no pattern has no trailing space", () => {
    expect(joinCommandInput("lurk", "")).toBe("lurk");
  });
});
