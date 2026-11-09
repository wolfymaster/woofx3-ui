import { describe, expect, test } from "bun:test";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { EngineGatewayProvider } from "@/engine/context";
import type { EngineGateway } from "@/engine/gateway";
import { EngineScopeProvider } from "@/engine/scope";
import { FakeChatModerationGateway } from "@/engine/testing/FakeChatModerationGateway";
import type { EngineScope, InstanceId } from "@/engine/types";
import { createAppLogger } from "@/lib/logger";
import { LoggerProvider } from "@/lib/logger-context";
import Moderation from "./moderation";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SCOPE: EngineScope = {
  instanceId: "instance-1" as InstanceId,
  optimisticInstanceId: "instance-1" as InstanceId,
  isInstanceLoading: false,
};

async function render(fake: FakeChatModerationGateway): Promise<ReactTestRenderer> {
  const gateway = { chatModeration: fake, twitchLink: { useLink: () => null } } as unknown as EngineGateway;
  let renderer: ReactTestRenderer | undefined;
  await act(async () => {
    renderer = create(
      <LoggerProvider logger={createAppLogger([])}>
        <EngineGatewayProvider gateway={gateway}>
          <EngineScopeProvider scope={SCOPE}>
            <Moderation />
          </EngineScopeProvider>
        </EngineGatewayProvider>
      </LoggerProvider>
    );
  });
  if (renderer === undefined) {
    throw new Error("render: the renderer was not created");
  }
  return renderer;
}

function hasTestId(renderer: ReactTestRenderer, id: string): boolean {
  return renderer.root.findAll((node) => node.props["data-testid"] === id).length > 0;
}

describe("Moderation page", () => {
  test("tells the streamer to update an engine that cannot moderate chat", async () => {
    const fake = new FakeChatModerationGateway();
    fake.supported = false;
    const renderer = await render(fake);
    expect(hasTestId(renderer, "moderation-unsupported")).toBe(true);
    expect(hasTestId(renderer, "moderation-save")).toBe(false);
  });
});
