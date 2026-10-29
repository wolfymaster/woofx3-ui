import { afterEach, describe, expect, test } from "bun:test";
import { HEALTH_STILL_LOADING_MESSAGE, RESYNC_MIN_INTERVAL_MS } from "@shared/workflow-health";
import {
  type AlertComposition,
  type CommandSnapshot,
  ENGINE_CAPABILITIES,
  EngineEventType,
  makeCallbackEnvelope,
  type SceneSnapshot,
  type StreamEventFrame,
  type Workflow,
} from "@woofx3/api";
import { GatewayUnsupportedError } from "@/engine/errors";
import { NoInstanceSelectedError } from "@/engine/scope";
import type { WorkflowRun } from "@/engine/types";
import { waitFor } from "@/lib/engine-session/testing/wait-for";
import { directAlertLibraryGateway } from "./alert-library";
import { directAlertQueueGateway } from "./alert-queue";
import { directCommandsGateway } from "./commands";
import { directEventLogGateway } from "./event-log";
import { toSceneId } from "./ids";
import { directKeys } from "./keys";
import { directOverlaysGateway } from "./overlays";
import { directRequestsGateway } from "./requests";
import { directScenesGateway } from "./scenes";
import { directStatusGateway } from "./status";
import { directStreamOpsGateway } from "./stream-ops";
import type { AvailableWidget } from "./testing/DirectFakeApi";
import { createDirectHarness, type DirectHarness, renderDirect } from "./testing/direct-harness";
import { directWorkflowsGateway } from "./workflows";

// The namespaces against a fake engine over real capnweb: reads load through
// the cache, engine events and resyncs refresh them, and requests go out on
// the live session.

const harnesses: DirectHarness[] = [];

async function connected(): Promise<DirectHarness> {
  const harness = createDirectHarness();
  harnesses.push(harness);
  await harness.connect();
  return harness;
}

afterEach(async () => {
  for (const harness of harnesses.splice(0)) {
    await harness.runtime.stop();
  }
});

function command(id: string, word: string): CommandSnapshot {
  return {
    id,
    command: word,
    actions: [],
    workflowId: "",
    steps: [],
    workflowError: "",
    cooldown: 0,
    priority: 0,
    enabled: true,
    visibility: "public",
    groupIds: [],
    usernames: [],
    argumentPattern: "",
  };
}

const words = (commands: { command: string }[] | undefined) => commands?.map((c) => c.command);

describe("commands", () => {
  test("reads the engine's commands and reads them again when one is created elsewhere", async () => {
    const { runtime, state, engine } = await connected();
    state.commands = [command("c-1", "hug")];
    const commands = directCommandsGateway(runtime);
    const read = renderDirect(() => commands.useCommands());
    await read.until((value) => value !== undefined, "the commands");
    expect(words(read.current())).toEqual(["hug"]);

    state.commands = [...state.commands, command("c-2", "lurk")];
    await engine.pushEvent(
      makeCallbackEnvelope({ type: EngineEventType.COMMAND_CREATED, command: state.commands[1] }, "engine", "e-1")
    );
    await read.until((value) => value?.length === 2, "the new command");
    expect(words(read.current())).toEqual(["hug", "lurk"]);
    read.unmount();
  });

  test("a create resolves with the engine's id once the list has been read again", async () => {
    const { runtime, state } = await connected();
    const commands = directCommandsGateway(runtime);
    const read = renderDirect(() => commands.useCommands());
    await read.until((value) => value !== undefined, "the commands");
    const create = renderDirect(() => commands.useCreateCommandRequest()).current();

    const created = await create({ command: "hug", enabled: true, cooldown: 0, visibility: "public" });

    expect(created).toEqual({ engineCommandId: "command-1" });
    expect(words(runtime.queryClient.getQueryData(directKeys.commands.list()))).toEqual(["hug"]);
    expect(state.callsOf("createCommand")[0][0]).toMatchObject({ command: "hug" });
    read.unmount();
  });

  test("dropped frames read everything again", async () => {
    const { runtime, state, engine } = await connected();
    state.commands = [command("c-1", "hug")];
    const read = renderDirect(() => directCommandsGateway(runtime).useCommands());
    await read.until((value) => value !== undefined, "the commands");

    state.commands = [];
    engine.dropFrames(1);
    await engine.pushEvent(
      makeCallbackEnvelope(
        { type: EngineEventType.ENGINE_RESPONSE_RECEIVED, correlationKey: "c", status: "success", data: {} },
        "engine",
        "e-2"
      )
    );
    await read.until((value) => value?.length === 0, "the commands read again");
    read.unmount();
  });
});

describe("the scope", () => {
  test("without an instance, reads stay loading and requests reject", async () => {
    const { runtime, state } = await connected();
    const commands = directCommandsGateway(runtime);
    const read = renderDirect(() => commands.useCommands(), null);
    const create = renderDirect(() => commands.useCreateCommandRequest(), null).current();
    const subscribe = renderDirect(() => directEventLogGateway(runtime).useStreamEventsSubscription(), null).current();

    await expect(create({ command: "hug", enabled: true, cooldown: 0, visibility: "public" })).rejects.toBeInstanceOf(
      NoInstanceSelectedError
    );
    expect(() => subscribe(null, () => {})).toThrow(NoInstanceSelectedError);
    expect(read.current()).toBeUndefined();
    expect(state.callsOf("listCommands")).toEqual([]);
    read.unmount();
  });
});

describe("status", () => {
  test("the live state comes from the stream status and the newest session", async () => {
    const { runtime, state, clock } = await connected();
    state.streamStatus = {
      isLive: true,
      uptime: "1m",
      viewerCount: 3,
      startedAt: "2026-10-28T11:00:00Z",
      twitchUserId: "u-1",
    };
    state.sessions = [{ id: "s-1", status: "open", startedAt: "2026-10-28T10:59:00Z", endedAt: null, segments: [] }];
    const read = renderDirect(() => directStatusGateway(runtime).useLiveState());
    const live = await read.until((value) => value !== undefined, "the live state");
    expect(live).toMatchObject({ isLive: true, viewerCount: 3, sessionId: "s-1", lastUpdatedAt: clock.now() });
    read.unmount();
  });

  test("the sync state is kept by a mirror this gateway has none of", async () => {
    const { runtime } = await connected();
    const status = directStatusGateway(runtime);
    const read = renderDirect(() => status.useSyncState());
    expect(read.error()).toBeInstanceOf(GatewayUnsupportedError);
    await expect(renderDirect(() => status.useSyncRequest()).current()()).rejects.toBeInstanceOf(
      GatewayUnsupportedError
    );
  });

  test("a connection test pings the URL it names, and refuses a blank one", async () => {
    const harness = createDirectHarness();
    const test = renderDirect(() => directStatusGateway(harness.runtime).useConnectionTestRequest(), null).current();
    expect(await test("  http://engine.local  ")).toEqual({ ok: true });
    expect(await test(" ")).toEqual({ ok: false, error: "No engine URL provided" });
    expect(harness.pings).toEqual(["http://engine.local"]);
  });
});

describe("alertQueue", () => {
  test("a limit past the engine's range is clamped into it", async () => {
    const { runtime, state } = await connected();
    const read = renderDirect(() => directAlertQueueGateway(runtime).useAlerts(5000));
    await read.until((value) => value !== undefined, "the alerts");
    expect(state.callsOf("listAlerts")).toEqual([[{ limit: 500 }]]);
    read.unmount();
  });
});

describe("eventLog", () => {
  const frame = (type: string): StreamEventFrame => ({ type, source: "twitch", time: "", data: {} });

  test("registers the listeners' types once they settle, and each listener takes its own", async () => {
    const { runtime, state, clock } = await connected();
    const subscribe = renderDirect(() => directEventLogGateway(runtime).useStreamEventsSubscription()).current();
    const follows: string[] = [];
    const everything: string[] = [];
    subscribe(["channel.follow"], (f) => follows.push(f.type));
    subscribe(null, (f) => everything.push(f.type));

    clock.advance(runtime.config.streamRegistrationDelayMs);
    await waitFor(() => state.streamSubscriptions.length === 1, "the registration");
    expect(state.streamSubscriptions[0].types).toEqual(["channel.follow"]);

    await state.pushStreamEvent(frame("channel.follow"));
    await state.pushStreamEvent(frame("channel.cheer"));
    expect(follows).toEqual(["channel.follow"]);
    expect(everything).toEqual(["channel.follow", "channel.cheer"]);
  });

  test("registers again on a new session, which starts with none", async () => {
    const { runtime, state, clock, engine } = await connected();
    const subscribe = renderDirect(() => directEventLogGateway(runtime).useStreamEventsSubscription()).current();
    subscribe(["channel.raid"], () => {});
    clock.advance(runtime.config.streamRegistrationDelayMs);
    await waitFor(() => state.streamSubscriptions.length === 1, "the first registration");

    engine.breakSessions();
    await waitFor(() => runtime.connection.session.state.status === "waiting", "the session to drop");
    clock.advance(runtime.config.session.reconnectMaxMs);
    await waitFor(() => state.streamSubscriptions.length === 2, "the registration on the new session");
    expect(state.streamSubscriptions[1].types).toEqual(["channel.raid"]);
  });

  test("the webhook log is a dashboard's record, which this gateway has none of", async () => {
    const { runtime } = await connected();
    const retrigger = renderDirect(() => directEventLogGateway(runtime).useRetriggerRequest()).current();
    await expect(retrigger("log-1" as never)).rejects.toBeInstanceOf(GatewayUnsupportedError);
  });
});

describe("requests", () => {
  test("a correlated request reads the answer the engine streams back under its key", async () => {
    const { runtime, state, engine } = await connected();
    const requests = directRequestsGateway(runtime);
    const correlated = renderDirect(() => requests.useCorrelated("fieldOptions"));
    correlated.current().start({ moduleId: "m-1", declaration: "setting", fieldId: "f-1" });
    await waitFor(() => state.callsOf("dispatchFieldOptionsRequest").length === 1, "the dispatch");
    const [, key] = state.callsOf("dispatchFieldOptionsRequest")[0] as [unknown, string];
    expect(correlated.current().event).toBeNull();

    await engine.pushEvent(
      makeCallbackEnvelope(
        { type: EngineEventType.ENGINE_RESPONSE_RECEIVED, correlationKey: key, status: "success", data: { n: 1 } },
        "engine",
        "e-3"
      )
    );
    const answered = await correlated.until((value) => value.event != null, "the answer");
    expect(answered.event).toMatchObject({ correlationKey: key, type: "engine.response", data: { n: 1 } });
    correlated.unmount();
  });
});

function libraryAlert(id: string, name: string): AlertComposition {
  return {
    id,
    name,
    description: "",
    widgetsJson: '[{"widgetCanonicalId":"woofx3:widget:text","settings":{"text":{"$input":"who"}}}]',
    layoutJson: '{"width":800}',
    behaviorsJson: "{}",
    inputsJson: '[{"id":"who","label":"Who","type":"text"}]',
    hasDraft: false,
    createdByType: "USER",
    createdByRef: "",
  };
}

function compositionSnapshot(id: string, kind: "scene" | "alert"): SceneSnapshot {
  return {
    id,
    kind,
    name: id,
    description: "",
    widgetsJson: "[]",
    layoutJson: "{}",
    behaviorsJson: "{}",
    inputsJson: "[]",
    createdByType: "USER",
    createdByRef: "",
    createdAt: "",
    updatedAt: "",
  };
}

describe("alertLibrary", () => {
  test("lists the library by name, with the inputs' `$` keys escaped as every gateway serves them", async () => {
    const { runtime, state } = await connected();
    state.alertCompositions = [libraryAlert("a-2", "Raid"), libraryAlert("a-1", "Follow")];
    const read = renderDirect(() => directAlertLibraryGateway(runtime).useAlerts());
    const alerts = await read.until((value) => value !== undefined, "the library");
    expect(alerts?.map((alert) => alert.name)).toEqual(["Follow", "Raid"]);
    expect(alerts?.[0]).toMatchObject({
      engineCompositionId: "a-1",
      description: undefined,
      widgets: [{ widgetCanonicalId: "woofx3:widget:text", settings: { text: { __$input: "who" } } }],
      layout: { width: 800 },
      inputs: [{ id: "who", label: "Who", type: "text" }],
    });
    read.unmount();
  });

  test("a library alert's event reads the library again, and a scene's does not", async () => {
    const { runtime, state, engine } = await connected();
    const read = renderDirect(() => directAlertLibraryGateway(runtime).useAlerts());
    await read.until((value) => value !== undefined, "the library");

    await engine.pushEvent(
      makeCallbackEnvelope(
        { type: EngineEventType.SCENE_UPDATED, scene: compositionSnapshot("s-1", "scene") },
        "engine",
        "e-4"
      )
    );
    state.alertCompositions = [libraryAlert("a-1", "Follow")];
    await engine.pushEvent(
      makeCallbackEnvelope(
        { type: EngineEventType.SCENE_CREATED, scene: compositionSnapshot("a-1", "alert") },
        "engine",
        "e-5"
      )
    );
    await read.until((value) => value?.length === 1, "the new alert");
    expect(state.callsOf("listAlertCompositions")).toHaveLength(2);
    read.unmount();
  });

  test("an engine with no library reads as empty and refuses a new alert", async () => {
    const harness = createDirectHarness();
    harnesses.push(harness);
    harness.engine.capabilities = harness.engine.capabilities.filter(
      (id) => id !== ENGINE_CAPABILITIES.compositionsAlerts
    );
    await harness.connect();
    const library = directAlertLibraryGateway(harness.runtime);
    const read = renderDirect(() => library.useAlerts());
    expect(await read.until((value) => value !== undefined, "the library")).toEqual([]);
    const create = renderDirect(() => library.useCreateRequest()).current();
    await expect(create({ name: "Follow", widgetsJson: "[]", layoutJson: "{}", behaviorsJson: "{}" })).rejects.toThrow(
      "doesn't keep an alert library"
    );
    expect(harness.state.callsOf("listAlertCompositions")).toEqual([]);
    read.unmount();
  });

  test("a preview URL expires when the engine said, counted from before it was asked", async () => {
    const { runtime, state, clock } = await connected();
    state.compositionPreview = { url: "http://scenes.test/preview/composition?token=t", expiresInSeconds: 300 };
    const preview = renderDirect(() => directAlertLibraryGateway(runtime).usePreviewUrlRequest()).current();
    expect(await preview()).toEqual({
      url: "http://scenes.test/preview/composition?token=t",
      expiresAt: clock.now() + 300_000,
    });
  });
});

describe("streamOps", () => {
  const entry = (platformUserId: string, total: number) => ({
    platform: "twitch",
    platformUserId,
    userName: platformUserId,
    total,
    events: 1,
  });

  test("a leaderboard ranks named viewers only, and refuses a stream the engine no longer has", async () => {
    const { runtime, state } = await connected();
    state.leaderboards.bits = [entry("u-1", 500), entry("", 300)];
    state.unknownSessions = ["gone"];
    const leaderboard = renderDirect(() => directStreamOpsGateway(runtime).useSupporterLeaderboardRequest()).current();

    expect(await leaderboard({ metric: "bits", minTotal: 1 })).toEqual([
      { platformUserId: "u-1", userName: "u-1", total: 500, events: 1 },
    ]);
    const gone = await leaderboard({ metric: "bits", minTotal: 1, sessionId: "gone" }).catch((e: Error) => e);
    expect(String(gone)).toContain("no longer exists");
    await expect(leaderboard({ metric: "bits", minTotal: 0 })).rejects.toThrow("at least 1");
    expect(state.callsOf("getLeaderboard")).toHaveLength(2);
  });

  test("a viewer's totals cover their lifetime and the recent streams that went live", async () => {
    const { runtime, state } = await connected();
    const totals = (bits: number, sessionId: string | null) => ({
      platform: "twitch",
      platformUserId: "u-1",
      userName: "Viewer",
      sessionId,
      bits,
      cheers: 1,
      giftedSubs: 0,
      gifts: 0,
    });
    const segment = [{ startedAt: "2026-10-27T10:00:00Z", endedAt: "2026-10-27T11:00:00Z" }];
    state.sessions = [
      { id: "s-2", status: "closed", startedAt: "2026-10-27T10:00:00Z", endedAt: null, segments: segment },
      { id: "s-1", status: "closed", startedAt: "2026-10-26T10:00:00Z", endedAt: null, segments: [] },
    ];
    state.viewerTotals = { "u-1": totals(900, null), "u-1:s-2": totals(100, "s-2") };
    const lookUp = renderDirect(() => directStreamOpsGateway(runtime).useViewerSupportTotalsRequest()).current();

    const answer = await lookUp("u-1");
    expect(answer.userName).toBe("Viewer");
    expect(answer.lifetime).toEqual({ bits: 900, cheers: 1, giftedSubs: 0, gifts: 0 });
    expect(answer.recent.map((row) => [row.stream.id, row.totals.bits])).toEqual([["s-2", 100]]);
  });

  test("a recap of a stream the engine no longer has says so rather than rejecting", async () => {
    const { runtime, state } = await connected();
    state.unknownSessions = ["gone"];
    const detail = renderDirect(() => directStreamOpsGateway(runtime).useRecapEngineDetailRequest()).current();
    expect(await detail("gone")).toEqual({ status: "unknown_session" });
  });

  test("the stored recap summary is a dashboard's record, which this gateway has none of", async () => {
    const { runtime } = await connected();
    const refresh = renderDirect(() => directStreamOpsGateway(runtime).useOpenSessionRefreshRequest()).current();
    await expect(refresh()).rejects.toBeInstanceOf(GatewayUnsupportedError);
  });
});

describe("overlays", () => {
  test("a scene's browser-source URL is made on first ask and the same after that until rotated", async () => {
    const { runtime, state } = await connected();
    const overlays = directOverlaysGateway(runtime);
    const urlOf = renderDirect(() => overlays.useBrowserSourceUrlRequest()).current();
    const rotate = renderDirect(() => overlays.useRotateBrowserSourceUrlRequest()).current();
    const scene = toSceneId("s-1");

    const first = await urlOf(scene);
    expect(await urlOf(scene)).toBe(first);
    expect(state.callsOf("mintOverlayToken")).toHaveLength(1);

    const rotated = await rotate(scene);
    expect(rotated).not.toBe(first);
    expect(await urlOf(scene)).toBe(rotated);
    expect(state.overlayTokens.map((token) => token.status)).toEqual(["revoked", "active"]);
  });
});

const ALERT_WIDGET = "woofx3:widget:alert";

function scene(id: string, widgets: unknown[] = []): SceneSnapshot {
  return {
    ...compositionSnapshot(id, "scene"),
    widgetsJson: JSON.stringify(widgets),
    layoutJson: '{"width":1280}',
    createdAt: "2026-10-28T10:00:00Z",
    updatedAt: "2026-10-28T11:00:00Z",
  };
}

const alertPlacement = (name: string) => ({ widgetCanonicalId: ALERT_WIDGET, settings: { name } });

function widget(manifestId: string, createdByType: string, createdByRef: string, hostsSurface = ""): AvailableWidget {
  return {
    id: `w-${manifestId}`,
    manifestId,
    name: manifestId,
    description: "",
    directory: manifestId,
    alertTypes: [],
    settingsSchema: "[]",
    surfaces: ["scene"],
    hostsSurface,
    taxonomy: [],
    behaviorKinds: { transitions: [], effects: [] },
    createdByType,
    createdByRef,
  };
}

function alertWorkflow(id: string, name: string, target: string): Workflow {
  return {
    id,
    name,
    description: "",
    isEnabled: true,
    definition: {
      id,
      name,
      trigger: { type: "event", event: "channel.follow" },
      tasks: [{ id: "t-1", type: "action", action: "alert", parameters: { target } }],
    },
    stats: { runsToday: 0, successRate: 0 },
    createdAt: "2026-10-28T09:00:00Z",
    updatedAt: "2026-10-28T09:00:00Z",
  };
}

describe("scenes", () => {
  test("reads whole scenes, sized from their layout, and reads them again when one changes", async () => {
    const { runtime, state, engine } = await connected();
    state.scenes = [scene("s-1")];
    const read = renderDirect(() => directScenesGateway(runtime).useScenes());
    const scenes = await read.until((value) => value !== undefined, "the scenes");
    expect(scenes?.[0]).toMatchObject({
      id: toSceneId("s-1"),
      engineSceneId: "s-1",
      width: 1280,
      height: 1080,
      backgroundColor: "transparent",
      updatedAt: Date.parse("2026-10-28T11:00:00Z"),
    });

    state.scenes = [scene("s-1"), scene("s-2")];
    await engine.pushEvent(
      makeCallbackEnvelope({ type: EngineEventType.SCENE_CREATED, scene: state.scenes[1] }, "engine", "e-6")
    );
    await read.until((value) => value?.length === 2, "the new scene");
    read.unmount();
  });

  test("an engine that cannot hand over whole scenes has none to show", async () => {
    const harness = createDirectHarness();
    harnesses.push(harness);
    harness.engine.capabilities = harness.engine.capabilities.filter(
      (id) => id !== ENGINE_CAPABILITIES.scenesSnapshots
    );
    await harness.connect();
    const read = renderDirect(() => directScenesGateway(harness.runtime).useScenes());
    await waitFor(() => read.error() !== undefined, "the read to fail");
    expect(read.error()).toBeInstanceOf(GatewayUnsupportedError);
    expect(harness.state.callsOf("listSceneSnapshots")).toEqual([]);
  });

  test("the widget catalog groups a module's widgets under its name and the engine's own as built in", async () => {
    const { runtime, state } = await connected();
    state.widgets = [
      widget("now_playing", "MODULE", "spotify:1.0.0:abc1234"),
      widget("alert", "SYSTEM", "woofx3", "alert"),
    ];
    state.modules = [
      {
        name: "Spotify",
        version: "1.0.0",
        state: "active",
        createdByType: "USER",
        moduleId: "spotify",
        moduleKey: "spotify:1.0.0:abc1234",
        manifest: null,
      },
    ];
    const read = renderDirect(() => directScenesGateway(runtime).useWidgetCatalog());
    const catalog = await read.until((value) => value !== undefined, "the catalog");
    expect(catalog?.map((row) => [row.widgetId, row.moduleName, row.moduleId])).toEqual([
      ["spotify:widget:now_playing", "Spotify", "spotify"],
      ["woofx3:widget:alert", "Built-in", undefined],
    ]);
    read.unmount();
  });

  test("alert widget names and target usage come from the scenes, commands and every page of workflows", async () => {
    const harness = createDirectHarness({ workflowPageSize: 1 });
    harnesses.push(harness);
    await harness.connect();
    const { runtime, state } = harness;
    state.widgets = [widget("alert", "SYSTEM", "woofx3", "alert")];
    state.scenes = [scene("s-1", [alertPlacement("side")]), scene("s-2", [alertPlacement("default")])];
    state.commands = [
      { ...command("c-1", "hype"), actions: [{ action: "alert", parameters: { target: "side" } }] },
    ] as CommandSnapshot[];
    state.workflows = [alertWorkflow("w-1", "Follow", "default"), alertWorkflow("w-2", "Raid", "side")];
    const scenes = directScenesGateway(runtime);

    const names = renderDirect(() => scenes.useAlertWidgetNames());
    expect(await names.until((value) => value !== undefined, "the names")).toEqual(["default", "side"]);

    const usage = renderDirect(() => scenes.useAlertTargetUsage("s-1"));
    const answer = await usage.until((value) => value !== undefined, "the usage");
    expect(answer).toEqual({
      alertWidgetIds: [ALERT_WIDGET],
      elsewhere: ["default"],
      uses: [
        { target: "default", kind: "workflow", name: "Follow" },
        { target: "side", kind: "workflow", name: "Raid" },
        { target: "side", kind: "command", name: "!hype" },
      ],
    });
    expect(state.callsOf("getWorkflows")).toHaveLength(3);
    names.unmount();
    usage.unmount();
  });

  test("a preview of a scene the engine does not have is null, and mints nothing", async () => {
    const { runtime, state } = await connected();
    const preview = renderDirect(() => directOverlaysGateway(runtime).usePreviewUrlRequest()).current();
    expect(await preview(toSceneId("missing"))).toBeNull();
    expect(state.callsOf("mintOverlayToken")).toEqual([]);
  });
});

describe("workflows", () => {
  test("reads every page of workflows with their `$` keys escaped, and reads them again when one changes", async () => {
    const harness = createDirectHarness({ workflowPageSize: 1 });
    harnesses.push(harness);
    await harness.connect();
    const { runtime, state, engine } = harness;
    state.workflows = [alertWorkflow("w-1", "Follow", "default"), alertWorkflow("w-2", "Raid", "side")];
    const workflows = directWorkflowsGateway(runtime);
    const read = renderDirect(() => workflows.useWorkflows());
    const hasAny = renderDirect(() => workflows.useHasAny());
    const listed = await read.until((value) => value?.length === 2, "the workflows");
    expect(listed?.map((w) => w.engineWorkflowId)).toEqual(["w-1", "w-2"]);
    expect(await hasAny.until((value) => value !== undefined, "whether any exist")).toBe(true);

    state.workflows = [state.workflows[0]];
    await engine.pushEvent(
      makeCallbackEnvelope({ type: EngineEventType.WORKFLOW_DELETED, workflowId: "w-2" }, "engine", "e-7")
    );
    await read.until((value) => value?.length === 1, "the list read again");
    read.unmount();
    hasAny.unmount();
  });

  test("a new workflow goes out with its `$` keys unescaped and resolves with the engine's id", async () => {
    const { runtime, state } = await connected();
    const create = renderDirect(() => directWorkflowsGateway(runtime).useCreateRequest()).current();
    const created = await create({
      name: "Follow",
      trigger: { type: "event", event: "channel.follow", __$ref: "woofx3:trigger:follow" },
      tasks: [],
    });
    expect(created).toEqual({ engineWorkflowId: "workflow-1" });
    const sent = state.callsOf("createWorkflow")[0][0] as { definition: { trigger: Record<string, unknown> } };
    expect(sent.definition.trigger).toHaveProperty("$ref", "woofx3:trigger:follow");
  });

  test("a manual run carries the key it resolves with and says the run was not recorded by default", async () => {
    const { runtime, state } = await connected();
    state.workflows = [alertWorkflow("w-1", "Follow", "default")];
    const trigger = renderDirect(() => directWorkflowsGateway(runtime).useTriggerRequest()).current();
    const result = await trigger({ workflowNameOrId: "w-1", options: { dryRun: true } });
    const [name, , , triggerId, origin, options] = state.callsOf("triggerWorkflowByName")[0];
    expect([name, triggerId, origin, options]).toEqual(["w-1", result.triggerId, "dashboard", { dryRun: true }]);
    expect(result).toMatchObject({ status: "started", executionId: "exec-w-1", dryRun: true, optionsIgnored: false });
  });

  test("the options probe names a workflow nobody has, and an engine that cannot find it takes no options", async () => {
    const { runtime, state } = await connected();
    const probe = renderDirect(() => directWorkflowsGateway(runtime).useTestRunCapabilitiesRequest()).current();
    expect(await probe()).toEqual({ options: "unsupported" });
    expect(state.workflows).toEqual([]);
  });

  test("a workflow's run history is newest first, its limit clamped into the engine's range", async () => {
    const { runtime, state } = await connected();
    const snapshot = (id: string, workflowId: string) => ({
      id,
      workflowId,
      status: "completed",
      triggerEvent: "{}",
      createdAt: "2026-10-28T10:00:00Z",
      updatedAt: "2026-10-28T10:00:00Z",
    });
    state.runSnapshots = [snapshot("run-2", "w-1"), snapshot("run-x", "w-2"), snapshot("run-1", "w-1")];
    const read = renderDirect(() => directWorkflowsGateway(runtime).useRuns("w-1", 10_000));
    const runs = await read.until((value) => value !== undefined, "the runs");
    expect(runs?.map((run) => [run.engineRunId, run.hasTriggerEvent])).toEqual([
      ["run-2", true],
      ["run-1", true],
    ]);
    expect(state.callsOf("listWorkflowRunSnapshots")).toEqual([[{ workflowId: "w-1", limit: 200 }]]);
    read.unmount();
  });

  test("lists the health errors of enabled workflows only", async () => {
    const { runtime, state } = await connected();
    state.workflows = [
      alertWorkflow("w-1", "Follow", "default"),
      { ...alertWorkflow("w-2", "Raid", "side"), isEnabled: false },
    ];
    state.workflowHealth = [
      { workflowId: "w-1", status: "error", reason: "bad trigger", since: "2026-10-28T10:00:00Z" },
      { workflowId: "w-2", status: "error", reason: "bad trigger", since: "2026-10-28T10:00:00Z" },
    ];
    const read = renderDirect(() => directWorkflowsGateway(runtime).useNotRunning());
    expect(await read.until((value) => value !== undefined, "the health")).toEqual([
      { engineWorkflowId: "w-1", reason: "bad trigger", since: "2026-10-28T10:00:00Z" },
    ]);
    read.unmount();
  });

  test("a health resync is throttled, and an engine still loading neither fails nor holds the throttle", async () => {
    const { runtime, state, clock } = await connected();
    const resync = renderDirect(() => directWorkflowsGateway(runtime).useHealthResyncRequest()).current();
    state.workflowHealth = new Error(HEALTH_STILL_LOADING_MESSAGE);
    expect(await resync("mount")).toBe("loading");

    state.workflowHealth = [];
    expect(await resync("mount")).toBe("ok");
    expect(await resync("mount")).toBe("skipped");
    clock.advance(RESYNC_MIN_INTERVAL_MS.mount);
    expect(await resync("mount")).toBe("ok");
  });

  test("pushes each run as it starts and settles, named after its workflow, keeping its start", async () => {
    const { runtime, state, engine } = await connected();
    state.workflows = [alertWorkflow("w-1", "Follow", "default")];
    const workflows = directWorkflowsGateway(runtime);
    const list = renderDirect(() => workflows.useWorkflows());
    await list.until((value) => value !== undefined, "the workflows");
    const subscribe = renderDirect(() => workflows.useRunsSubscription()).current();
    const runs: WorkflowRun[] = [];
    const unsubscribe = subscribe((run) => runs.push(run));

    const run = { workflowId: "w-1", executionId: "run-1" };
    await engine.pushEvent(
      makeCallbackEnvelope(
        { type: EngineEventType.WORKFLOW_RUN_STARTED, ...run, occurredAt: "2026-10-28T10:00:00Z" },
        "engine",
        "e-8"
      )
    );
    await engine.pushEvent(
      makeCallbackEnvelope(
        { type: EngineEventType.WORKFLOW_RUN_COMPLETED, ...run, occurredAt: "2026-10-28T10:00:05Z" },
        "engine",
        "e-9"
      )
    );
    await waitFor(() => runs.length === 2, "both reports");
    expect(runs.map((r) => [r.workflowName, r.status, r.startedAt.toISOString()])).toEqual([
      ["Follow", "running", "2026-10-28T10:00:00.000Z"],
      ["Follow", "completed", "2026-10-28T10:00:00.000Z"],
    ]);
    unsubscribe();
    list.unmount();
  });
});
