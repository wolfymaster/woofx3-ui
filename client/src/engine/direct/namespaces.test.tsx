import { afterEach, describe, expect, test } from "bun:test";
import { AD_SCOPE_MISSING_MESSAGE } from "@shared/ad-breaks";
import { missingTwitchScopeMessage, TWITCH_NOT_CONNECTED_MESSAGE } from "@shared/twitch-link-refusal";
import { HEALTH_STILL_LOADING_MESSAGE, RESYNC_MIN_INTERVAL_MS } from "@shared/workflow-health";
import {
  type AlertComposition,
  type CommandSnapshot,
  ENGINE_CAPABILITIES,
  EngineEventType,
  makeCallbackEnvelope,
  type SceneSnapshot,
  type StreamEventFrame,
  type TwitchHelixResult,
  type Workflow,
} from "@woofx3/api";
import { GatewayUnsupportedError } from "@/engine/errors";
import { NoInstanceSelectedError } from "@/engine/scope";
import type { WorkflowRun } from "@/engine/types";
import { waitFor } from "@/lib/engine-session/testing/wait-for";
import { directAdBreaksGateway } from "./ad-breaks";
import { directAlertLibraryGateway } from "./alert-library";
import { directAlertQueueGateway } from "./alert-queue";
import { directClipsGateway } from "./clips";
import { directCommandsGateway } from "./commands";
import { directEventLogGateway } from "./event-log";
import { toModuleId, toSceneId } from "./ids";
import { directKeys } from "./keys";
import { directMarketplaceGateway } from "./marketplace";
import { directModerationGateway } from "./moderation";
import { directModuleResourcesGateway } from "./module-resources";
import { directModulesGateway } from "./modules";
import { directOverlaysGateway } from "./overlays";
import { directPageIntrosGateway } from "./page-intros";
import { directPinsGateway } from "./pins";
import { directRequestsGateway } from "./requests";
import { directScenesGateway } from "./scenes";
import { directStatusGateway } from "./status";
import { directStreamInfoGateway } from "./stream-info";
import { directStreamOpsGateway } from "./stream-ops";
import type { AvailableWidget, FakeEngineState, TwitchFakeMethod } from "./testing/DirectFakeApi";
import { createDirectHarness, type DirectHarness, renderDirect } from "./testing/direct-harness";
import { directTwitchChatGateway } from "./twitch-chat";
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
  test("a widget's themes are read once, again after a module install, and a failure reads as unavailable", async () => {
    const { runtime, state, engine } = await connected();
    const theme = {
      id: "cozy:theme:warm",
      name: "Warm",
      description: "",
      moduleId: "cozy",
      moduleVersion: "1.0.0",
      contractVersion: 1,
      compatible: true,
      previewUrl: null,
    };
    state.widgetThemes = { "woofx3:widget:alert": [] };
    const scenes = directScenesGateway(runtime);
    const read = renderDirect(() => scenes.useWidgetThemes("woofx3:widget:alert"));
    expect(await read.until((value) => value !== undefined, "the themes")).toEqual({ status: "loaded", themes: [] });

    state.widgetThemes = { "woofx3:widget:alert": [theme] };
    await engine.pushEvent(
      makeCallbackEnvelope(
        {
          type: EngineEventType.MODULE_INSTALLED,
          modulePrefix: "cozy",
          moduleName: "Cozy",
          version: "1.0.0",
          moduleKey: "cozy:1.0.0:abc1234",
        },
        "engine",
        "e-themes"
      )
    );
    await read.until((value) => value?.status === "loaded" && value.themes.length === 1, "the new theme");
    expect(state.callsOf("listWidgetThemes")).toHaveLength(2);
    read.unmount();

    const missing = renderDirect(() => scenes.useWidgetThemes("nope"));
    expect(await missing.until((value) => value !== undefined, "the refusal")).toEqual({ status: "unavailable" });
    missing.unmount();
  });

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
    expect(result).toMatchObject({ status: "started", executionId: "exec-w-1", dryRun: true });
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

describe("moduleResources", () => {
  const resource = (moduleName: string, kind: string, instanceId: string) => ({
    id: `row-${moduleName}-${instanceId}`,
    moduleId: "uuid",
    moduleName,
    kind,
    instanceId,
    displayName: instanceId,
    canonicalId: `${moduleName}:${kind}:${instanceId}`,
    moduleKey: `${moduleName}:1.0.0:abc`,
    settings: {},
  });
  const declaring = (moduleId: string, kinds: string[]) => ({
    name: moduleId,
    version: "1.0.0",
    state: "active",
    createdByType: "USER",
    moduleId,
    moduleKey: `${moduleId}:1.0.0:abc`,
    manifest: { id: moduleId, resources: kinds.map((kind) => ({ kind, name: kind, description: "", schema: [] })) },
  });

  test("a bare kind means the one module declaring it; a qualified kind names its module", async () => {
    const { runtime, state } = await connected();
    state.modules = [declaring("counter", ["counter"]), declaring("other", ["timer"])];
    state.resourceInstances = [
      resource("counter", "counter", "deaths"),
      resource("other", "counter", "stray"),
      resource("other", "timer", "break"),
    ];
    const resources = directModuleResourcesGateway(runtime);
    const bare = renderDirect(() => resources.useKindInstances("counter"));
    const several = renderDirect(() => resources.useKindsInstances(["other:timer", "counter", "counter"]));
    const ids = (value: { canonicalId: string }[] | undefined) => value?.map((row) => row.canonicalId);
    expect(ids(await bare.until((value) => value !== undefined, "one kind"))).toEqual(["counter:counter:deaths"]);
    expect(ids(await several.until((value) => value !== undefined, "several kinds"))).toEqual([
      "counter:counter:deaths",
      "other:timer:break",
    ]);
    expect(state.callsOf("listAllResourceInstances")).toHaveLength(1);
    bare.unmount();
    several.unmount();
  });

  test("a value written under its storage key is read again, and any other key is ignored", async () => {
    const { runtime, state, engine } = await connected();
    state.resourceInstances = [resource("counter", "counter", "deaths")];
    state.resourceValues = { "counter:counter:deaths": { value: 1 } };
    const read = renderDirect(() => directModuleResourcesGateway(runtime).useValues());
    expect(await read.until((value) => value !== undefined, "the values")).toEqual({
      "counter:counter:deaths": { value: 1 },
    });

    const storage = (key: string, id: string) =>
      makeCallbackEnvelope(
        { type: EngineEventType.MODULE_STORAGE_CHANGED, moduleId: "counter", key, value: 2, occurredAt: "" },
        "engine",
        id
      );
    await engine.pushEvent(storage("settings:theme", "e-10"));
    state.resourceValues = { "counter:counter:deaths": { value: 2 } };
    await engine.pushEvent(storage("state:counter:counter:deaths", "e-11"));
    await read.until((value) => (value?.["counter:counter:deaths"] as { value: number })?.value === 2, "the new value");
    expect(state.callsOf("getResourceValues")).toHaveLength(2);
    read.unmount();
  });

  test("actions run on the engine with their `$` keys unescaped, as a dashboard's own run", async () => {
    const { runtime, state } = await connected();
    const run = renderDirect(() => directModuleResourcesGateway(runtime).useRunActionsRequest()).current();
    await run("+1", [{ action: "counter.increment", parameters: { by: { __$expr: "1" } } }]);
    expect(state.callsOf("runActions")[0][0]).toEqual({
      label: "+1",
      actions: [{ action: "counter.increment", parameters: { by: { $expr: "1" } } }],
      event: { type: "dashboard.action", source: "dashboard", data: {} },
    });
    await expect(run("nothing", [])).rejects.toThrow("no actions");
  });

  test("a module's instances are read by the key it is installed under", async () => {
    const { runtime, state } = await connected();
    state.modules = [declaring("counter", ["counter"])];
    state.resourceInstances = [resource("counter", "counter", "deaths")];
    const sync = renderDirect(() => directModuleResourcesGateway(runtime).useSyncModuleRequest()).current();
    expect(await sync("counter" as never)).toEqual({ itemsProcessed: 1 });
    expect(state.callsOf("listResourceInstancesForModule")).toEqual([["counter:1.0.0:abc", "counter"]]);
    const missing = await sync("missing" as never).catch((error: Error) => error);
    expect(String(missing)).toContain("No installed module");
  });
});

describe("modules", () => {
  const installed = (moduleId: string, manifest: Record<string, unknown>, listingId?: string) => ({
    name: `${moduleId} module`,
    version: "1.0.0",
    state: "active",
    createdByType: "USER",
    moduleId,
    moduleKey: `${moduleId}:1.0.0:abc1234`,
    manifest,
    ...(listingId ? { marketplaceListingId: listingId } : {}),
  });
  const inspection = (listingId: string, permissions: string[]) => ({
    listingId,
    moduleId: listingId,
    edition: 1,
    type: "module" as const,
    name: listingId,
    version: "2.0.0",
    moduleKey: `${listingId}:2.0.0:def5678`,
    sha256: "",
    sizeBytes: 1,
    manifest: { id: listingId, name: listingId, version: "2.0.0", description: "" },
    permissions,
    localEndpoints: [
      { id: "obs", name: "OBS", protocol: "websocket" },
      { id: "pigeon", name: "Pigeon", protocol: "carrier-pigeon" },
    ],
    files: [{ path: "manifest.json", size: 10, kind: "text" as const }],
  });

  test("the installed list says where each module came from, and follows installs", async () => {
    const { runtime, state, engine } = await connected();
    state.modules = [
      { ...installed("woofx3", { id: "woofx3" }), createdByType: "SYSTEM" },
      installed("cozy", { id: "cozy", description: "Warm", tags: ["chat"], author: "Ana" }, "cozy-v2"),
      { ...installed("mine", { id: "mine" }), uploadResourceId: "res-1" },
    ];
    const read = renderDirect(() => directModulesGateway(runtime).useInstalled());
    const modules = await read.until((value) => value !== undefined, "the installed modules");
    expect(modules?.map((module) => [module.id, module.provenance, module.status])).toEqual([
      ["woofx3", "builtIn", "installed"],
      ["cozy", "marketplace", "installed"],
      ["mine", "uploaded", "installed"],
    ]);
    expect(modules?.[1]).toMatchObject({
      name: "cozy module",
      description: "Warm",
      tags: ["chat"],
      author: "Ana",
      moduleKey: "cozy:1.0.0:abc1234",
      marketplaceListingId: "cozy-v2",
    });

    state.modules = [...state.modules, installed("fresh", { id: "fresh" })];
    await engine.pushEvent(
      makeCallbackEnvelope(
        {
          type: EngineEventType.MODULE_INSTALLED,
          modulePrefix: "fresh",
          moduleName: "fresh module",
          version: "1.0.0",
          moduleKey: "fresh:1.0.0:abc1234",
        },
        "engine",
        "e-installed"
      )
    );
    await read.until((value) => value?.length === 4, "the newly installed module");
    read.unmount();
  });

  test("an installed module's detail is what it registered, with its listing's readme and newer build", async () => {
    const { runtime, state } = await connected();
    state.modules = [
      installed("cozy", { id: "cozy", description: "Warm", author: "Ana", permissions: ["chat.read"] }, "cozy-listing"),
    ];
    state.workflowCatalog = {
      triggers: [
        {
          id: "t-1",
          name: "Cozied",
          description: "",
          event: "cozy.cozied",
          createdByType: "MODULE",
          createdByRef: "cozy:1.0.0:abc1234",
        },
        {
          id: "t-2",
          name: "Other",
          description: "",
          event: "x",
          createdByType: "MODULE",
          createdByRef: "other:1.0.0:abc",
        },
      ],
      actions: [],
      functions: [],
    } as never;
    state.listings = {
      "cozy-listing": { listing: { id: "cozy-listing", version: "2.0.0", module: { readme: "# Cozy" } } },
    };
    state.inspections = { "cozy-listing": inspection("cozy-listing", ["chat.read", "chat.write"]) };
    const detail = await renderDirect(() => directModulesGateway(runtime).useDetailRequest()).current()("cozy");
    expect(detail).toMatchObject({
      id: "cozy-listing",
      moduleDbId: "cozy",
      description: "Warm",
      author: "Ana",
      isInstalled: true,
      readme: "# Cozy",
      latestVersion: "2.0.0",
      permissions: ["chat.read"],
      latestPermissions: ["chat.read", "chat.write"],
      latestLocalEndpoints: [{ id: "obs", name: "OBS", protocol: "websocket" }],
    });
    expect(detail.triggers.map((t) => t.name)).toEqual(["Cozied"]);
  });

  test("a listing's detail says its permissions are unknown when the engine cannot inspect it", async () => {
    const { runtime, state } = await connected();
    state.listings = {
      paid: {
        listing: {
          id: "paid",
          name: "Paid",
          version: "1.0.0",
          module: { readme: "# Paid", triggers: [{ id: "paid.tipped", name: "Tipped", description: "" }] },
        },
      },
    };
    const detail = await renderDirect(() => directModulesGateway(runtime).useDetailRequest()).current()("paid");
    expect(detail).toMatchObject({
      id: "paid",
      name: "Paid",
      version: "1.0.0",
      readme: "# Paid",
      isInstalled: false,
      permissions: null,
      localEndpoints: null,
    });
    expect(detail.triggers).toMatchObject([{ key: "paid.tipped", name: "Tipped" }]);
  });

  test("only declared settings are read, and only declared settings are written", async () => {
    const { runtime, state } = await connected();
    state.modules = [installed("cozy", { id: "cozy", settings: [{ id: "color", label: "Color", type: "string" }] })];
    state.moduleSettings = {
      cozy: [
        { id: "1", moduleId: "cozy", key: "color", value: "red", valueType: "string" },
        { id: "2", moduleId: "cozy", key: "oauth:twitch:access_token", value: "secret", valueType: "string" },
      ],
    };
    const modules = directModulesGateway(runtime);
    const settings = await renderDirect(() => modules.useSettingsRequest()).current()("cozy");
    expect(settings.map((s) => s.key)).toEqual(["color"]);
    const update = renderDirect(() => modules.useUpdateSettingRequest()).current();
    expect((await update("cozy", "color", "blue")).value).toBe("blue");
    const refused = await update("cozy", "oauth:twitch:access_token", "x").catch((error: Error) => error);
    expect(String(refused)).toContain('no setting "oauth:twitch:access_token"');
    expect(state.callsOf("updateModuleSetting")).toEqual([["cozy", "color", "blue"]]);
  });

  test("an installed module's files come from the engine, a listing's from its inspection", async () => {
    const { runtime, state } = await connected();
    state.modules = [installed("cozy", { id: "cozy" })];
    state.moduleFiles = { cozy: { available: true, files: [{ path: "main.lua", size: 3 }] } };
    state.inspections = { fresh: inspection("fresh", []) };
    const modules = directModulesGateway(runtime);
    const files = renderDirect(() => modules.useFilesRequest()).current();
    expect(await files("cozy")).toEqual({ available: true, files: [{ path: "main.lua", size: 3 }] });
    expect(await files("fresh")).toEqual({ available: true, files: [{ path: "manifest.json", size: 10 }] });
    const read = renderDirect(() => modules.useFileRequest()).current();
    expect(await read("cozy", "main.lua")).toMatchObject({ kind: "text", content: "cozy/main.lua" });
    expect(String(await read("fresh", "manifest.json").catch((error: Error) => error))).toContain("Install the module");
  });

  test("uninstall asks by install key, and reconciling clears what a finished uninstall left cached", async () => {
    const { runtime, state } = await connected();
    state.modules = [installed("cozy", { id: "cozy" })];
    const modules = directModulesGateway(runtime);
    const uninstall = renderDirect(() => modules.useUninstallRequest()).current();
    expect(await uninstall(toModuleId("cozy"))).toEqual({ moduleKey: "cozy:1.0.0:abc1234" });
    expect(state.callsOf("uninstallModule")).toEqual([["cozy:1.0.0:abc1234"]]);

    const reconcile = renderDirect(() => modules.useReconcileUninstallRequest()).current();
    expect(await reconcile(toModuleId("cozy"), "cozy:1.0.0:abc1234")).toEqual({ stillInstalled: true });
    state.modules = [];
    runtime.queryClient.setQueryData(directKeys.moduleResources.instances(), []);
    expect(await reconcile(toModuleId("cozy"), "cozy:1.0.0:abc1234")).toEqual({ stillInstalled: false });
    expect(runtime.queryClient.getQueryState(directKeys.moduleResources.instances())?.isInvalidated).toBe(true);
  });

  test("a marketplace install sends the approvals and explains a refusal", async () => {
    const { runtime, state } = await connected();
    const install = renderDirect(() => directModulesGateway(runtime).useMarketplaceInstallRequest()).current();
    expect(await install("listing", ["chat.read"], ["obs"])).toEqual({ moduleKey: "listing:1.0.0:abc1234" });
    expect(state.callsOf("installMarketplaceListing")).toEqual([
      ["listing", { approvedPermissions: ["chat.read"], approvedLocalEndpoints: ["obs"] }],
    ]);

    state.listingInstall = {
      status: "needs_approval",
      name: "Cozy",
      version: "2.0.0",
      unapproved: ["chat.write"],
      unapprovedLocalEndpoints: ["obs"],
    };
    expect(String(await install("listing", [], []).catch((error: Error) => error))).toContain(
      "(chat.write, local endpoint obs)"
    );
    state.listingInstall = { status: "payment_required", name: "Cozy", version: "2.0.0" };
    expect(String(await install("listing", [], []).catch((error: Error) => error))).toContain("Sign in");
  });

  test("a bundle install answers with what it made, and a paid bundle asks for a sign-in", async () => {
    const { runtime, state } = await connected();
    const install = renderDirect(() => directModulesGateway(runtime).useBundleInstallRequest()).current();
    expect(await install("bundle")).toEqual({ kind: "scene", engineId: "scene-1" });
    state.bundleInstall = { status: "payment_required", name: "Glow", version: "1.0.0" };
    expect(String(await install("bundle").catch((error: Error) => error))).toContain("Sign in");
  });

  test("no storage limit applies, and archive installs are not available yet", async () => {
    const { runtime } = await connected();
    const modules = directModulesGateway(runtime);
    expect(await renderDirect(() => modules.useStorageUsageRequest()).current()()).toBeNull();
    const archive = await renderDirect(() => modules.useArchiveInstallRequest())
      .current()({} as never)
      .catch((error: Error) => error);
    expect(archive).toBeInstanceOf(GatewayUnsupportedError);
  });
});

describe("marketplace", () => {
  const listing = (id: string, overrides: Record<string, unknown> = {}) => ({
    id,
    type: "module",
    name: `${id} listing`,
    description: "",
    version: "1.0.0",
    author: "Ana",
    authorSlug: "ana",
    category: "Utilities",
    tags: [],
    images: {},
    tier: "public",
    pricing: { mode: "free", currency: "usd" },
    edition: 1,
    credits: [],
    ...overrides,
  });

  test("a search is sent as the marketplace names it, unbought, and parsed as the marketplace's own answer", async () => {
    const { runtime, state } = await connected();
    state.catalogSearch = () => ({ listings: [listing("cozy"), { id: "broken" }], total: 2 });
    const search = renderDirect(() => directMarketplaceGateway(runtime).useSearchRequest()).current();
    const page = await search({ query: "co", types: ["module", "theme"], featured: false, sort: "newest", limit: 24 });
    expect(page.listings.map((l) => l.id)).toEqual(["cozy"]);
    expect(page.total).toBe(2);
    expect(state.callsOf("marketplaceSearch")).toEqual([
      [
        {
          q: "co",
          type: ["module", "theme"],
          category: undefined,
          featured: undefined,
          sort: "newest",
          limit: 24,
          offset: undefined,
        },
        undefined,
      ],
    ]);
  });

  test("a listing the marketplace does not have reads as null, and any other refusal says why", async () => {
    const { runtime, state } = await connected();
    state.listings = { cozy: { listing: listing("cozy", { module: { readme: "# Cozy" } }) } };
    const read = renderDirect(() => directMarketplaceGateway(runtime).useListingRequest()).current();
    expect(await read("cozy")).toMatchObject({ id: "cozy", name: "cozy listing", module: { readme: "# Cozy" } });
    expect(await read("gone")).toBeNull();
    expect(state.callsOf("marketplaceGetListing")).toEqual([
      ["cozy", undefined],
      ["gone", undefined],
    ]);

    state.catalogCounts = { refusedWith: 503 };
    const counts = renderDirect(() => directMarketplaceGateway(runtime).useCountsRequest()).current();
    expect(String(await counts().catch((error: Error) => error))).toBe("Error: Refused with 503");
  });

  test("counts read as null from a marketplace that cannot count", async () => {
    const { runtime, state } = await connected();
    const counts = renderDirect(() => directMarketplaceGateway(runtime).useCountsRequest()).current();
    state.catalogCounts = { counts: { module: 3, theme: 1 }, total: 4 };
    expect(await counts()).toEqual({ module: 3, theme: 1, emote: 0, overlay: 0, alert: 0 });
    state.catalogCounts = { refusedWith: 404 };
    expect(await counts()).toBeNull();
  });

  test("an author's page is read a page at a time, and an unknown author reads as null", async () => {
    const { runtime, state } = await connected();
    state.authors = {
      ana: (query) => ({ author: { slug: "ana", claimed: false }, listings: [listing("cozy")], total: 3, ...query }),
    };
    const read = renderDirect(() => directMarketplaceGateway(runtime).useAuthorRequest()).current();
    const page = await read("ana", { limit: 1, offset: 2 });
    expect(page?.author.slug).toBe("ana");
    expect(page?.listings.map((l) => l.id)).toEqual(["cozy"]);
    expect(state.callsOf("marketplaceGetAuthor")).toEqual([["ana", { limit: 1, offset: 2 }, undefined]]);
    expect(await read("nobody", { limit: 1, offset: 0 })).toBeNull();
  });

  test("quotes, entitlements and checkout need an account", async () => {
    const { runtime } = await connected();
    const marketplace = directMarketplaceGateway(runtime);
    const refusals = await Promise.all([
      renderDirect(() => marketplace.useQuoteRequest())
        .current()("cozy")
        .catch((error: Error) => error),
      renderDirect(() => marketplace.useEntitlementsRequest())
        .current()()
        .catch((error: Error) => error),
      renderDirect(() => marketplace.useCheckoutRequest())
        .current()("cozy", "/")
        .catch((error: Error) => error),
    ]);
    for (const refusal of refusals) {
      expect(refusal).toBeInstanceOf(GatewayUnsupportedError);
    }
  });
});

/** Links the fake engine to the broadcaster `b-1` with `scopes`. */
function linkTwitch(state: FakeEngineState, scopes: string[]): void {
  state.twitchLink = {
    linked: true,
    revision: 2,
    userId: "b-1",
    login: "streamer",
    displayName: "Streamer",
    profileImageUrl: null,
    scopes,
    expiresAt: null,
    authFailedAt: null,
  };
}

/** Answers each Twitch method from `answers`; a method not there fails the call. */
function answerTwitch(
  state: FakeEngineState,
  answers: Partial<Record<TwitchFakeMethod, (params: unknown) => TwitchHelixResult>>
): void {
  state.twitchAnswer = (method, params) =>
    answers[method]?.(params) ?? { ok: false, code: "failed", error: `unexpected ${method}` };
}

const ok = (body: unknown): TwitchHelixResult => ({ ok: true, body });
const refused = (status: number, message: string): TwitchHelixResult => ({
  ok: false,
  code: "helix",
  error: message,
  status,
  body: JSON.stringify({ error: "Bad Request", status, message }),
});

const failure = (promise: Promise<unknown>): Promise<unknown> =>
  promise.then(
    () => null,
    (error: unknown) => error
  );
const twitchCalls = (state: FakeEngineState) =>
  state.calls.map((call) => call.method).filter((method) => method.startsWith("twitch"));

describe("adBreaks", () => {
  test("reads the schedule against the gateway's clock, and snoozes", async () => {
    const { runtime, state, clock } = await connected();
    linkTwitch(state, ["channel:read:ads", "channel:manage:ads"]);
    answerTwitch(state, {
      twitchGetAdSchedule: () =>
        ok({
          data: [
            {
              next_ad_at: 1_790_000_000,
              last_ad_at: 0,
              duration: 90,
              preroll_free_time: 600,
              snooze_count: 2,
              snooze_refresh_at: "",
            },
          ],
        }),
      twitchSnoozeNextAd: () => ok({ data: [{ snooze_count: 1, snooze_refresh_at: 0, next_ad_at: 1_790_000_300 }] }),
    });
    const ads = directAdBreaksGateway(runtime);
    const schedule = await renderDirect(() => ads.useScheduleRequest()).current()();
    expect(schedule).toEqual({
      nextAdAt: new Date(1_790_000_000_000).toISOString(),
      lastAdAt: null,
      durationSeconds: 90,
      prerollFreeSeconds: 600,
      snoozeCount: 2,
      snoozeRefreshAt: null,
      serverNow: new Date(clock.now()).toISOString(),
    });
    expect((await renderDirect(() => ads.useSnoozeRequest()).current()()).snoozeCount).toBe(1);
  });

  test("a link without the ads scope asks for a reconnect before calling Twitch", async () => {
    const { runtime, state } = await connected();
    linkTwitch(state, ["channel:read:ads"]);
    const snooze = renderDirect(() => directAdBreaksGateway(runtime).useSnoozeRequest()).current();
    const error = await failure(snooze());
    expect(String(error)).toContain(AD_SCOPE_MISSING_MESSAGE);
    expect(twitchCalls(state)).toEqual([]);
  });

  test("a snooze Twitch refuses shows Twitch's reason", async () => {
    const { runtime, state } = await connected();
    linkTwitch(state, ["channel:manage:ads"]);
    answerTwitch(state, { twitchSnoozeNextAd: () => refused(429, "no snoozes left") });
    const snooze = renderDirect(() => directAdBreaksGateway(runtime).useSnoozeRequest()).current();
    expect(String(await failure(snooze()))).toContain("no snoozes left");
  });
});

describe("moderation", () => {
  const ALL = [
    "moderator:manage:blocked_terms",
    "moderator:manage:banned_users",
    "moderator:manage:chat_settings",
    "moderator:read:chat_settings",
  ];

  test("access follows the link's scopes, and is read again when the link changes", async () => {
    const { runtime, state, engine } = await connected();
    const moderation = directModerationGateway(runtime);
    const read = renderDirect(() => moderation.useAccess());
    await read.until((value) => value !== undefined, "the access");
    expect(read.current()?.ban).toBe("not-linked");

    linkTwitch(state, ["moderator:manage:banned_users"]);
    await engine.pushEvent(
      makeCallbackEnvelope(
        { type: EngineEventType.TWITCH_LINK_CHANGED, revision: 2, linked: true, userId: "b-1", authFailedAt: null },
        "engine",
        "e-1"
      )
    );
    await read.until((value) => value?.ban === "ready", "the new link");
    expect(read.current()).toEqual({
      addBlockedTerm: "needs-reconnect",
      removeBlockedTerm: "needs-reconnect",
      timeout: "ready",
      ban: "ready",
      chatSettings: "needs-reconnect",
    });
    read.unmount();
  });

  test("lists every page of blocked terms, and adds and removes one", async () => {
    const { runtime, state } = await connected();
    linkTwitch(state, ALL);
    answerTwitch(state, {
      twitchGetBlockedTerms: (params) =>
        (params as { after?: string }).after === undefined
          ? ok({ data: [{ id: "t-1", text: "spam" }], pagination: { cursor: "next" } })
          : ok({ data: [{ id: "t-2", text: "scam", expires_at: "2026-11-01T00:00:00Z" }], pagination: {} }),
      twitchAddBlockedTerm: () => ok({ data: [{ id: "t-3", text: "bots" }] }),
      twitchRemoveBlockedTerm: () => ok(null),
    });
    const moderation = directModerationGateway(runtime);
    expect(await renderDirect(() => moderation.useBlockedTermsRequest()).current()()).toEqual({
      terms: [
        { id: "t-1", text: "spam", createdAt: null, expiresAt: null },
        { id: "t-2", text: "scam", createdAt: null, expiresAt: "2026-11-01T00:00:00Z" },
      ],
      truncated: false,
    });
    expect(state.callsOf("twitchGetBlockedTerms")).toEqual([[{ first: 100 }], [{ first: 100, after: "next" }]]);
    expect((await renderDirect(() => moderation.useAddBlockedTermRequest()).current()("  bots ")).id).toBe("t-3");
    expect(state.callsOf("twitchAddBlockedTerm")).toEqual([[{ text: "bots" }]]);
    await renderDirect(() => moderation.useRemoveBlockedTermRequest()).current()("t-3");
    expect(state.callsOf("twitchRemoveBlockedTerm")).toEqual([[{ id: "t-3" }]]);
  });

  test("a ban looks the viewer up by login, and refuses the broadcaster's own account", async () => {
    const { runtime, state } = await connected();
    linkTwitch(state, ALL);
    answerTwitch(state, {
      twitchGetUsers: (params) => {
        const login = (params as { login: string }).login;
        return ok({ data: [{ id: login === "streamer" ? "b-1" : "v-1", login, display_name: "Someone" }] });
      },
      twitchBanUser: () => ok({ data: [{}] }),
    });
    const ban = renderDirect(() => directModerationGateway(runtime).useBanRequest()).current();
    expect(await ban("@SomeOne", " spam ")).toEqual({ login: "someone", displayName: "Someone" });
    expect(state.callsOf("twitchBanUser")).toEqual([[{ user_id: "v-1", reason: "spam" }]]);
    expect(String(await failure(ban("streamer")))).toContain("You can't moderate your own account");
  });

  test("a timeout Twitch refuses reads as the widget's sentence", async () => {
    const { runtime, state } = await connected();
    linkTwitch(state, ALL);
    answerTwitch(state, {
      twitchGetUsers: () => ok({ data: [{ id: "v-1", login: "someone" }] }),
      twitchBanUser: () => refused(400, "The user specified in the user_id field is already banned."),
    });
    const timeout = renderDirect(() => directModerationGateway(runtime).useTimeoutRequest()).current();
    expect(String(await failure(timeout("someone", 60)))).toContain(
      "That user is banned, so a timeout would do nothing."
    );
    expect(String(await failure(timeout("someone", 0)))).toContain("at least one second");
  });

  test("chat modes are read with the read scope alone and changed by the fields given", async () => {
    const { runtime, state } = await connected();
    linkTwitch(state, ["moderator:read:chat_settings"]);
    answerTwitch(state, {
      twitchGetChatSettings: () => ok({ data: [{ slow_mode: true, slow_mode_wait_time: 30 }] }),
      twitchUpdateChatSettings: () => ok({ data: [{ emote_mode: true }] }),
    });
    const moderation = directModerationGateway(runtime);
    expect(await renderDirect(() => moderation.useChatSettingsRequest()).current()()).toEqual({
      emoteMode: false,
      followerMode: false,
      followerModeDuration: null,
      slowMode: true,
      slowModeWaitTime: 30,
      subscriberMode: false,
    });
    const update = renderDirect(() => moderation.useUpdateChatSettingsRequest()).current();
    expect(String(await failure(update({ emoteMode: true })))).toContain(
      missingTwitchScopeMessage("moderator:manage:chat_settings")
    );
    linkTwitch(state, ALL);
    runtime.queryClient.removeQueries({ queryKey: directKeys.twitch.link() });
    expect((await update({ emoteMode: true })).emoteMode).toBe(true);
    expect(state.callsOf("twitchUpdateChatSettings")).toEqual([[{ emote_mode: true }]]);
  });
});

describe("twitchChat", () => {
  test("sends a message, and rejects with Twitch's reason when it drops one", async () => {
    const { runtime, state } = await connected();
    linkTwitch(state, ["user:write:chat"]);
    let dropped = false;
    answerTwitch(state, {
      twitchSendChatMessage: () =>
        ok({
          data: [dropped ? { is_sent: false, drop_reason: { message: "Held by AutoMod" } } : { is_sent: true }],
        }),
    });
    const send = renderDirect(() => directTwitchChatGateway(runtime).useSendMessageRequest()).current();
    await send("  hello  ");
    expect(state.callsOf("twitchSendChatMessage")).toEqual([[{ message: "hello" }]]);
    dropped = true;
    expect(String(await failure(send("hello")))).toContain("Held by AutoMod");
    expect(String(await failure(send(" ")))).toContain("A chat message needs some text");
  });

  test("announces in a color, and shouts out a channel by its id", async () => {
    const { runtime, state } = await connected();
    linkTwitch(state, ["moderator:manage:announcements", "moderator:manage:shoutouts"]);
    answerTwitch(state, {
      twitchSendChatAnnouncement: () => ok(null),
      twitchGetUsers: (params) =>
        (params as { login: string }).login === "friend"
          ? ok({ data: [{ id: "f-1", login: "friend" }] })
          : ok({ data: [] }),
      twitchSendShoutout: () => ok(null),
    });
    const chat = directTwitchChatGateway(runtime);
    await renderDirect(() => chat.useSendAnnouncementRequest()).current()({ message: "Raid!", color: "purple" });
    expect(state.callsOf("twitchSendChatAnnouncement")).toEqual([[{ message: "Raid!", color: "purple" }]]);
    const shoutout = renderDirect(() => chat.useSendShoutoutRequest()).current();
    await shoutout("@Friend");
    expect(state.callsOf("twitchSendShoutout")).toEqual([[{ to_broadcaster_id: "f-1" }]]);
    expect(String(await failure(shoutout("nobody")))).toContain('No Twitch channel called "nobody"');
  });

  test("lists chatters, and an unlinked engine says Twitch is not connected", async () => {
    const { runtime, state } = await connected();
    const chatters = renderDirect(() => directTwitchChatGateway(runtime).useChattersRequest()).current();
    expect(String(await failure(chatters()))).toContain(missingTwitchScopeMessage("moderator:read:chatters"));

    linkTwitch(state, ["moderator:read:chatters"]);
    runtime.queryClient.removeQueries({ queryKey: directKeys.twitch.link() });
    answerTwitch(state, {
      twitchGetChatters: () => ok({ data: [{ user_id: "1", user_login: "someone", user_name: "SomeOne" }] }),
    });
    expect(await chatters()).toEqual([{ userId: "1", login: "someone", displayName: "SomeOne" }]);
    expect(state.callsOf("twitchGetChatters")).toEqual([[{ first: 1000 }]]);
  });
});

describe("clips", () => {
  test("clips the live stream, names an offline channel, and needs a link", async () => {
    const { runtime, state } = await connected();
    const create = renderDirect(() => directClipsGateway(runtime).useCreateRequest()).current();
    expect(String(await failure(create()))).toContain(TWITCH_NOT_CONNECTED_MESSAGE);

    linkTwitch(state, []);
    runtime.queryClient.removeQueries({ queryKey: directKeys.twitch.link() });
    let live = true;
    answerTwitch(state, {
      twitchCreateClip: () =>
        live ? ok({ data: [{ id: "c-1", edit_url: "https://clips.test/c-1" }] }) : refused(404, ""),
    });
    expect(await create()).toEqual({ clipId: "c-1", editUrl: "https://clips.test/c-1" });
    live = false;
    expect(String(await failure(create()))).toContain("the channel has to be live");
  });

  test("an engine that has no answer from Twitch says why", async () => {
    const { runtime, state } = await connected();
    linkTwitch(state, []);
    state.twitchAnswer = () => ({ ok: false, code: "unavailable", error: "twitch is off" });
    const create = renderDirect(() => directClipsGateway(runtime).useCreateRequest()).current();
    expect(String(await failure(create()))).toContain("The engine's Twitch connection is not running");
  });
});

describe("streamInfo", () => {
  const SCOPE = ["channel:manage:broadcast"];
  const ART = "https://static-cdn.jtvnw.net/ttv-boxart/509658-{width}x{height}.jpg";

  test("reads the channel with its box art, reusing art the caller already has", async () => {
    const { runtime, state } = await connected();
    linkTwitch(state, SCOPE);
    answerTwitch(state, {
      twitchGetChannelInformation: () =>
        ok({ data: [{ title: "Cozy", game_id: "509658", game_name: "Just Chatting", tags: ["English"] }] }),
      twitchGetGames: () => ok({ data: [{ id: "509658", name: "Just Chatting", box_art_url: ART }] }),
    });
    const channel = renderDirect(() => directStreamInfoGateway(runtime).useChannelRequest()).current();
    const sized = "https://static-cdn.jtvnw.net/ttv-boxart/509658-52x72.jpg";
    expect(await channel()).toEqual({
      title: "Cozy",
      category: { id: "509658", name: "Just Chatting", boxArtUrl: sized },
      tags: ["English"],
    });
    await channel({ categoryId: "509658", boxArtUrl: sized });
    expect(state.callsOf("twitchGetGames")).toHaveLength(1);
  });

  test("an update sends only the fields given and reports what Twitch did not take", async () => {
    const { runtime, state } = await connected();
    linkTwitch(state, SCOPE);
    answerTwitch(state, {
      twitchModifyChannelInformation: () => ok(null),
      twitchGetChannelInformation: () => ok({ data: [{ title: "Old", game_id: "", game_name: "", tags: [] }] }),
    });
    const update = renderDirect(() => directStreamInfoGateway(runtime).useUpdateRequest()).current();
    const result = await update({ title: " New ", category: null });
    expect(state.callsOf("twitchModifyChannelInformation")).toEqual([[{ title: "New", game_id: "" }]]);
    expect(result).toEqual({ info: { title: "Old", category: null, tags: [] }, unapplied: ["title"] });
    expect(String(await failure(update({})))).toContain("Nothing to update");
  });

  test("searches categories, and drops a marker only on a live stream with VODs", async () => {
    const { runtime, state } = await connected();
    linkTwitch(state, SCOPE);
    answerTwitch(state, {
      twitchSearchCategories: () => ok({ data: [{ id: "1", name: "Chess" }] }),
      twitchCreateStreamMarker: () => refused(404, "not live"),
    });
    const streamInfo = directStreamInfoGateway(runtime);
    const search = renderDirect(() => streamInfo.useSearchCategoriesRequest()).current();
    expect(await search(" chess ")).toEqual([{ id: "1", name: "Chess", boxArtUrl: null }]);
    expect(await search("  ")).toEqual([]);
    expect(state.callsOf("twitchSearchCategories")).toEqual([[{ query: "chess", first: 10 }]]);
    const marker = renderDirect(() => streamInfo.useCreateMarkerRequest()).current();
    expect(String(await failure(marker("highlight")))).toContain("Not live, or past broadcasts are off");
    expect(state.callsOf("twitchCreateStreamMarker")).toEqual([[{ description: "highlight" }]]);
  });

  test("presets are kept in the account, which the engine cannot reach", async () => {
    const { runtime } = await connected();
    const streamInfo = directStreamInfoGateway(runtime);
    const save = await failure(renderDirect(() => streamInfo.useSavePresetRequest()).current()({} as never));
    expect(save).toBeInstanceOf(GatewayUnsupportedError);
    const read = renderDirect(() => streamInfo.usePresets());
    expect(read.error()).toBeInstanceOf(GatewayUnsupportedError);
  });
});

describe("pins", () => {
  test("reads the current pin, pins a new message as it is posted, and unpins", async () => {
    const { runtime, state } = await connected();
    linkTwitch(state, ["moderator:read:chat_messages", "moderator:manage:chat_messages", "user:write:chat"]);
    answerTwitch(state, {
      twitchGetChatPins: () =>
        ok({ data: [{ message_id: "m-1", message: { text: "Follow!" }, sender_user_name: "Streamer" }] }),
      twitchSendChatMessage: () => ok({ data: [{ message_id: "m-2", is_sent: true }] }),
      twitchUnpinChatMessage: () => ok(null),
    });
    const pins = directPinsGateway(runtime);
    expect(await renderDirect(() => pins.useCurrentRequest()).current()()).toEqual({
      messageId: "m-1",
      content: "Follow!",
      authorName: "Streamer",
      expiresAt: null,
    });
    expect(await renderDirect(() => pins.usePinNewRequest()).current()(" Hydrate ")).toEqual({ messageId: "m-2" });
    expect(state.callsOf("twitchSendChatMessage")).toEqual([[{ message: "Hydrate", pin: true }]]);
    await renderDirect(() => pins.useUnpinRequest()).current()("m-2");
    expect(state.callsOf("twitchUnpinChatMessage")).toEqual([[{ message_id: "m-2" }]]);
  });

  test("pinning a new message needs both the send and the pin scope", async () => {
    const { runtime, state } = await connected();
    linkTwitch(state, ["user:write:chat"]);
    const pinNew = renderDirect(() => directPinsGateway(runtime).usePinNewRequest()).current();
    expect(String(await failure(pinNew("Hydrate")))).toContain(
      missingTwitchScopeMessage("moderator:manage:chat_messages")
    );
    expect(twitchCalls(state)).toEqual([]);
  });

  test("the pin history is kept in the account, which the engine cannot reach", async () => {
    const { runtime } = await connected();
    const pins = directPinsGateway(runtime);
    expect(renderDirect(() => pins.useHistory()).error()).toBeInstanceOf(GatewayUnsupportedError);
    for (const request of [pins.useRepinRequest, pins.useRemoveFromHistoryRequest]) {
      expect(await failure(renderDirect(() => request()).current()("entry" as never))).toBeInstanceOf(
        GatewayUnsupportedError
      );
    }
  });
});

describe("pageIntros", () => {
  test("dismissing an intro stores it in the engine, and another writer's dismissal shows up", async () => {
    const { runtime, state, engine } = await connected();
    const intros = directPageIntrosGateway(runtime);
    const read = renderDirect(() => intros.useDismissed());
    expect(await read.until((value) => value !== undefined, "the dismissals")).toEqual([]);

    await renderDirect(() => intros.useDismissRequest()).current()("workflows");
    expect(state.callsOf("setUISetting")).toEqual([["pageIntros", "workflows", true]]);
    await read.until((value) => value?.includes("workflows") === true, "the dismissal");

    state.uiSettingRevision += 1;
    state.uiSettings.pageIntros = {
      ...state.uiSettings.pageIntros,
      scenes: {
        namespace: "pageIntros",
        key: "scenes",
        value: true,
        revision: state.uiSettingRevision,
        updatedAt: "2026-10-30T10:01:00Z",
        deleted: false,
      },
    };
    await engine.pushEvent(
      makeCallbackEnvelope(
        {
          type: EngineEventType.UI_SETTING_CHANGED,
          namespace: "pageIntros",
          key: "scenes",
          revision: state.uiSettingRevision,
          deleted: false,
          value: true,
        },
        "engine",
        "e-intro"
      )
    );
    await read.until((value) => value?.includes("scenes") === true, "the other writer's dismissal");
    read.unmount();
  });
});
