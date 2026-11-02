import type { EngineInfo, EngineModuleSummary } from "@woofx3/api";
import { alertWidgetNamesOf, DEFAULT_ALERT_WIDGET_NAME, placedWidgetsOf } from "./alert-widgets";
import { STARTER_ACTION_REFS, type StarterPack, type StarterWorkflowItem } from "./starter-packs";
import { stableWidgetId, widgetCanonicalKey } from "./widget-key";

/**
 * What a brand new streamer starts with, so an alert plays on their overlay
 * before they open an editor: one scene, a few alerts and a dashboard panel.
 * Data plus the steps every delivery shares; Convex's setup apply and the
 * direct gateway each run it through their own engine connection and ledger.
 *
 * Everything here is seeded once. Something the streamer deleted stays deleted.
 */

export const DEFAULT_OVERLAY_SCENE_NAME = "Default Browser Overlay";
export const DEFAULT_OVERLAY_CANVAS = { width: 1920, height: 1080 } as const;

/** The scene's alert widget: the top right corner of the canvas. */
export const DEFAULT_ALERT_WIDGET_BOX = { x: 1240, y: 40, width: 640, height: 360 } as const;

export const DEFAULT_ALERTS_PACK_ID = "default-alerts";

/** The first release of the bundled woofx3 module to ship the default alert images. */
const FIRST_MODULE_WITH_IMAGES = { major: 0, minor: 45 } as const;

const WOOFX3_MODULE_ID = "woofx3";

/** Scenes read when looking for one already there, newest first. */
const SCENE_SEARCH_PAGE_SIZE = 100;

/** Must be a widget of the bundled woofx3 module's alert surface. */
const IMAGE_WIDGET_ID = "woofx3:widget:image";
const TEXT_WIDGET_ID = "woofx3:widget:text";

/** How long a default alert plays, in seconds. The image has no length of its own, so the text sets it. */
const ALERT_SECONDS = 5;
const ENTER_MS = 400;
const EXIT_MS = 400;

export type DefaultAlertArt = "follows" | "subs" | "bits";

/** The first dashboard panel: macro pad docked left, Events in the middle, channel controls right. */
export const DEFAULT_DASHBOARD_LAYOUT_ID = "dock-activity-controls";
export const DEFAULT_DASHBOARD_WIDGETS = [
  { zoneId: "0-0", slotId: "0-0:macro-pad", type: "macro-pad" },
  { zoneId: "0-1", slotId: "0-1:events", type: "events" },
  { zoneId: "0-2", slotId: "0-2:pinned", type: "pinned" },
  { zoneId: "0-2", slotId: "0-2:shoutout", type: "shoutout" },
  { zoneId: "0-2", slotId: "0-2:announcement", type: "announcement" },
] as const;

/**
 * Where an image ships inside the installed module. Must match the module's
 * widgets/image/defaults folder in the woofx3 repository, which is what the
 * engine serves under /assets/modules.
 */
export function defaultAlertImageUrl(imagesBaseUrl: string, art: DefaultAlertArt): string {
  return `${imagesBaseUrl}/${art}.webp`;
}

/**
 * The URL the bundled module's default images live under, or null when the
 * installed module is too old to have them. An image the engine would answer
 * 404 for is worse than an alert with only text.
 */
export function defaultAlertImagesBaseUrl(
  info: Pick<EngineInfo, "overlayPublicUrl">,
  modules: readonly Pick<EngineModuleSummary, "moduleId" | "moduleKey">[]
): string | null {
  const row = modules.find((module) => module.moduleId === WOOFX3_MODULE_ID);
  if (row === undefined) {
    throw new Error("The engine does not list its woofx3 module yet.");
  }
  const [, version, hash] = row.moduleKey.split(":");
  if (version === undefined || !hash) {
    throw new Error(`The woofx3 module's key "${row.moduleKey}" has no version and hash.`);
  }
  const [major, minor] = version.split(".").map(Number);
  if (
    major === undefined ||
    minor === undefined ||
    !Number.isInteger(major) ||
    !Number.isInteger(minor) ||
    major < FIRST_MODULE_WITH_IMAGES.major ||
    (major === FIRST_MODULE_WITH_IMAGES.major && minor < FIRST_MODULE_WITH_IMAGES.minor)
  ) {
    return null;
  }
  const origin = info.overlayPublicUrl.replace(/\/+$/, "");
  if (origin === "") {
    throw new Error("The engine does not report its overlay address yet.");
  }
  return `${origin}/assets/modules/${WOOFX3_MODULE_ID}/${hash}/widgets/image/defaults`;
}

function placement(widget: string, name: string, z: string, box: Box, settings: Record<string, unknown>) {
  return { widget, name, z, ...box, settings, visible: true, rotation: 0, opacity: 1, locked: false, extra: {} };
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

function enter(target: string, order: string, kind: string) {
  return {
    type: "transition",
    kind,
    target,
    order,
    timing: { anchor: "enter", offsetMs: 0, durationMs: ENTER_MS, easing: "ease-out" },
    params: { phase: "in" },
  };
}

function exit(target: string, order: string) {
  return {
    type: "transition",
    kind: "fade",
    target,
    order,
    timing: { anchor: "exit", offsetMs: 0, durationMs: EXIT_MS, easing: "ease-in" },
    params: { phase: "out" },
  };
}

// The alert widget scales its composition to fit, so the canvas is the widget's
// own size and aspect, not the scene's: on a 1920x1080 canvas the layers would
// shrink to a third of what is authored here.
function alertComposition(text: string, art: DefaultAlertArt, imagesBaseUrl: string | null): Record<string, unknown> {
  const { width, height } = DEFAULT_ALERT_WIDGET_BOX;
  const textLayer = (box: Box) =>
    placement(TEXT_WIDGET_ID, "Text", "a2", box, {
      text,
      color: "#ffffff",
      fontSize: 40,
      align: "center",
      duration: ALERT_SECONDS,
    });
  const layout = { width, height };
  if (imagesBaseUrl === null) {
    return {
      layout,
      widgets: { text: textLayer({ x: 0, y: height / 3, width, height: height / 3 }) },
      behaviors: { "text-in": enter("text", "a0", "fade"), "text-out": exit("text", "a1") },
    };
  }
  const name = `${art}.webp`;
  return {
    layout,
    widgets: {
      image: placement(
        IMAGE_WIDGET_ID,
        "Image",
        "a1",
        { x: 170, y: 0, width: 300, height: 260 },
        {
          src: { source: "url", name, url: defaultAlertImageUrl(imagesBaseUrl, art), type: "image" },
          fit: "contain",
          duration: 0,
        }
      ),
      text: textLayer({ x: 0, y: 260, width, height: 100 }),
    },
    behaviors: {
      "image-in": enter("image", "a0", "pop"),
      "image-out": exit("image", "a1"),
      "text-in": enter("text", "a2", "fade"),
      "text-out": exit("text", "a3"),
    },
  };
}

interface DefaultAlertSpec extends Pick<StarterWorkflowItem, "id" | "name" | "description" | "trigger" | "tokens"> {
  text: string;
  art: DefaultAlertArt;
}

function alertItem(spec: DefaultAlertSpec, imagesBaseUrl: string | null): StarterWorkflowItem {
  const { text, art, ...item } = spec;
  return {
    ...item,
    kind: "workflow",
    steps: [
      {
        kind: "action",
        id: "play-alert",
        label: "Play the alert",
        action: STARTER_ACTION_REFS.alert,
        parameters: { layout: { object: alertComposition(text, art, imagesBaseUrl) } },
      },
    ],
  };
}

const DEFAULT_ALERT_SPECS: readonly DefaultAlertSpec[] = [
  {
    id: "follow",
    name: "Follow alert",
    description: "Shows new followers on your overlay.",
    trigger: { event: "channel.follow", label: "Someone follows you" },
    tokens: { user: "${trigger.data.userName}" },
    text: "{user} just followed!",
    art: "follows",
  },
  {
    id: "sub",
    name: "Sub alert",
    description: "Shows new subscribers on your overlay. Gifted subs show through their gifter instead.",
    trigger: {
      event: "channel.subscribe",
      label: "Someone subscribes",
      conditions: [{ path: "isGift", operator: "eq", value: false }],
    },
    tokens: { user: "${trigger.data.userName}" },
    text: "{user} just subscribed!",
    art: "subs",
  },
  {
    id: "resub",
    name: "Resub alert",
    description: "Shows resubs shared in chat on your overlay.",
    trigger: { event: "channel.resub", label: "Someone shares a resub" },
    tokens: { user: "${trigger.data.chatterName}", months: "${trigger.data.cumulativeMonths}" },
    text: "{user} resubscribed for {months} months!",
    art: "subs",
  },
  {
    id: "gift",
    name: "Gift sub alert",
    description: "Shows gifted subs on your overlay.",
    trigger: { event: "channel.subscriptionGift", label: "Someone gifts subs" },
    tokens: {
      user: "${trigger.data.isAnonymous ? 'An anonymous gifter' : trigger.data.gifterName}",
      count: "${trigger.data.amount}",
    },
    text: "{user} gifted {count} subs!",
    art: "subs",
  },
  {
    id: "bits",
    name: "Bits alert",
    description: "Shows cheers on your overlay.",
    trigger: { event: "channel.cheer", label: "Someone cheers bits" },
    tokens: {
      user: "${trigger.data.isAnonymous ? 'An anonymous cheerer' : trigger.data.userName}",
      bits: "${trigger.data.amount}",
    },
    text: "{user} cheered {bits} bits!",
    art: "bits",
  },
];

/**
 * The default alerts, each its own workflow: one per trigger, so "Subs" is a
 * new sub, a shared resub and a gift, which the Alerts page groups by trigger.
 * `imagesBaseUrl` null leaves the image layers out.
 */
export function defaultAlertsPack(imagesBaseUrl: string | null): StarterPack {
  return {
    id: DEFAULT_ALERTS_PACK_ID,
    name: "Default alerts",
    why: "An alert for follows, subs and bits from the first minute.",
    fields: [],
    items: DEFAULT_ALERT_SPECS.map((spec) => alertItem(spec, imagesBaseUrl)),
  };
}

/** The seed's alerts by id and trigger, the same whether or not the images are included. */
export const DEFAULT_ALERT_ITEMS: readonly Pick<StarterWorkflowItem, "id" | "trigger">[] = DEFAULT_ALERT_SPECS;

/** The engine calls the seed makes, satisfied by either delivery's engine connection. */
export interface DefaultSeedEngine {
  getEngineInfo(): PromiseLike<Pick<EngineInfo, "overlayPublicUrl">>;
  listEngineModules(): PromiseLike<Pick<EngineModuleSummary, "moduleId" | "moduleKey">[]>;
  getAvailableWidgets(): PromiseLike<{
    widgets: { id: string; manifestId: string; createdByRef: string; name: string; hostsSurface: string }[];
  }>;
  getScenes(query: { pageSize: number }): PromiseLike<{ scenes: { id: string; widgets: readonly unknown[] }[] }>;
  createScene(scene: { name: string; widgetsJson: string; layoutJson: string }): PromiseLike<{ id: string }>;
}

export type DefaultSeedItemStatus = "installed" | "pending" | "failed";

/** What seeding the scene has come to. Once an id is recorded it is never looked at again. */
export interface DefaultSceneOutcome {
  status: DefaultSeedItemStatus;
  engineSceneId?: string;
  error?: string;
}

/**
 * The default scene as the engine's create takes it, around the engine's alert
 * widget. `canonicalId` is what the scene manager parses a placement by; a
 * widget's database row id is not one, and a placement holding it is dropped.
 */
export function defaultSceneInput(alertWidget: { canonicalId: string; name: string }): {
  name: string;
  widgetsJson: string;
  layoutJson: string;
} {
  const { x, y, width, height } = DEFAULT_ALERT_WIDGET_BOX;
  return {
    name: DEFAULT_OVERLAY_SCENE_NAME,
    widgetsJson: JSON.stringify([
      {
        id: "w-default-alerts",
        widgetCanonicalId: alertWidget.canonicalId,
        name: alertWidget.name,
        position: { x, y },
        size: { width, height },
        rotation: 0,
        opacity: 1,
        zIndex: 1,
        locked: false,
        visible: true,
        settings: { name: DEFAULT_ALERT_WIDGET_NAME },
      },
    ]),
    layoutJson: JSON.stringify({ ...DEFAULT_OVERLAY_CANVAS, backgroundColor: "transparent" }),
  };
}

/**
 * Puts the default scene on the engine, or finds what stands in for it: a
 * scene that already has the default alert widget, whether the streamer made
 * it or a run died after creating it and before recording the id. Finds it
 * by the widget, not by the scene's name, which streamers change.
 */
export async function seedDefaultScene(engine: DefaultSeedEngine): Promise<DefaultSceneOutcome> {
  const { widgets } = await engine.getAvailableWidgets();
  const alertWidgets = widgets
    .filter((widget) => widget.hostsSurface === "alert")
    .map((widget) => ({ canonicalId: widgetCanonicalKey(widget), name: widget.name }))
    .filter((widget) => stableWidgetId(widget.canonicalId) !== undefined);
  const alertWidget = alertWidgets[0];
  if (alertWidget === undefined) {
    return { status: "pending", error: "The engine has not registered its alert widget yet." };
  }
  const alertWidgetIds = new Set(alertWidgets.map((widget) => widget.canonicalId));
  const { scenes } = await engine.getScenes({ pageSize: SCENE_SEARCH_PAGE_SIZE });
  const existing = scenes.find((scene) =>
    alertWidgetNamesOf(placedWidgetsOf(scene.widgets), alertWidgetIds).has(DEFAULT_ALERT_WIDGET_NAME)
  );
  if (existing !== undefined) {
    return { status: "installed", engineSceneId: existing.id };
  }
  const created = await engine.createScene(defaultSceneInput(alertWidget));
  return { status: "installed", engineSceneId: created.id };
}

/** Resolves where the images are, or null to seed the alerts with text alone. */
export async function readDefaultAlertImages(engine: DefaultSeedEngine): Promise<string | null> {
  const [info, modules] = await Promise.all([engine.getEngineInfo(), engine.listEngineModules()]);
  return defaultAlertImagesBaseUrl(info, modules);
}

/** How a seeded alert's install came out, from the starter pack installers' outcome word. */
export function defaultAlertStatus(outcome: string): DefaultSeedItemStatus {
  if (outcome === "installed" || outcome === "already-installed") {
    return "installed";
  }
  return outcome === "failed" || outcome === "conflict" ? "failed" : "pending";
}
