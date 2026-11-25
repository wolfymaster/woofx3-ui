import { afterEach, describe, expect, test } from "bun:test";
import type { SetupImportAnalysis } from "@/engine/types";
import { directSetupImportsGateway } from "./setup-imports";
import { createDirectHarness, type DirectHarness, renderDirect } from "./testing/direct-harness";
import { UI_SETTING_NAMESPACES } from "./ui-settings";

const harnesses: DirectHarness[] = [];

async function connected(): Promise<DirectHarness> {
  const harness = createDirectHarness();
  harnesses.push(harness);
  await harness.connect();
  harness.state.workflowCatalog = {
    triggers: [],
    actions: [
      {
        id: "chat.reply",
        name: "Reply",
        description: "",
        projectionKey: "woofx3:action:chat.reply",
        type: "function",
        call: "chat.reply",
        createdByType: "SYSTEM",
        createdByRef: "",
      },
    ],
    functions: [],
  } as never;
  return harness;
}

afterEach(async () => {
  for (const harness of harnesses.splice(0)) {
    await harness.runtime.stop();
  }
});

function firebotExport(trigger: string): SetupImportAnalysis {
  const document = {
    name: "My setup",
    components: {
      commands: [
        {
          id: "c1",
          type: "custom",
          active: true,
          trigger,
          cooldown: { global: 30 },
          effects: { id: "e", list: [{ id: "m", type: "firebot:chat", message: "Hi", chatter: "Streamer" }] },
        },
      ],
    },
  };
  return { source: "firebot", documentChunks: [JSON.stringify(document)] };
}

describe("direct setup imports", () => {
  test("an export is reviewed, then its command is created and reported", async () => {
    const { runtime, state } = await connected();
    const imports = directSetupImportsGateway(runtime);
    const latest = renderDirect(() => imports.useLatest());
    await latest.until((value) => value === null, "no import yet");
    const analyze = renderDirect(() => imports.useAnalyzeRequest()).current();
    const start = renderDirect(() => imports.useStartRequest()).current();

    const { importId } = await analyze(firebotExport("!hello"));
    await latest.until((value) => value?.status === "review", "the import in review");
    expect(latest.current()?.items.map((item) => [item.kind, item.name, item.outcome])).toEqual([
      ["command", "!hello", null],
    ]);
    expect(state.commands).toHaveLength(0);

    await start(importId);
    await latest.until((value) => value?.status === "done", "the import done");
    expect(latest.current()?.items[0]?.outcome).toBe("created");
    expect(state.commands.map((command) => command.command)).toEqual(["hello"]);
    latest.unmount();
  });

  test("a command the streamer already has is kept, and the import says so", async () => {
    const { runtime, state, clock } = await connected();
    const imports = directSetupImportsGateway(runtime);
    const latest = renderDirect(() => imports.useLatest());
    const analyze = renderDirect(() => imports.useAnalyzeRequest()).current();
    const start = renderDirect(() => imports.useStartRequest()).current();

    await start((await analyze(firebotExport("!hello"))).importId);
    await latest.until((value) => value?.status === "done", "the first import done");
    clock.advance(1000);
    const second = (await analyze(firebotExport("!hello"))).importId;
    await start(second);
    await latest.until((value) => value?.id === second && value.status === "done", "the second import done");

    expect(latest.current()?.items[0]?.outcome).toBe("exists");
    expect(state.commands).toHaveLength(1);
    latest.unmount();
  });

  test("an import cut off by the app closing waits for Try again, which finishes it", async () => {
    const { runtime, state } = await connected();
    const imports = directSetupImportsGateway(runtime);
    const analyze = renderDirect(() => imports.useAnalyzeRequest()).current();
    const retry = renderDirect(() => imports.useRetryRequest()).current();
    const latest = renderDirect(() => imports.useLatest());
    const { importId } = await analyze(firebotExport("!hello"));
    await latest.until((value) => value?.status === "review", "the import in review");

    const namespace = state.uiSettings[UI_SETTING_NAMESPACES.setupImports] ?? {};
    const runSetting = namespace[`run:${importId}`];
    namespace[`run:${importId}`] = { ...runSetting, value: { ...(runSetting.value as object), status: "applying" } };
    await runtime.queryClient.invalidateQueries();
    await latest.until((value) => value?.stalled === true, "the cut-off import");
    expect(latest.current()?.status).toBe("queued");

    await retry(importId);
    await latest.until((value) => value?.status === "done", "the import done");
    expect(state.commands.map((command) => command.command)).toEqual(["hello"]);
    latest.unmount();
  });
});
