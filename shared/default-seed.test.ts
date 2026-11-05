import { describe, expect, test } from "bun:test";
import { normalizeComposition, PROFILES, resolveTimeline } from "@woofx3/scene/model";
import {
  DEFAULT_ALERT_ITEMS,
  DEFAULT_DASHBOARD_LAYOUT_ID,
  DEFAULT_OVERLAY_SCENE_NAME,
  type DefaultSeedEngine,
  defaultAlertImagesBaseUrl,
  defaultAlertImageUrl,
  defaultAlertStatus,
  defaultAlertsPack,
  defaultAlertsToInstall,
  seedDefaultScene,
} from "./default-seed";
import { buildStarterWorkflow, STARTER_ACTION_REFS, type StarterItem } from "./starter-packs";

const BASE = "https://x.example/assets/modules/woofx3/abc1234/widgets/image/defaults";
const CATALOG = {
  triggers: DEFAULT_ALERT_ITEMS.map((item) => ({ event: item.trigger.event })),
  actions: [{ canonicalRef: STARTER_ACTION_REFS.alert, handlerType: "alert" }],
};

function layoutOf(item: StarterItem | undefined): Record<string, unknown> {
  if (item?.kind !== "workflow") {
    throw new Error("not a workflow item");
  }
  return buildStarterWorkflow(item, {}, CATALOG).tasks[0]?.parameters?.layout as Record<string, unknown>;
}

describe("default alert images", () => {
  test.each([
    ["follow", `${BASE}/follow.svg`],
    ["cheer", `${BASE}/cheer.svg`],
    ["sub", `${BASE}/sub.svg`],
    ["resub", `${BASE}/resub.svg`],
    ["gift", `${BASE}/gift.svg`],
    ["community-gift", `${BASE}/community-gift.svg`],
    ["upgrade", `${BASE}/upgrade.svg`],
    ["pay-it-forward", `${BASE}/pay-it-forward.svg`],
  ] as const)("the %s image is at the path the module ships it under", (art, url) => {
    const base = defaultAlertImagesBaseUrl({ overlayPublicUrl: "https://x.example/" }, [
      { moduleId: "woofx3", moduleKey: "woofx3:0.46.0:abc1234" },
    ]);
    expect(defaultAlertImageUrl(base ?? "", art)).toBe(url);
  });

  test.each([
    ["0.45.9", null],
    ["0.9.0", null],
    ["0.46.0", BASE],
    ["0.100.0", BASE],
    ["1.0.0", BASE],
  ])("module %s has images at %s", (version, expected) => {
    expect(
      defaultAlertImagesBaseUrl({ overlayPublicUrl: "https://x.example" }, [
        { moduleId: "woofx3_twitch", moduleKey: "woofx3_twitch:9.9.9:zzz" },
        { moduleId: "woofx3", moduleKey: `woofx3:${version}:abc1234` },
      ])
    ).toBe(expected);
  });

  test("an unlisted module, a malformed key or no overlay address are errors to retry", () => {
    const info = { overlayPublicUrl: "https://x.example" };
    expect(() => defaultAlertImagesBaseUrl(info, [])).toThrow(/does not list/);
    expect(() => defaultAlertImagesBaseUrl(info, [{ moduleId: "woofx3", moduleKey: "woofx3" }])).toThrow(/no version/);
    expect(() =>
      defaultAlertImagesBaseUrl({ overlayPublicUrl: "" }, [{ moduleId: "woofx3", moduleKey: "woofx3:0.46.0:a" }])
    ).toThrow(/overlay address/);
  });
});

describe("default alerts", () => {
  test("there is one workflow per trigger, with subs covering every kind of sub", () => {
    expect(DEFAULT_ALERT_ITEMS.map((item) => [item.id, item.trigger.event])).toEqual([
      ["follow", "channel.follow"],
      ["sub", "channel.subscribe"],
      ["gifted-sub", "channel.subscribe"],
      ["resub", "channel.resub"],
      ["gift", "channel.subscriptionGift"],
      ["prime-upgrade", "channel.primePaidUpgrade"],
      ["gift-upgrade", "channel.giftPaidUpgrade"],
      ["pay-it-forward", "channel.payItForward"],
      ["bits", "channel.cheer"],
    ]);
  });

  test("a gifted sub alert skips the recipients of a community gift, which the gift alert shows once", () => {
    const conditions = (id: string) => DEFAULT_ALERT_ITEMS.find((item) => item.id === id)?.trigger.conditions;
    expect(conditions("sub")).toEqual([{ path: "isGift", operator: "eq", value: false }]);
    expect(conditions("gifted-sub")).toEqual([
      { path: "isGift", operator: "eq", value: true },
      { path: "isCommunityGift", operator: "eq", value: false },
    ]);
  });

  test("a layout is an object filled with the viewer's details, on the widget's canvas", () => {
    const layout = layoutOf(defaultAlertsPack(BASE).items.find((item) => item.id === "bits"));
    expect(layout.layout).toEqual({ width: 640, height: 360 });
    const widgets = layout.widgets as Record<string, { settings: Record<string, unknown> }>;
    expect(widgets.text?.settings.text).toBe(
      "${trigger.data.isAnonymous ? 'An anonymous cheerer' : trigger.data.userName} cheered ${trigger.data.amount} ${trigger.data.amount > 1 ? 'bits' : 'bit'}!"
    );
    expect(widgets.image?.settings).toEqual({
      src: { source: "url", name: "cheer.svg", url: `${BASE}/cheer.svg`, type: "image" },
      fit: "contain",
      duration: 0,
    });
  });

  test("every layout is a composition the scene model reads whole, with its transitions on the timeline", () => {
    for (const images of [BASE, null]) {
      for (const item of defaultAlertsPack(images).items) {
        const doc = normalizeComposition(layoutOf(item));
        if (doc === null) {
          throw new Error(`${item.id} is not a composition`);
        }
        expect(Object.keys(doc.widgets)).toEqual(images === null ? ["text"] : ["image", "text"]);
        const timeline = resolveTimeline(
          doc,
          PROFILES.alert,
          { startedAtMs: 0 },
          { estimate: { durationsMs: { text: 5000 } } }
        );
        expect(timeline.finishMs).toBe(5400);
      }
    }
  });

  // The engine evaluates these; workflow/internal/expression/compound_test.go pins this exact form.
  test.each([
    ["resub", "${trigger.data.cumulativeMonths} ${trigger.data.cumulativeMonths > 1 ? 'months' : 'month'}"],
    ["gift", "${trigger.data.amount} ${trigger.data.amount > 1 ? 'subs' : 'sub'}"],
    ["bits", "${trigger.data.amount} ${trigger.data.amount > 1 ? 'bits' : 'bit'}"],
  ])("the %s alert picks its noun by the count, so it reads right at 1", (id, phrase) => {
    const layout = layoutOf(defaultAlertsPack(null).items.find((item) => item.id === id));
    const widgets = layout.widgets as Record<string, { settings: Record<string, unknown> }>;
    expect(String(widgets.text?.settings.text)).toContain(phrase);
  });

  test("without images there is no image layer", () => {
    const layout = layoutOf(defaultAlertsPack(null).items.find((item) => item.id === "follow"));
    expect(JSON.stringify(layout)).not.toContain("webp");
  });

  test("leaves out an alert whose event already starts any workflow, paused or conditioned", () => {
    const eventWorkflow = (id: string, event: string) => ({
      id,
      definition: { name: event, trigger: { type: "event" as const, event, conditions: [] }, tasks: [] },
    });
    const { pack, coveredItemIds } = defaultAlertsToInstall(
      defaultAlertsPack(null),
      [
        eventWorkflow("w-1", "channel.follow"),
        eventWorkflow("w-2", "channel.cheer"),
        {
          id: "w-3",
          definition: { name: "nightly", trigger: { type: "schedule" as const, schedule: "0 0 * * *" }, tasks: [] },
        },
        { id: "w-4", definition: null },
      ],
      new Set()
    );
    expect(coveredItemIds).toEqual(["follow", "bits"]);
    expect(pack.items.map((item) => item.id)).toEqual(
      DEFAULT_ALERT_ITEMS.map((item) => item.id).filter((id) => !coveredItemIds.includes(id))
    );
  });

  test("the seed's own workflow on an event does not cover the other defaults on it", () => {
    const seededSub = {
      id: "seeded-sub",
      definition: { name: "Sub alert", trigger: { type: "event" as const, event: "channel.subscribe" }, tasks: [] },
    };
    const { coveredItemIds } = defaultAlertsToInstall(defaultAlertsPack(null), [seededSub], new Set(["seeded-sub"]));
    expect(coveredItemIds).toEqual([]);
  });

  test("an engine with no workflows gets every alert", () => {
    const { pack, coveredItemIds } = defaultAlertsToInstall(defaultAlertsPack(null), [], new Set());
    expect(coveredItemIds).toEqual([]);
    expect(pack.items.length).toBe(DEFAULT_ALERT_ITEMS.length);
  });

  test("an install outcome maps to a status", () => {
    expect(
      ["installed", "already-installed", "unavailable", "busy", "pending", "failed", "conflict"].map(defaultAlertStatus)
    ).toEqual(["installed", "installed", "pending", "pending", "pending", "failed", "failed"]);
  });
});

describe("default scene", () => {
  // As the engine's getAvailableWidgets answers: `id` is the database row's, and
  // only `createdByRef` and `manifestId` name the widget a placement can store.
  const ALERT_WIDGET_ROW = {
    id: "cae7619f-41f4-4a6e-9f3a-0d5be1c7a2d1",
    manifestId: "alert",
    createdByRef: "woofx3:0.45.0:abc1234",
    name: "Alert",
    hostsSurface: "alert",
  };

  /** As listSceneSnapshots answers: each scene's stored widgets as JSON, verbatim. */
  const stored = (id: string, widgets: unknown[], name = `scene ${id}`) => ({
    id,
    name,
    widgetsJson: JSON.stringify(widgets),
  });

  function engineWith(scenes: { id: string; name: string; widgetsJson: string }[], hasWidget = true) {
    const created: { name: string; widgetsJson: string; layoutJson: string }[] = [];
    const engine: DefaultSeedEngine = {
      getEngineInfo: async () => ({ overlayPublicUrl: "" }),
      listEngineModules: async () => [],
      getAvailableWidgets: async () => ({
        widgets: hasWidget ? [ALERT_WIDGET_ROW] : [],
      }),
      listSceneSnapshots: async () => ({ scenes }),
      createScene: async (scene) => {
        created.push(scene);
        return { id: "new-scene" };
      },
    };
    return { engine, created };
  }

  test("creates the scene with the alert widget in the top right", async () => {
    const { engine, created } = engineWith([]);
    expect(await seedDefaultScene(engine)).toEqual({ status: "installed", engineSceneId: "new-scene" });
    expect(created[0]?.name).toBe("Default Browser Overlay");
    expect(JSON.parse(created[0]?.layoutJson ?? "")).toMatchObject({ width: 1920, height: 1080 });
    expect(JSON.parse(created[0]?.widgetsJson ?? "")[0]).toMatchObject({
      widgetCanonicalId: "woofx3:widget:alert",
      position: { x: 1240, y: 40 },
      size: { width: 640, height: 360 },
      settings: { name: "default" },
    });
  });

  test("takes a renamed scene that already has the default alert widget instead of adding another", async () => {
    const { engine, created } = engineWith([
      stored("other", [{ widgetCanonicalId: "woofx3:widget:image" }]),
      stored("mine", [{ widgetCanonicalId: "woofx3:widget:alert", settings: {} }]),
    ]);
    expect(await seedDefaultScene(engine)).toEqual({ status: "installed", engineSceneId: "mine" });
    expect(created).toEqual([]);
  });

  test("finds the scene it created when a run dies before recording the id", async () => {
    const first = engineWith([]);
    await seedDefaultScene(first.engine);
    const widgets = JSON.parse(first.created[0]?.widgetsJson ?? "");
    const second = engineWith([stored("made-earlier", widgets, DEFAULT_OVERLAY_SCENE_NAME)]);
    expect(await seedDefaultScene(second.engine)).toEqual({ status: "installed", engineSceneId: "made-earlier" });
    expect(second.created).toEqual([]);
  });

  test.each([
    ["an empty scene", []],
    ["another kind of widget", [{ widgetCanonicalId: "woofx3:widget:image", settings: { name: "default" } }]],
    ["an alert widget under another name", [{ widgetCanonicalId: "woofx3:widget:alert", settings: { name: "side" } }]],
  ])("takes the next free name when the default name is on %s", async (_case, widgets) => {
    const { engine, created } = engineWith([
      stored("theirs", widgets, DEFAULT_OVERLAY_SCENE_NAME),
      stored("older", [], `${DEFAULT_OVERLAY_SCENE_NAME} 2`),
    ]);
    expect(await seedDefaultScene(engine)).toEqual({ status: "installed", engineSceneId: "new-scene" });
    expect(created[0]?.name).toBe(`${DEFAULT_OVERLAY_SCENE_NAME} 3`);
  });

  test("a scene with unreadable widgets is passed over, not fatal", async () => {
    const { engine, created } = engineWith([{ id: "broken", name: "broken", widgetsJson: "{not json" }]);
    expect((await seedDefaultScene(engine)).status).toBe("installed");
    expect(created[0]?.name).toBe(DEFAULT_OVERLAY_SCENE_NAME);
  });

  test("waits rather than store a widget row that has no canonical id", async () => {
    const { engine, created } = engineWith([]);
    engine.getAvailableWidgets = async () => ({
      widgets: [{ ...ALERT_WIDGET_ROW, createdByRef: "", manifestId: "" }],
    });
    expect((await seedDefaultScene(engine)).status).toBe("pending");
    expect(created).toEqual([]);
  });

  test("waits while the engine has no alert widget", async () => {
    const { engine, created } = engineWith([], false);
    expect((await seedDefaultScene(engine)).status).toBe("pending");
    expect(created).toEqual([]);
  });
});
