import { describe, expect, test } from "bun:test";
import { variableNames } from "./variable-display";
import { flattenVariableMenu, insertVariableReference, variableMenuGroups } from "./variable-menu";
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
