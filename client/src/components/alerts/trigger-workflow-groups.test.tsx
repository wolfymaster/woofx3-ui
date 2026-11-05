import { describe, expect, test } from "bun:test";
import type { ReactElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { EngineGatewayProvider } from "@/engine/context";
import type { EngineGateway } from "@/engine/gateway";
import type { Workflow, WorkflowGroup } from "@/engine/types";
import { TriggerAdvancedSettings, TriggerGroupChips } from "./trigger-workflow-groups";

function workflow(id: string, groupIds: string[]): Workflow {
  return { engineWorkflowId: id, definition: {}, isEnabled: true, groupIds, createdAt: 0, updatedAt: 0 };
}

const holiday: WorkflowGroup = { engineGroupId: "g-1", name: "Holiday", description: "", enabled: true, memberIds: [] };
const sponsor: WorkflowGroup = {
  engineGroupId: "g-2",
  name: "Sponsor",
  description: "",
  enabled: false,
  memberIds: [],
};

function gatewayWith(supported: boolean, onGroupsRead: () => void = () => {}): EngineGateway {
  const capabilities = supported ? ["workflows.groups"] : [];
  const write = async () => holiday;
  return {
    session: { useCapabilities: () => capabilities },
    workflows: {
      useGroups: () => {
        onGroupsRead();
        return [holiday, sponsor];
      },
      useAddGroupMembersRequest: () => write,
      useRemoveGroupMembersRequest: () => write,
    },
  } as unknown as EngineGateway;
}

async function render(gateway: EngineGateway, element: ReactElement): Promise<ReactTestRenderer> {
  let renderer: ReactTestRenderer | undefined;
  await act(async () => {
    renderer = create(<EngineGatewayProvider gateway={gateway}>{element}</EngineGatewayProvider>);
  });
  // Lets a support check the component started settle.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  if (!renderer) {
    throw new Error("render: the renderer was not created");
  }
  return renderer;
}

function text(renderer: ReactTestRenderer): string {
  return JSON.stringify(renderer.toJSON());
}

describe("TriggerGroupChips", () => {
  test("names the groups every workflow of the card is in", async () => {
    const renderer = await render(
      gatewayWith(true),
      <TriggerGroupChips workflows={[workflow("w-1", ["g-1", "g-2"]), workflow("w-2", ["g-1"])]} />
    );
    expect(text(renderer)).toContain("Holiday");
    expect(text(renderer)).not.toContain("Sponsor");
  });

  test("a card in no group shows nothing and reads no groups", async () => {
    let reads = 0;
    const renderer = await render(
      gatewayWith(true, () => {
        reads += 1;
      }),
      <TriggerGroupChips workflows={[workflow("w-1", [])]} />
    );
    expect(renderer.toJSON()).toBeNull();
    expect(reads).toBe(0);
  });
});

describe("TriggerAdvancedSettings", () => {
  test("is offered when the engine has groups", async () => {
    const renderer = await render(gatewayWith(true), <TriggerAdvancedSettings workflows={[workflow("w-1", [])]} />);
    expect(text(renderer)).toContain("Advanced");
  });

  test("is hidden on an engine without groups", async () => {
    const renderer = await render(gatewayWith(false), <TriggerAdvancedSettings workflows={[workflow("w-1", [])]} />);
    expect(renderer.toJSON()).toBeNull();
  });
});
