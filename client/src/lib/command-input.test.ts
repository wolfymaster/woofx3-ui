import { describe, expect, test } from "bun:test";
import {
  addCommandInput,
  inputNameFromLabel,
  joinCommandInput,
  removeCommandInput,
  splitCommandInput,
  withCommandWord,
} from "@/lib/command-input";
import { argumentNames } from "@/lib/command-variables";

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

  test("drops line breaks so a wrapped command is stored as one line", () => {
    expect(splitCommandInput("sr {song\nTitle}\r\n")).toEqual({ command: "sr", argumentPattern: "{songTitle}" });
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

describe("command inputs round trip", () => {
  const cases: { name: string; stored: string; word: string; inputs: string[] }[] = [
    { name: "no inputs", stored: "lurk", word: "lurk", inputs: [] },
    { name: "one input", stored: "sr {songTitle}", word: "sr", inputs: ["songTitle"] },
    { name: "several inputs", stored: "give {user} {amount}", word: "give", inputs: ["user", "amount"] },
    {
      name: "literal text in the pattern",
      stored: "quote {index} of {user}",
      word: "quote",
      inputs: ["index", "user"],
    },
  ];
  for (const c of cases) {
    test(`${c.name}: loads and serialises back unchanged`, () => {
      const { command, argumentPattern } = splitCommandInput(c.stored);
      expect(command).toBe(c.word);
      expect(argumentNames(argumentPattern)).toEqual(c.inputs);
      expect(withCommandWord(c.stored, c.word)).toBe(c.stored);
    });
  }

  test("adding inputs one by one builds the stored command", () => {
    let stored = "sr";
    for (const label of ["song title", "Artist"]) {
      const result = addCommandInput(stored, label);
      expect(result.ok).toBe(true);
      stored = result.ok ? result.command : stored;
    }
    expect(stored).toBe("sr {songTitle} {artist}");
  });

  test("removing an input keeps the rest of the pattern", () => {
    expect(removeCommandInput("quote {index} of {user}", "index")).toBe("quote of {user}");
    expect(removeCommandInput("sr {songTitle}", "songTitle")).toBe("sr");
  });

  test("rejects names with nothing usable and duplicates", () => {
    expect(addCommandInput("sr", "  !? ")).toEqual({ ok: false, error: "Use letters or numbers, like song title." });
    expect(addCommandInput("sr {songTitle}", "Song title").ok).toBe(false);
  });

  test("an input name is normalised to letters, digits, underscore and dot", () => {
    expect(inputNameFromLabel("song-title!")).toBe("songTitle");
    expect(inputNameFromLabel("user_name")).toBe("user_name");
  });

  test("clearing the word keeps the inputs, and retyping restores the command", () => {
    const cleared = withCommandWord("sr {songTitle}", "");
    expect(splitCommandInput(cleared)).toEqual({ command: "", argumentPattern: "{songTitle}" });
    expect(withCommandWord(cleared, "sr")).toBe("sr {songTitle}");
  });

  test("spaces and a typed bang never reach the word", () => {
    expect(withCommandWord("sr {songTitle}", "!so lo")).toBe("solo {songTitle}");
  });
});
