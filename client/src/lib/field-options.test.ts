import { describe, expect, test } from "bun:test";
import { fieldOptionMismatch, groupFieldOptions, parseFieldOptionsReply } from "./field-options";

describe("parseFieldOptionsReply", () => {
  test("reads strings and { value, label, group } objects, dropping anything else", () => {
    expect(
      parseFieldOptionsReply([
        "Main",
        { value: "Mic/Aux", label: "Mic/Aux", group: "Audio inputs" },
        { value: "x", label: "X", group: "" },
        { value: 1, label: "one" },
        null,
      ])
    ).toEqual({
      options: [
        { value: "Main", label: "Main" },
        { value: "Mic/Aux", label: "Mic/Aux", group: "Audio inputs" },
        { value: "x", label: "X" },
      ],
      error: null,
    });
  });

  test("reads the reason from an { error } reply", () => {
    expect(parseFieldOptionsReply({ error: "OBS is not connected (retrying)" })).toEqual({
      options: [],
      error: "OBS is not connected (retrying)",
    });
  });

  test("treats any other reply as no options, without a reason", () => {
    expect(parseFieldOptionsReply({ items: [] })).toEqual({ options: [], error: null });
    expect(parseFieldOptionsReply({ error: "" })).toEqual({ options: [], error: null });
    expect(parseFieldOptionsReply(undefined)).toEqual({ options: [], error: null });
  });
});

describe("groupFieldOptions", () => {
  test("keeps the worker's order, headings in order of first appearance", () => {
    const groups = groupFieldOptions([
      { value: "Camera", label: "Camera", group: "Main" },
      { value: "Confetti", label: "Alerts › Confetti", group: "Raid" },
      { value: "Chat", label: "Chat", group: "Main" },
    ]);
    expect(groups.map((g) => [g.heading, g.options.map((o) => o.value)])).toEqual([
      ["Main", ["Camera", "Chat"]],
      ["Raid", ["Confetti"]],
    ]);
  });

  test("puts ungrouped options under no heading", () => {
    expect(groupFieldOptions([{ value: "Main", label: "Main" }])).toEqual([
      { heading: null, options: [{ value: "Main", label: "Main" }] },
    ]);
  });
});

describe("fieldOptionMismatch", () => {
  const options = [
    { value: "Main", label: "Main" },
    { value: "BRB", label: "BRB" },
  ];

  test("accepts a listed value, an empty one, and one built from a variable", () => {
    expect(fieldOptionMismatch("Main", options)).toBeNull();
    expect(fieldOptionMismatch("", options)).toBeNull();
    // biome-ignore lint/suspicious/noTemplateCurlyInString: a workflow expression, not a template literal
    expect(fieldOptionMismatch("${trigger.scene}", options)).toBeNull();
  });

  test("cannot judge a value when nothing was listed", () => {
    expect(fieldOptionMismatch("Main", [])).toBeNull();
  });

  test("names the listed value a case or whitespace slip was meant to be", () => {
    expect(fieldOptionMismatch("brb", options)).toContain('"BRB"');
    expect(fieldOptionMismatch("Main ", options)).toContain('"Main"');
  });

  test("flags a value that is not listed at all", () => {
    expect(fieldOptionMismatch("Raid", options)).toBe('"Raid" is not one of the listed options.');
  });
});
