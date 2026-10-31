import { describe, expect, test } from "bun:test";
import { variableNames } from "./variable-display";
import {
  findTypedReference,
  flattenVariableMenu,
  functionMenuGroup,
  insertMenuItem,
  insertVariableReference,
  type VariableMenuItem,
  variableMenuGroups,
} from "./variable-menu";
import type { VariableOption } from "./workflow-variables";

const OPTIONS: VariableOption[] = [
  { value: "${trigger.data.userName}", label: "userName", group: "Trigger", description: "Who followed." },
  { value: "${trigger.data.userId}", label: "userId", group: "Trigger", type: "string" },
  { value: "${trigger.data.amount}", label: "amount", group: "Trigger", description: "How many users gifted." },
  { value: "${increment.next}", label: "next", group: "Increment Counter" },
];

function menu(query: string) {
  return variableMenuGroups(OPTIONS, variableNames(OPTIONS), query).map((group) => ({
    group: group.group,
    names: group.items.map((item) => item.name),
  }));
}

describe("variableMenuGroups", () => {
  test("an empty query lists every variable in workflow order", () => {
    expect(menu("")).toEqual([
      { group: "Trigger", names: ["userName", "userId", "amount"] },
      { group: "Increment Counter", names: ["next"] },
    ]);
  });

  test("ranks a name that starts with the query above one that only contains it", () => {
    const options: VariableOption[] = [
      { value: "${trigger.data.gifterName}", label: "gifterName", group: "Trigger" },
      { value: "${trigger.data.name}", label: "name", group: "Trigger" },
    ];
    const names = variableMenuGroups(options, variableNames(options), "name")[0].items.map((item) => item.name);
    expect(names).toEqual(["name", "gifterName"]);
  });

  test("does not match descriptions or types", () => {
    expect(menu("users")).toEqual([]);
    expect(menu("string")).toEqual([]);
  });

  test("a query naming a group lists that group's variables", () => {
    expect(menu("counter")).toEqual([{ group: "Increment Counter", names: ["next"] }]);
  });

  test("moves the group holding the best match to the top", () => {
    expect(menu("n")).toEqual([
      { group: "Increment Counter", names: ["next"] },
      { group: "Trigger", names: ["userName", "amount"] },
    ]);
  });
});

describe("flattenVariableMenu", () => {
  test("walks groups in the order they are shown", () => {
    const groups = variableMenuGroups(OPTIONS, variableNames(OPTIONS), "n");
    expect(flattenVariableMenu(groups).map((item) => item.name)).toEqual(["next", "userName", "amount"]);
  });
});

describe("insertVariableReference", () => {
  test("replaces the range and puts the cursor after the reference", () => {
    expect(insertVariableReference("Hi {us!", 3, 6, "userName")).toEqual({ text: "Hi {userName}!", cursor: 13 });
  });

  test("inserts at a collapsed cursor", () => {
    expect(insertVariableReference("Hi !", 3, 3, "userName")).toEqual({ text: "Hi {userName}!", cursor: 13 });
  });

  test("rejects a range outside the text", () => {
    expect(() => insertVariableReference("Hi", 1, 5, "userName")).toThrow();
  });
});

describe("typing a function call", () => {
  const typed = (text: string, functions = true) => findTypedReference(text, text.length, functions);

  test("a brace among a call's arguments starts an argument", () => {
    expect(typed("{round(divide({am")).toEqual({ start: 14, end: 17, query: "am", argument: true });
    expect(typed("{a} {am")?.argument).toBe(false);
    expect(typed("{round(divide({am", false)?.argument).toBe(false);
  });

  test("a plain reference searches everything since the brace", () => {
    expect(typed("Hi {rou")).toEqual({ start: 3, end: 7, query: "rou", argument: false });
    expect(typed("Hi ${rou")).toEqual({ start: 3, end: 8, query: "rou", argument: false });
  });

  test("inside parentheses it searches the word at the cursor", () => {
    expect(typed("{round(am")).toEqual({ start: 7, end: 9, query: "am", argument: true });
    expect(typed("{add(amount, ")).toEqual({ start: 13, end: 13, query: "", argument: true });
    expect(typed("{round(divide(bi")).toEqual({ start: 14, end: 16, query: "bi", argument: true });
    expect(typed("{add(amount || ")).toEqual({ start: 15, end: 15, query: "", argument: true });
  });

  test("nothing to suggest past the close or inside quotes", () => {
    expect(typed("{round(a)")).toBeNull();
    expect(typed("{round(a) ")).toBeNull();
    expect(typed("{uppercase('wo")).toBeNull();
    expect(typed("{round(a)}")).toBeNull();
  });

  test("without functions, parentheses are just more of the search", () => {
    expect(typed("{round(am", false)).toEqual({ start: 0, end: 9, query: "round(am", argument: false });
  });

  const variable: VariableMenuItem = {
    name: "amount",
    option: { value: "${trigger.data.amount}", label: "Amount", group: "Trigger" },
  };
  const round = functionMenuGroup("round")[0]?.items[0] as VariableMenuItem;

  test("offers matching functions", () => {
    expect(round.name).toBe("round");
    expect(functionMenuGroup("zzz")).toEqual([]);
    expect(functionMenuGroup("").flatMap((group) => group.items)).toHaveLength(10);
  });

  const inserts = [
    { name: "a function", text: "{ro", start: 0, end: 3, argument: false, item: round, want: "{round()}", cursor: 7 },
    {
      name: "an argument",
      text: "{round(am)}",
      start: 7,
      end: 9,
      argument: true,
      item: variable,
      want: "{round(amount)}",
      cursor: 13,
    },
    {
      name: "a nested function",
      text: "{round(ro)}",
      start: 7,
      end: 9,
      argument: true,
      item: round,
      want: "{round(round())}",
      cursor: 13,
    },
    {
      name: "a plain variable",
      text: "{am",
      start: 0,
      end: 3,
      argument: false,
      item: variable,
      want: "{amount}",
      cursor: 8,
    },
  ];
  for (const { name, text, item, want, cursor, ...range } of inserts) {
    test(`inserts ${name}`, () => {
      expect(insertMenuItem(text, range, item)).toEqual({ text: want, cursor });
    });
  }
});
