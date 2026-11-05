import { describe, expect, test } from "bun:test";
import { DEFAULT_MODERATION_CONFIG, type ModerationConfig } from "@woofx3/api/moderation-config";
import { act, create } from "react-test-renderer";
import { EngineGatewayProvider } from "@/engine/context";
import type { EngineGateway } from "@/engine/gateway";
import { EngineScopeProvider } from "@/engine/scope";
import { FakeChatModerationGateway } from "@/engine/testing/FakeChatModerationGateway";
import type { EngineScope, InstanceId } from "@/engine/types";
import { type ModerationConfigState, useModerationConfig } from "./use-chat-moderation";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SCOPE: EngineScope = {
  instanceId: "instance-1" as InstanceId,
  optimisticInstanceId: "instance-1" as InstanceId,
  isInstanceLoading: false,
};

async function render(fake: FakeChatModerationGateway, scope: EngineScope = SCOPE) {
  let latest: ModerationConfigState | undefined;
  function Probe() {
    latest = useModerationConfig();
    return null;
  }
  const gateway = { chatModeration: fake } as unknown as EngineGateway;
  await act(async () => {
    create(
      <EngineGatewayProvider gateway={gateway}>
        <EngineScopeProvider scope={scope}>
          <Probe />
        </EngineScopeProvider>
      </EngineGatewayProvider>
    );
  });
  return () => {
    if (latest === undefined) {
      throw new Error("the hook has not rendered");
    }
    return latest;
  };
}

const ENABLED: ModerationConfig = { ...DEFAULT_MODERATION_CONFIG, enabled: true };

describe("useModerationConfig", () => {
  test("reads the config", async () => {
    const current = await render(new FakeChatModerationGateway());
    expect(current().read.data).toEqual({ kind: "ready", config: DEFAULT_MODERATION_CONFIG });
  });

  test("says when the engine is too old to moderate chat", async () => {
    const fake = new FakeChatModerationGateway();
    fake.supported = false;
    const current = await render(fake);
    expect(current().read.data).toEqual({ kind: "unsupported" });
  });

  test("reads the config again after a save", async () => {
    const fake = new FakeChatModerationGateway();
    const current = await render(fake);
    await act(async () => {
      await current().save(ENABLED);
    });
    expect(fake.reads).toBe(2);
    expect(current().read.data).toEqual({ kind: "ready", config: ENABLED });
  });

  test("a refused save rejects and leaves the config as it was", async () => {
    const fake = new FakeChatModerationGateway();
    const current = await render(fake);
    await act(async () => {
      await expect(current().save({ ...ENABLED, version: 2 } as unknown as ModerationConfig)).rejects.toThrow(
        "version 2"
      );
    });
    expect(fake.saved).toHaveLength(0);
    expect(current().read.data).toEqual({ kind: "ready", config: DEFAULT_MODERATION_CONFIG });
  });

  test("asks nothing while no instance is selected", async () => {
    const fake = new FakeChatModerationGateway();
    const current = await render(fake, { instanceId: null, optimisticInstanceId: null, isInstanceLoading: false });
    expect(fake.reads).toBe(0);
    expect(current().read.data).toBeUndefined();
  });
});
