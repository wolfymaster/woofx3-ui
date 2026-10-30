import { bareModuleKey } from "@shared/module-key";
import { parseSceneLayout, parseSceneWidgets } from "@shared/scene-serialization";
import { readWidgetBehaviorKinds } from "@shared/widget-behavior-kinds";
import { widgetCanonicalKey } from "@shared/widget-key";
import type { SceneSnapshot, Woofx3EngineApi } from "@woofx3/api";
import { parseFieldList } from "@woofx3/api/ui-schema";
import type { SceneRecord, SceneWidgetCatalogRow } from "@/engine/types";
import { toModuleId, toSceneId } from "../ids";

export type AvailableWidget = Awaited<ReturnType<Woofx3EngineApi["getAvailableWidgets"]>>["widgets"][number];

// Must match the defaults convex/scenes.ts gives a scene whose layout names none.
const DEFAULT_SCENE_WIDTH = 1920;
const DEFAULT_SCENE_HEIGHT = 1080;
const DEFAULT_SCENE_BACKGROUND = "transparent";

/** Epoch ms of an engine timestamp; throws for one that does not parse, since a scene's edit order hangs on it. */
function epochMs(iso: string, field: string): number {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) {
    throw new Error(`The engine sent a scene ${field} that is not a time: ${JSON.stringify(iso)}`);
  }
  return ms;
}

export function toSceneRecord(snapshot: SceneSnapshot): SceneRecord {
  const layout = parseSceneLayout(snapshot.layoutJson);
  return {
    id: toSceneId(snapshot.id),
    engineSceneId: snapshot.id,
    name: snapshot.name,
    description: snapshot.description || undefined,
    widgets: parseSceneWidgets(snapshot.widgetsJson),
    width: layout.width ?? DEFAULT_SCENE_WIDTH,
    height: layout.height ?? DEFAULT_SCENE_HEIGHT,
    backgroundColor: layout.backgroundColor ?? DEFAULT_SCENE_BACKGROUND,
    createdAt: epochMs(snapshot.createdAt, "creation time"),
    updatedAt: epochMs(snapshot.updatedAt, "update time"),
  };
}

/** The module a widget came from, by its manifest id; none for the engine's own widgets. */
function moduleKeyOf(widget: AvailableWidget): string | undefined {
  return widget.createdByType === "MODULE" ? bareModuleKey(widget.createdByRef) : undefined;
}

/**
 * A catalog row as the Convex widget sync writes one: keyed by the widget's
 * canonical key and grouped under its module's name, or the built-in label.
 * `moduleNames` maps a module's manifest id to its display name; a module it
 * lacks (one uninstalled while the widgets were read) shows as its id.
 */
export function toSceneWidgetCatalogRow(
  widget: AvailableWidget,
  moduleNames: ReadonlyMap<string, string>,
  builtinLabel: string
): SceneWidgetCatalogRow {
  const moduleKey = moduleKeyOf(widget);
  return {
    widgetId: widgetCanonicalKey({ createdByRef: widget.createdByRef, manifestId: widget.manifestId, id: widget.id }),
    name: widget.name,
    description: widget.description || undefined,
    moduleId: moduleKey === undefined ? undefined : toModuleId(moduleKey),
    moduleName: moduleKey === undefined ? builtinLabel : (moduleNames.get(moduleKey) ?? moduleKey),
    directory: widget.directory,
    alertTypes: widget.alertTypes,
    settings: parseFieldList(widget.settingsSchema),
    surfaces: widget.surfaces,
    hostsSurface: widget.hostsSurface || undefined,
    taxonomy: widget.taxonomy,
    createdByType: widget.createdByType,
    createdByRef: widget.createdByRef,
    behaviorKinds: readWidgetBehaviorKinds(widget.behaviorKinds),
  };
}
