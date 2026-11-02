import { afterEach, describe, expect, test } from "bun:test";
import { DEFAULT_ALERTS_PACK_ID } from "@shared/default-seed";
import { starterItemKey } from "@shared/starter-packs";
import { directDefaultSeedGateway } from "./default-seed";
import { createDirectHarness, type DirectHarness, renderDirect } from "./testing/direct-harness";

const harnesses: DirectHarness[] = [];

afterEach(async () => {
  for (const harness of harnesses.splice(0)) {
    await harness.runtime.stop();
  }
});

async function connected(): Promise<DirectHarness> {
  const harness = createDirectHarness();
  harnesses.push(harness);
  await harness.connect();
  harness.state.widgets = [{ id: "woofx3:widget:alert", name: "Alert", hostsSurface: "alert" }] as never;
  harness.state.modules = [{ moduleId: "woofx3", moduleKey: "woofx3:0.45.0:abc1234" }] as never;
  harness.state.workflowCatalog = {
    triggers: ["channel.follow", "channel.subscribe", "channel.resub", "channel.subscriptionGift", "channel.cheer"].map(
      (event) => ({ id: event, name: event, event, projectionKey: `woofx3_twitch:trigger:${event}` })
    ),
    actions: [
      {
        id: "alert",
        name: "Alert",
        description: "",
        projectionKey: "woofx3:action:alert",
        type: "native",
        call: "alert",
        createdByType: "SYSTEM",
        createdByRef: "",
      },
    ],
    functions: [],
  } as never;
  return harness;
}

describe("the direct default seed", () => {
  test("seeds text-only alerts on a module too old to have the images, and reports it", async () => {
    const { runtime, state } = await connected();
    state.modules = [{ moduleId: "woofx3", moduleKey: "woofx3:0.44.0:abc1234" }] as never;
    const seed = directDefaultSeedGateway(runtime);
    await renderDirect(() => seed.useApplyRequest()).current()();
    const status = renderDirect(() => seed.useStatus());
    await status.until((value) => value?.alertImagesOmitted === true, "the omitted images");
    expect(status.current()?.scene.engineSceneId).toBe("scene-1");
    expect(status.current()?.alerts.map((alert) => [alert.itemId, alert.status, alert.engineWorkflowId])).toEqual([
      ["follow", "installed", "workflow-1"],
      ["sub", "installed", "workflow-2"],
      ["resub", "installed", "workflow-3"],
      ["gift", "installed", "workflow-4"],
      ["bits", "installed", "workflow-5"],
    ]);
    expect(JSON.stringify(state.callsOf("createWorkflow"))).not.toContain("webp");
    status.unmount();
  });

  test("seeds once: a workflow the streamer deleted is not recreated by applying again", async () => {
    const { runtime, state } = await connected();
    const seed = directDefaultSeedGateway(runtime);
    const apply = renderDirect(() => seed.useApplyRequest()).current();

    await apply();
    const created = state.callsOf("createWorkflow").length;
    expect(created).toBe(5);
    expect(state.callsOf("setWorkflowEnabled")).toHaveLength(5);
    const ledgerKey = starterItemKey(DEFAULT_ALERTS_PACK_ID, "follow");
    expect(state.callsOf("setUISetting").map(([, key]) => key)).toContain(ledgerKey);

    expect(state.callsOf("createScene")).toHaveLength(1);

    state.workflows = [];
    state.scenes = [];
    await apply();
    expect(state.callsOf("createWorkflow")).toHaveLength(created);
    expect(state.callsOf("createScene")).toHaveLength(1);
  });
});
