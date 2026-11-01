import { api } from "@convex/_generated/api";
import { useConvex, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useCallback, useEffect, useState } from "react";
import type { ScenesGateway } from "@/engine/gateway";
import type {
  AlertTargetUsage,
  AlertTargetUse,
  NewScene,
  ReadOptions,
  SceneChanges,
  SceneRecord,
  SceneWidgetCatalogRow,
  WidgetThemesRead,
} from "@/engine/types";
import { toModuleId, toSceneId } from "./ids";
import { useMappedList, useMappedValue } from "./mapped";
import { useInstanceAction, useScopeInstanceId } from "./scope";

type SceneRow = FunctionReturnType<typeof api.scenes.list>[number];
type WidgetCatalogRow = FunctionReturnType<typeof api.sceneWidgets.listForInstance>[number];
type AlertTargetUsageRow = NonNullable<FunctionReturnType<typeof api.sceneWidgets.alertTargetUsage>>;
type AlertTargetUseRow = AlertTargetUsageRow["uses"][number];

function toSceneRecord(row: SceneRow): SceneRecord {
  return {
    id: toSceneId(row.id),
    engineSceneId: row.engineSceneId,
    name: row.name,
    description: row.description,
    widgets: row.widgets,
    layout: row.layout,
    sceneWidgets: row.sceneWidgets,
    width: row.width,
    height: row.height,
    backgroundColor: row.backgroundColor,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toSceneWidgetCatalogRow(row: WidgetCatalogRow): SceneWidgetCatalogRow {
  return {
    widgetId: row.widgetId,
    name: row.name,
    description: row.description,
    moduleId: toModuleId(row.moduleId),
    moduleName: row.moduleName,
    directory: row.directory,
    alertTypes: row.alertTypes,
    settings: row.settings,
    surfaces: row.surfaces,
    hostsSurface: row.hostsSurface,
    taxonomy: row.taxonomy,
    projectionKey: row.projectionKey,
    createdByType: row.createdByType,
    createdByRef: row.createdByRef,
    behaviorKinds: row.behaviorKinds,
  };
}

function toAlertTargetUse(row: AlertTargetUseRow): AlertTargetUse {
  return { target: row.target, kind: row.kind, name: row.name };
}

function toAlertTargetUsage(row: AlertTargetUsageRow): AlertTargetUsage {
  return {
    alertWidgetIds: row.alertWidgetIds,
    elsewhere: row.elsewhere,
    uses: row.uses.map(toAlertTargetUse),
  };
}

function useScenes({ enabled = true }: ReadOptions = {}) {
  const instanceId = useScopeInstanceId();
  const rows = useQuery(api.scenes.list, enabled && instanceId ? { instanceId } : "skip");
  return useMappedList(rows, toSceneRecord);
}

function useScene(engineSceneId: string) {
  const instanceId = useScopeInstanceId();
  const row = useQuery(api.scenes.getByEngineSceneId, instanceId ? { instanceId, engineSceneId } : "skip");
  return useMappedValue(row, toSceneRecord);
}

function useWidgetCatalog({ enabled = true }: ReadOptions = {}) {
  const instanceId = useScopeInstanceId();
  const rows = useQuery(api.sceneWidgets.listForInstance, enabled && instanceId ? { instanceId } : "skip");
  return useMappedList(rows, toSceneWidgetCatalogRow);
}

function useAlertWidgetNames({ enabled = true }: ReadOptions = {}) {
  const instanceId = useScopeInstanceId();
  return useQuery(api.sceneWidgets.alertWidgetNames, enabled && instanceId ? { instanceId } : "skip");
}

function useAlertTargetUsage(engineSceneId: string) {
  const instanceId = useScopeInstanceId();
  const usage = useQuery(api.sceneWidgets.alertTargetUsage, instanceId ? { instanceId, engineSceneId } : "skip");
  return useMappedValue(usage, toAlertTargetUsage);
}

function useCreateRequest() {
  const createScene = useInstanceAction(api.sceneActions.createScene);
  return useCallback((scene: NewScene) => createScene(scene), [createScene]);
}

function useUpdateRequest() {
  const updateScene = useInstanceAction(api.sceneActions.updateScene);
  return useCallback(
    (engineSceneId: string, changes: SceneChanges) => updateScene({ engineSceneId, ...changes }),
    [updateScene]
  );
}

function useRemoveRequest() {
  const deleteScene = useInstanceAction(api.sceneActions.deleteScene);
  return useCallback((engineSceneId: string) => deleteScene({ engineSceneId }), [deleteScene]);
}

/**
 * Lists the themes through the engine once, and again whenever the
 * instance's installed module set changes (its install revision), rather
 * than polling: themes only come and go with modules.
 */
function useWidgetThemes(widgetCanonicalId: string): WidgetThemesRead | undefined {
  const instanceId = useScopeInstanceId();
  const listWidgetThemes = useInstanceAction(api.sceneActions.listWidgetThemes);
  const revision = useQuery(api.moduleRepository.installedRevision, instanceId ? { instanceId } : "skip");
  const [read, setRead] = useState<{ widget: string; result: WidgetThemesRead } | undefined>(undefined);

  useEffect(() => {
    if (revision === undefined) {
      return;
    }
    let cancelled = false;
    listWidgetThemes({ widgetCanonicalId })
      .then((result): WidgetThemesRead => ({ status: "loaded", themes: result.themes }))
      .catch((error: unknown): WidgetThemesRead => {
        console.error("listWidgetThemes failed:", error);
        return { status: "unavailable" };
      })
      .then((result) => {
        if (!cancelled) {
          setRead({ widget: widgetCanonicalId, result });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [widgetCanonicalId, revision, listWidgetThemes]);

  return read?.widget === widgetCanonicalId ? read.result : undefined;
}

function useEditorSessionRequest() {
  const getSceneEditorSession = useInstanceAction(api.sceneActions.getSceneEditorSession);
  return useCallback((engineSceneId: string) => getSceneEditorSession({ engineSceneId }), [getSceneEditorSession]);
}

function useRepairRequest() {
  const repairScene = useInstanceAction(api.sceneActions.repairScene);
  return useCallback((engineSceneId: string) => repairScene({ engineSceneId }), [repairScene]);
}

function usePrewarmEditor() {
  const convex = useConvex();
  const instanceId = useScopeInstanceId();
  return useCallback(
    (engineSceneId: string) => {
      if (!instanceId) {
        return;
      }
      const args = { instanceId, engineSceneId };
      convex.prewarmQuery({ query: api.scenes.getByEngineSceneId, args });
      convex.prewarmQuery({ query: api.scenes.previewUrlByEngineSceneId, args });
      convex.prewarmQuery({ query: api.sceneWidgets.alertTargetUsage, args });
      convex.prewarmQuery({ query: api.sceneWidgets.listForInstance, args: { instanceId } });
    },
    [convex, instanceId]
  );
}

export const convexScenesGateway: ScenesGateway = {
  useScenes,
  useScene,
  useWidgetCatalog,
  useAlertWidgetNames,
  useAlertTargetUsage,
  useCreateRequest,
  useUpdateRequest,
  useRemoveRequest,
  useWidgetThemes,
  useEditorSessionRequest,
  useRepairRequest,
  usePrewarmEditor,
};
