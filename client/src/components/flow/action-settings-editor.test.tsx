import { describe, expect, test } from "bun:test";
import { create, type ReactTestRenderer } from "react-test-renderer";
import type { CatalogActionRow } from "@/hooks/use-workflow-catalog";
import type { ActionNode } from "@/lib/workflow-tree";
import { ActionSettingsEditor } from "./action-settings-editor";

const alertStep: ActionNode = {
  type: "action",
  id: "alert-1",
  function: "alert",
  action: "function",
  parameters: { layout: { surface: "alert", widgets: [] } },
};
const chatStep: ActionNode = {
  type: "action",
  id: "chat-1",
  function: "chat",
  action: "function",
  parameters: {},
};

const alertRow: CatalogActionRow = {
  id: "alert",
  functionCall: "alert",
  handlerType: "alert",
  name: "Bits alert",
  description: "",
  category: "",
  color: "",
  icon: "",
  configFields: JSON.stringify([
    { id: "layout", label: "Alert contents", type: "layout", surface: "alert", required: false },
  ]),
};
const chatRow: CatalogActionRow = {
  id: "chat",
  functionCall: "chat",
  handlerType: "chat",
  name: "Say thanks in chat",
  description: "",
  category: "",
  color: "",
  icon: "",
  configFields: JSON.stringify([{ id: "message", label: "Message", type: "text", required: false }]),
};

function render(step: ActionNode, row: CatalogActionRow): ReactTestRenderer {
  return create(
    <ActionSettingsEditor
      step={step}
      catalogActions={[row]}
      existingStepIds={new Set()}
      availableVariables={[]}
      onChange={() => undefined}
    />
  );
}

function hasTestId(renderer: ReactTestRenderer, testId: string): boolean {
  return renderer.root.findAll((node) => node.props["data-testid"] === testId).length > 0;
}

describe("AlertLayoutPreview in action settings", () => {
  test("an Alert action shows a preview that opens the alert editor", () => {
    const renderer = render(alertStep, alertRow);
    const preview = renderer.root.findByProps({ "data-testid": "alert-layout-preview" });
    expect(preview.props["aria-label"]).toBe("Edit alert");
    expect(JSON.stringify(renderer.toJSON())).not.toContain("See alert contents");
  });

  test("a non-Alert action shows no preview", () => {
    const renderer = render(chatStep, chatRow);
    expect(hasTestId(renderer, "alert-layout-preview")).toBe(false);
  });
});
