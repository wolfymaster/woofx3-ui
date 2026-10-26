import { describe, expect, test } from "bun:test";
import { act, create } from "react-test-renderer";
import { ConfigurationForm } from "@/components/common/configuration-form";
import type { CatalogActionRow } from "@/hooks/use-workflow-catalog";
import type { ActionNode } from "@/lib/workflow-tree";
import { ActionSettingsEditor } from "./action-settings-editor";

const ANNOUNCE: CatalogActionRow = {
  id: "chat.announce",
  canonicalRef: "core:chat.announce",
  name: "Announce",
  description: "",
  category: "chat",
  color: "",
  icon: "",
  configFields: [
    {
      id: "platform",
      label: "Platform",
      // A text field stands in for the real select, which needs a DOM to render.
      type: "text",
      defaultValue: "origin",
    },
    {
      id: "twitchColor",
      label: "Colour",
      type: "text",
      description: "Shown only on Twitch.",
      required: true,
      defaultValue: "blue",
      visibleWhen: { field: "platform", oneOf: ["origin", "twitch"] },
    },
  ],
};

function step(parameters: Record<string, unknown>): ActionNode {
  return { id: "a", type: "action", action: "function", ref: "core:chat.announce", parameters };
}

function mount(parameters: Record<string, unknown>, changes: ActionNode[]) {
  let renderer: ReturnType<typeof create> | undefined;
  act(() => {
    renderer = create(
      <ActionSettingsEditor
        step={step(parameters)}
        catalogActions={[ANNOUNCE]}
        existingStepIds={new Set()}
        availableVariables={[]}
        onChange={(next) => changes.push(next)}
      />
    );
  });
  if (!renderer) {
    throw new Error("the editor did not render");
  }
  return renderer;
}

const row = (r: ReturnType<typeof create>, id: string) => r.root.findAllByProps({ "data-testid": `setting-${id}` });

function changeController(r: ReturnType<typeof create>, value: string) {
  const form = r.root.findAllByType(ConfigurationForm).find((f) => f.props.fields[0].id === "platform");
  if (!form) {
    throw new Error("no platform form");
  }
  act(() => form.props.onChange({ platform: value }));
}

describe("ActionSettingsEditor visibleWhen", () => {
  test("test_action_settings_editor_draws_no_row_for_a_hidden_setting", () => {
    expect(row(mount({ platform: "twitch" }, []), "twitchColor").length).toBeGreaterThan(0);
    const hidden = mount({ platform: "kick" }, []);
    expect(row(hidden, "twitchColor")).toEqual([]);
    expect(hidden.root.findAllByProps({ "data-testid": "setting-problem-twitchColor" })).toEqual([]);
  });

  test("test_action_settings_editor_switching_controller_away_drops_the_hidden_value", () => {
    const changes: ActionNode[] = [];
    changeController(mount({ platform: "twitch", twitchColor: "purple" }, changes), "kick");
    expect(changes.map((c) => c.parameters)).toEqual([{ platform: "kick" }]);
  });

  test("test_action_settings_editor_switching_controller_back_restores_the_default", () => {
    const changes: ActionNode[] = [];
    changeController(mount({ platform: "kick" }, changes), "twitch");
    expect(changes.map((c) => c.parameters)).toEqual([{ platform: "twitch", twitchColor: "blue" }]);
  });
});
