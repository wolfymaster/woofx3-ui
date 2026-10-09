import { describe, expect, test } from "bun:test";
import type { ConfigField } from "@woofx3/api/ui-schema";
import type { ResourceAction } from "@/lib/resource-actions";
import type { ResourceInstanceDoc } from "@/lib/resource-instance";
import type { ActionPreset } from "@/lib/workflow-presets";
import {
  type PaletteResourceKind,
  promptValue,
  type RunKindAction,
  resourceKindItemCommands,
} from "./resource-kind-commands";
import type { PaletteCommand } from "./types";

const icon = (() => null) as unknown as ActionPreset["icon"];

const target: ConfigField = { id: "target", label: "Wheel", type: "resource_ref", resourceKind: "wheel_spin:wheel" };

function action(id: string, name: string, fields: ConfigField[] = []): ResourceAction {
  return {
    preset: {
      id,
      name,
      description: "",
      icon,
      category: "General",
      color: "#888",
      source: "Wheel Spin",
      config: { fields: [target, ...fields] },
    },
    fieldId: "target",
  };
}

const spin = action("spin", "Spin the wheel", [{ id: "seconds", label: "Seconds", type: "number" }]);
const add = action("add", "Add to the wheel", [{ id: "item", label: "Entry", type: "text", required: true }]);
const pick = action("pick", "Pick a colour", [
  { id: "colour", label: "Colour", type: "color", required: true },
  { id: "note", label: "Note", type: "text", required: true },
]);

function wheelKind(actions: ResourceAction[] = [spin, add, pick]): PaletteResourceKind {
  return { moduleName: "wheel_spin", kind: "wheel", name: "Wheel", icon, actions };
}

function row(canonicalId: string, displayName = ""): ResourceInstanceDoc {
  const [, kind, resourceInstanceId] = canonicalId.split(":");
  return { canonicalId, kind, resourceInstanceId, displayName } as unknown as ResourceInstanceDoc;
}

interface Ran {
  canonicalId: string;
  presetId: string;
  parameters: Record<string, unknown>;
}

function build(kinds: PaletteResourceKind[], rows: ResourceInstanceDoc[], values: Record<string, unknown> = {}) {
  const ran: Ran[] = [];
  const run: RunKindAction = async (instance, chosen, parameters) => {
    ran.push({ canonicalId: instance.canonicalId, presetId: chosen.preset.id, parameters });
    return true;
  };
  return { commands: resourceKindItemCommands(kinds, rows, values, run), ran };
}

function child(item: PaletteCommand, presetId: string): PaletteCommand {
  const found = item.children?.find((candidate) => candidate.id === `${item.id}:${presetId}`);
  if (!found) {
    throw new Error(`no ${presetId} under ${item.id}`);
  }
  return found;
}

describe("resourceKindItemCommands", () => {
  test("lists each instance of a kind under the kind's plural, opening its page", () => {
    const { commands } = build(
      [wheelKind()],
      [row("wheel_spin:wheel:giveaway", "Giveaway"), row("wheel_spin:wheel:games")],
      { "wheel_spin:wheel:giveaway": ["a", "b", "c"] }
    );
    expect(commands.map((command) => [command.title, command.group, command.meta])).toEqual([
      ["Giveaway", "Wheels", "3"],
      ["games", "Wheels", undefined],
    ]);
    expect(commands[0].action).toEqual({ type: "navigate", href: "/stream/resources/wheel_spin/wheel/giveaway" });
    expect(commands[0].isOpenAt?.("/stream/resources/wheel_spin/wheel/giveaway")).toBe(true);
    expect(commands[0].isOpenAt?.("/stream/resources/wheel_spin/wheel/games")).toBe(false);
  });

  test("reads the part of a value its kind's summary names", () => {
    const { commands } = build([{ ...wheelKind(), summaryPath: "items" }], [row("wheel_spin:wheel:giveaway")], {
      "wheel_spin:wheel:giveaway": { items: ["a", "b"], spin: null },
    });
    expect(commands[0].meta).toBe("2");
  });

  test("leaves out another module's kind of the same name, and the first-party kinds", () => {
    const counters: PaletteResourceKind = { moduleName: "woofx3", kind: "counter", name: "Counter", icon, actions: [] };
    const { commands } = build(
      [wheelKind(), counters],
      [row("rival:wheel:other"), row("woofx3:counter:deaths"), row("wheel_spin:wheel:mine")]
    );
    expect(commands.map((command) => command.id)).toEqual(["resource:wheel_spin:wheel:mine"]);
  });

  test("runs an action that needs nothing more at once, aimed at the instance", async () => {
    const { commands, ran } = build([wheelKind()], [row("wheel_spin:wheel:giveaway", "Giveaway")]);
    const command = child(commands[0], "spin");
    expect(command.title).toBe("Spin the wheel");
    if (command.action.type !== "run") {
      throw new Error("expected a run");
    }
    expect(await command.action.run()).toBe("Spin the wheel: Giveaway");
    expect(ran).toEqual([{ canonicalId: "wheel_spin:wheel:giveaway", presetId: "spin", parameters: {} }]);
  });

  test("asks for the one line an action needs", async () => {
    const { commands, ran } = build([wheelKind()], [row("wheel_spin:wheel:giveaway")]);
    const command = child(commands[0], "add");
    if (command.action.type !== "prompt") {
      throw new Error("expected a prompt");
    }
    await command.action.prompt.run("  pizza  ");
    expect(ran).toEqual([{ canonicalId: "wheel_spin:wheel:giveaway", presetId: "add", parameters: { item: "pizza" } }]);
  });

  test("opens the instance's page for an action that needs more than a line", () => {
    const { commands } = build([wheelKind()], [row("wheel_spin:wheel:giveaway")]);
    expect(child(commands[0], "pick").action).toEqual({
      type: "navigate",
      href: "/stream/resources/wheel_spin/wheel/giveaway",
    });
  });

  test("hides each action until searched for", () => {
    const { commands } = build([wheelKind()], [row("wheel_spin:wheel:giveaway")]);
    expect(commands[0].children?.every((command) => command.hiddenUntilSearch)).toBe(true);
  });
});

describe("promptValue", () => {
  const seconds: ConfigField = { id: "seconds", label: "Seconds", type: "number", min: 1, max: 60 };

  test("reads a number for a number field and text for anything else", () => {
    expect(promptValue(seconds, " 12 ")).toBe(12);
    expect(promptValue({ id: "item", label: "Entry", type: "text" }, " 12 ")).toBe("12");
  });

  test("refuses nothing, a word for a number, and a number out of bounds", () => {
    expect(() => promptValue(seconds, "  ")).toThrow("Type seconds");
    expect(() => promptValue(seconds, "soon")).toThrow("must be a number");
    expect(() => promptValue(seconds, "61")).toThrow("between 1 and 60");
  });
});
