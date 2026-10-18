import { describe, expect, test } from "bun:test";
import type { ConfigField } from "@woofx3/api/ui-schema";
import { actionSentenceParts } from "@/lib/action-sentence";
import { sentenceText } from "@/lib/condition-sentence";

// Modelled on the bundled woofx3 module's actions (woofx3 modules/woofx3/manifest.json).
const target: ConfigField = {
  id: "target",
  label: "Counter",
  type: "resource_ref",
  resourceKind: "woofx3:counter",
  required: true,
};
const amount: ConfigField = { id: "amount", label: "Amount", type: "number", min: 1 };
const increment = { name: "Increment counter", sentence: "Add {amount} to {target}" };
const labels = new Map([["target", new Map([["woofx3:counter:deaths", "Deaths"]])]]);

function text(
  action: { name: string; sentence?: string },
  fields: ConfigField[],
  parameters: Record<string, unknown>
): string {
  return sentenceText(actionSentenceParts(action, fields, parameters, labels));
}

describe("actionSentenceParts with a declared sentence", () => {
  test("fills each placeholder with its value, a thing by its name", () => {
    expect(text(increment, [target, amount], { target: "woofx3:counter:deaths", amount: 5 })).toBe("Add 5 to Deaths");
  });

  test("says an empty optional setting falls back to the action's default", () => {
    const parts = actionSentenceParts(increment, [target, amount], { target: "woofx3:counter:deaths" }, labels);
    expect(sentenceText(parts)).toBe("Add the default amount to Deaths");
    expect(parts.find((part) => part.kind === "field" && part.fieldId === "amount")).toMatchObject({
      state: "default",
    });
  });

  test("words an empty optional setting the way its author declares", () => {
    const worded = { ...amount, missingText: "the counter's step" };
    const parts = actionSentenceParts(increment, [target, worded], { target: "woofx3:counter:deaths" }, labels);
    expect(sentenceText(parts)).toBe("Add the counter's step to Deaths");
    expect(parts.find((part) => part.kind === "field" && part.fieldId === "amount")).toMatchObject({
      state: "default",
    });
  });

  test("marks an empty required setting, in the author's words when given", () => {
    const parts = actionSentenceParts(increment, [target, amount], { amount: 2 }, labels);
    expect(sentenceText(parts)).toBe("Add 2 to a counter");
    expect(parts.at(-1)).toMatchObject({ kind: "field", state: "missing" });
    const worded = { ...target, missingText: "a counter you haven't picked" };
    expect(text(increment, [worded, amount], {})).toBe("Add the default amount to a counter you haven't picked");
  });

  test("names a value taken from earlier by its short name", () => {
    const parts = actionSentenceParts(increment, [target, amount], {
      target: "woofx3:counter:deaths",
      amount: "${bits.next}",
    });
    expect(sentenceText(parts)).toBe("Add next to woofx3:counter:deaths");
    expect(parts[1]).toMatchObject({ state: "variable", text: "next" });
  });

  test("reads a switch as its label, or not its label", () => {
    const visible: ConfigField = { id: "visible", label: "Visible", type: "toggle" };
    const action = { name: "Set widget visibility", sentence: "Make the widget {visible}" };
    expect(text(action, [visible], { visible: true })).toBe("Make the widget visible");
    expect(text(action, [visible], { visible: false })).toBe("Make the widget not visible");
    expect(text(action, [visible], {})).toBe("Make the widget not visible");
  });

  test("quotes chat text and shows its variables by their short names", () => {
    const message: ConfigField = { id: "message", label: "Message", type: "text", required: true };
    const chat = { name: "Send chat message", sentence: "Send {message} in chat" };
    expect(text(chat, [message], { message: "Thanks ${trigger.data.userName}!" })).toBe(
      "Send “Thanks {userName}!” in chat"
    );
    expect(text(chat, [message], {})).toBe("Send a message in chat");
  });

  test("shows an option's label and a picked name unquoted", () => {
    const tier: ConfigField = {
      id: "tier",
      label: "Tier",
      type: "select",
      options: [{ value: "1000", label: "Tier 1" }],
    };
    const widget: ConfigField = { id: "target", label: "Alert widget", type: "text", source: { kind: "alertWidgets" } };
    expect(
      text({ name: "x", sentence: "Play {tier} on {target}" }, [tier, widget], { tier: "1000", target: "main" })
    ).toBe("Play Tier 1 on main");
  });
});

describe("actionSentenceParts without a declared sentence", () => {
  test("reads as the action's name and the settings it has", () => {
    expect(text({ name: "Increment counter" }, [target, amount], { target: "woofx3:counter:deaths", amount: 5 })).toBe(
      "Increment counter: counter Deaths, amount 5"
    );
  });

  test("leaves out an empty optional setting and marks a missing required one", () => {
    expect(text({ name: "Increment counter" }, [target, amount], {})).toBe("Increment counter: a counter");
  });

  test("reads a switch as its own words", () => {
    const visible: ConfigField = { id: "visible", label: "Visible", type: "toggle" };
    expect(text({ name: "Set widget visibility" }, [visible], { visible: false })).toBe(
      "Set widget visibility: not visible"
    );
  });

  test("is the action's name alone when it has no settings", () => {
    expect(text({ name: "Print" }, [], {})).toBe("Print");
  });

  test("treats a blank template as none", () => {
    expect(text({ name: "Print", sentence: "  " }, [], {})).toBe("Print");
  });
});
