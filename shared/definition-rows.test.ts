import { describe, expect, test } from "bun:test";
import { actionDefinitionRow } from "./definition-rows";

describe("actionDefinitionRow", () => {
  const base = { id: "woofx3:action:alert", name: "Alert", description: "Plays an alert" };

  test("parses the parameters into fields and the returns into a data shape", () => {
    const row = actionDefinitionRow(
      {
        ...base,
        paramsSchema: JSON.stringify([{ id: "target", label: "Target", type: "text" }]),
        returns: JSON.stringify({ fields: [{ path: "played", type: "boolean" }] }),
      },
      "module-1"
    );
    expect(row).toMatchObject({
      slug: "woofx3:action:alert",
      name: "Alert",
      category: "General",
      color: "#888888",
      icon: "ArrowRight",
      moduleId: "module-1",
    });
    expect(row.configFields).toHaveLength(1);
    expect(row.returns).toEqual([expect.objectContaining({ path: "played" })]);
  });

  test.each([
    ["no handler type and no call", {}, undefined, undefined],
    ["a call and no handler type is a function action", { call: " fn.run " }, "function", "fn.run"],
    ["a handler type wins", { type: "builtin", call: "fn.run" }, "builtin", "fn.run"],
    ["a blank call is none", { call: "  " }, undefined, undefined],
  ] as const)("%s", (_case, fields, handlerType, functionCall) => {
    const row = actionDefinitionRow({ ...base, ...fields }, undefined);
    expect([row.handlerType, row.functionCall]).toEqual([handlerType, functionCall]);
  });

  test("a missing name falls back to the id, and empty schemas give no fields", () => {
    const row = actionDefinitionRow({ id: "x", paramsSchema: "[]", sentence: "  " }, undefined);
    expect([row.name, row.description, row.configFields, row.returns, row.sentence]).toEqual([
      "x",
      "",
      undefined,
      undefined,
      undefined,
    ]);
  });
});
