import { describe, expect, test } from "bun:test";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { EngineGatewayProvider } from "@/engine/context";
import type { EngineGateway } from "@/engine/gateway";
import type { FlowSave } from "@/hooks/use-flow-save";
import type { CatalogActionRow } from "@/hooks/use-workflow-catalog";
import type { ActionNode, WorkflowTree } from "@/lib/workflow-tree";
import { TriggerSentence } from "./trigger-sentence";

const action: ActionNode = { type: "action", id: "show-alert", function: "alert", action: "function", parameters: {} };
const second: ActionNode = {
  type: "action",
  id: "say-thanks",
  function: "chat",
  action: "function",
  parameters: {},
};
const tree: WorkflowTree = {
  trigger: { type: "trigger", id: "trigger", event: "twitch:cheer", conditions: [] },
  steps: [action, second],
};

const catalogActions: CatalogActionRow[] = [
  {
    id: "alert",
    functionCall: "alert",
    handlerType: "alert",
    name: "Bits alert",
    description: "Show the alert",
    category: "",
    color: "",
    icon: "",
  },
  {
    id: "chat",
    functionCall: "chat",
    handlerType: "chat",
    name: "Say thanks in chat",
    description: "Write a message",
    category: "",
    color: "",
    icon: "",
  },
];

const save: FlowSave = {
  changed: false,
  phase: "idle",
  problem: null,
  notSavedYet: null,
  commit: async () => true,
  markSaved: () => undefined,
};

const gateway = {
  moduleResources: {
    useKindInstances: () => [],
    useKindsInstances: () => [],
    useInstances: () => [],
  },
  scenes: {
    useScenes: () => [],
    useAlertWidgetNames: () => [],
  },
} as unknown as EngineGateway;

async function render(): Promise<ReactTestRenderer> {
  let renderer: ReactTestRenderer | undefined;
  await act(async () => {
    renderer = create(
      <Router hook={memoryLocation({ path: "/" }).hook}>
        <EngineGatewayProvider gateway={gateway}>
          <TriggerSentence
            when={<span>When someone cheers</span>}
            tree={tree}
            onChange={() => undefined}
            onCommit={async () => true}
            save={save}
            catalogTriggers={[]}
            catalogActions={catalogActions}
            catalogLoading={false}
            actionPresets={[]}
            onOpenAdvanced={() => undefined}
          />
        </EngineGatewayProvider>
      </Router>
    );
  });
  if (!renderer) {
    throw new Error("render: the renderer was not created");
  }
  return renderer;
}

function findAll(renderer: ReactTestRenderer, testId: string): ReactTestInstance[] {
  return renderer.root.findAll((node) => node.props["data-testid"] === testId);
}

function serialized(renderer: ReactTestRenderer): string {
  return JSON.stringify(renderer.toJSON());
}

describe("TriggerSentence", () => {
  test("every step is a phrase and nothing floats over the sentence", async () => {
    const renderer = await render();
    expect(findAll(renderer, "sentence-phrase-show-alert")).toHaveLength(1);
    expect(findAll(renderer, "sentence-phrase-say-thanks")).toHaveLength(1);
    expect(findAll(renderer, "sentence-add-root#2")).toHaveLength(1);
    const view = serialized(renderer);
    expect(view).not.toContain("dialog");
    expect(view).not.toContain("popover");
    expect(view).not.toContain("dropdown");
  });

  test("only one phrase section is open at a time", async () => {
    const renderer = await render();
    await act(async () => {
      findAll(renderer, "sentence-phrase-show-alert")[0].props.onClick();
    });
    expect(findAll(renderer, "sentence-section-show-alert")).toHaveLength(1);

    await act(async () => {
      findAll(renderer, "sentence-phrase-say-thanks")[0].props.onClick();
    });
    expect(findAll(renderer, "sentence-section-show-alert")).toHaveLength(0);
    expect(findAll(renderer, "sentence-section-say-thanks")).toHaveLength(1);
  });

  test("Done closes the open section", async () => {
    const renderer = await render();
    await act(async () => {
      findAll(renderer, "sentence-phrase-show-alert")[0].props.onClick();
    });
    expect(findAll(renderer, "sentence-section-show-alert")).toHaveLength(1);
    await act(async () => {
      findAll(renderer, "sentence-phrase-show-alert")[0].props.onClick();
    });
    expect(findAll(renderer, "sentence-section-show-alert")).toHaveLength(0);
  });
});
