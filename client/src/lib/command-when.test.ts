import { describe, expect, test } from "bun:test";
import { commandWhenOptions, commandWhenTitle } from "@/lib/command-when";

const base = {
  command: "sr {songTitle}",
  cooldown: 10,
  enabled: true,
  visibility: "public" as const,
  groupIds: [],
  usernames: [],
};
const noGroups = () => undefined;

describe("commandWhenTitle", () => {
  test("reads as what a chatter types", () => {
    expect(commandWhenTitle("sr {songTitle}")).toBe("A chatter types !sr {songTitle}");
    expect(commandWhenTitle("!lurk")).toBe("A chatter types !lurk");
  });

  test("a command with no word yet still reads as a sentence", () => {
    expect(commandWhenTitle("  ")).toBe("A chatter types a command");
  });
});

describe("commandWhenOptions", () => {
  test("says who can use it, the cooldown and what each argument captures", () => {
    expect(commandWhenOptions(base, noGroups)).toEqual([
      "Anyone can use it",
      "10 second cooldown",
      "{songTitle} is the rest of what they type",
    ]);
  });

  test("names the groups and people a restricted command is granted to", () => {
    const options = commandWhenOptions(
      {
        ...base,
        command: "hug {a} {b}",
        cooldown: 0,
        visibility: "restricted",
        groupIds: ["g1", "gone"],
        usernames: ["wolfy"],
      },
      (id) => (id === "g1" ? "Moderators" : undefined)
    );
    expect(options).toEqual([
      "Only Moderators and wolfy",
      "No cooldown",
      "{a} is the next word they type",
      "{b} is the rest of what they type",
    ]);
  });

  test("warns when a restricted command is granted to no one, and when it is off", () => {
    expect(commandWhenOptions({ ...base, enabled: false, visibility: "restricted" }, noGroups).slice(0, 2)).toEqual([
      "Turned off",
      "No one can use it yet",
    ]);
  });
});
