import { afterEach, describe, expect, test } from "bun:test";
import { DEFAULT_ALERT_ITEMS, DEFAULT_ALERTS_PACK_ID } from "@shared/default-seed";
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
  harness.state.widgets = [
    {
      id: "cae7619f-41f4-4a6e-9f3a-0d5be1c7a2d1",
      manifestId: "alert",
      createdByRef: "woofx3:0.46.0:abc1234",
      name: "Alert",
      hostsSurface: "alert",
    },
  ] as never;
  harness.state.modules = [{ moduleId: "woofx3", moduleKey: "woofx3:0.46.0:abc1234" }] as never;
  harness.state.workflowCatalog = {
    triggers: [...new Set(DEFAULT_ALERT_ITEMS.map((item) => item.trigger.event))].map((event) => ({
      id: event,
      name: event,
      event,
      projectionKey: `woofx3_twitch:trigger:${event}`,
    })),
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
  test("remembers passing the overlay page, and a finish outranks a later skip", async () => {
    const { runtime } = await connected();
    const seed = directDefaultSeedGateway(runtime);
    const status = renderDirect(() => seed.useStatus());
    await status.until((value) => value?.overlayDone === null, "nothing recorded");
    const mark = renderDirect(() => seed.useMarkOverlayDoneRequest()).current();
    await mark("skipped");
    await status.until((value) => value?.overlayDone?.outcome === "skipped", "the skip");
    await mark("finished");
    await status.until((value) => value?.overlayDone?.outcome === "finished", "the finish");
    await mark("skipped");
    await status.until((value) => value?.overlayDone?.outcome === "finished", "the finish kept");
  });

  test("seeds text-only alerts on a module too old to have the images, and reports it", async () => {
    const { runtime, state } = await connected();
    state.modules = [{ moduleId: "woofx3", moduleKey: "woofx3:0.45.0:abc1234" }] as never;
    const seed = directDefaultSeedGateway(runtime);
    await renderDirect(() => seed.useApplyRequest()).current()();
    const status = renderDirect(() => seed.useStatus());
    await status.until((value) => value?.alertImagesOmitted === true, "the omitted images");
    expect(status.current()?.scene.engineSceneId).toBe("scene-1");
    expect(status.current()?.alerts.map((alert) => [alert.itemId, alert.status, alert.engineWorkflowId])).toEqual([
      ...DEFAULT_ALERT_ITEMS.map((item, index) => [item.id, "installed", `workflow-${index + 1}`]),
    ]);
    expect(JSON.stringify(state.callsOf("createWorkflow"))).not.toContain(".svg");
    status.unmount();
  });

  test("seeds once: a workflow the streamer deleted is not recreated by applying again", async () => {
    const { runtime, state } = await connected();
    const seed = directDefaultSeedGateway(runtime);
    const apply = renderDirect(() => seed.useApplyRequest()).current();

    await apply();
    const created = state.callsOf("createWorkflow").length;
    expect(created).toBe(DEFAULT_ALERT_ITEMS.length);
    expect(state.callsOf("setWorkflowEnabled")).toHaveLength(DEFAULT_ALERT_ITEMS.length);
    const ledgerKey = starterItemKey(DEFAULT_ALERTS_PACK_ID, "follow");
    expect(state.callsOf("setUISetting").map(([, key]) => key)).toContain(ledgerKey);

    expect(state.callsOf("createScene")).toHaveLength(1);
    const [scene] = state.callsOf("createScene")[0] as [{ widgetsJson: string }];
    expect(JSON.parse(scene.widgetsJson)[0].widgetCanonicalId).toBe("woofx3:widget:alert");

    state.workflows = [];
    state.scenes = [];
    await apply();
    expect(state.callsOf("createWorkflow")).toHaveLength(created);
    expect(state.callsOf("createScene")).toHaveLength(1);
  });
});
