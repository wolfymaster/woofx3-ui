import { api } from "@convex/_generated/api";
import { useAction, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useCallback } from "react";
import type { ScenesGateway } from "@/engine/gateway";
import type { InstanceId, NewScene, SceneChanges, SceneRecord, SceneWidgetCatalogRow } from "@/engine/types";
import { fromInstanceId, toModuleId, toSceneId } from "./ids";
import { useMappedList, useMappedValue } from "./mapped";

type SceneRow = FunctionReturnType<typeof api.scenes.list>[number];
type WidgetCatalogRow = FunctionReturnType<typeof api.sceneWidgets.listForInstance>[number];

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
    createdAt: row.createdAt,
  };
}

function useScenes(instanceId: InstanceId | null) {
  const rows = useQuery(api.scenes.list, instanceId ? { instanceId: fromInstanceId(instanceId) } : "skip");
  return useMappedList(rows, toSceneRecord);
}

function useScene(instanceId: InstanceId, engineSceneId: string) {
  const row = useQuery(api.scenes.getByEngineSceneId, { instanceId: fromInstanceId(instanceId), engineSceneId });
  return useMappedValue(row, toSceneRecord);
}

function useWidgetCatalog(instanceId: InstanceId | null) {
  const rows = useQuery(
    api.sceneWidgets.listForInstance,
    instanceId ? { instanceId: fromInstanceId(instanceId) } : "skip"
  );
  return useMappedList(rows, toSceneWidgetCatalogRow);
}

function useAlertWidgetNames(instanceId: InstanceId | null) {
  return useQuery(api.sceneWidgets.alertWidgetNames, instanceId ? { instanceId: fromInstanceId(instanceId) } : "skip");
}

function useCreateRequest() {
  const createScene = useAction(api.sceneActions.createScene);
  return useCallback(
    (instanceId: InstanceId, scene: NewScene) => createScene({ instanceId: fromInstanceId(instanceId), ...scene }),
    [createScene]
  );
}

function useUpdateRequest() {
  const updateScene = useAction(api.sceneActions.updateScene);
  return useCallback(
    (instanceId: InstanceId, engineSceneId: string, changes: SceneChanges) =>
      updateScene({ instanceId: fromInstanceId(instanceId), engineSceneId, ...changes }),
    [updateScene]
  );
}

function useRemoveRequest() {
  const deleteScene = useAction(api.sceneActions.deleteScene);
  return useCallback(
    (instanceId: InstanceId, engineSceneId: string) =>
      deleteScene({ instanceId: fromInstanceId(instanceId), engineSceneId }),
    [deleteScene]
  );
}

function useWidgetThemesRequest() {
  const listWidgetThemes = useAction(api.sceneActions.listWidgetThemes);
  return useCallback(
    (instanceId: InstanceId, widgetCanonicalId: string) =>
      listWidgetThemes({ instanceId: fromInstanceId(instanceId), widgetCanonicalId }),
    [listWidgetThemes]
  );
}

function useEditorSessionRequest() {
  const getSceneEditorSession = useAction(api.sceneActions.getSceneEditorSession);
  return useCallback(
    (instanceId: InstanceId, engineSceneId: string) =>
      getSceneEditorSession({ instanceId: fromInstanceId(instanceId), engineSceneId }),
    [getSceneEditorSession]
  );
}

export const convexScenesGateway: ScenesGateway = {
  useScenes,
  useScene,
  useWidgetCatalog,
  useAlertWidgetNames,
  useCreateRequest,
  useUpdateRequest,
  useRemoveRequest,
  useWidgetThemesRequest,
  useEditorSessionRequest,
};
