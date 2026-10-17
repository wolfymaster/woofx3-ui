import { api } from "@convex/_generated/api";
import { useAction, useQuery } from "convex/react";
import { useCallback } from "react";
import type { ScenesGateway } from "@/engine/gateway";
import type { InstanceId, NewScene, SceneChanges } from "@/engine/types";

function useScenes(instanceId: InstanceId | null) {
  return useQuery(api.scenes.list, instanceId ? { instanceId } : "skip");
}

function useScene(instanceId: InstanceId, engineSceneId: string) {
  return useQuery(api.scenes.getByEngineSceneId, { instanceId, engineSceneId });
}

function useWidgetCatalog(instanceId: InstanceId | null) {
  return useQuery(api.sceneWidgets.listForInstance, instanceId ? { instanceId } : "skip");
}

function useAlertWidgetNames(instanceId: InstanceId | null) {
  return useQuery(api.sceneWidgets.alertWidgetNames, instanceId ? { instanceId } : "skip");
}

function useCreateRequest() {
  const createScene = useAction(api.sceneActions.createScene);
  return useCallback((instanceId: InstanceId, scene: NewScene) => createScene({ instanceId, ...scene }), [createScene]);
}

function useUpdateRequest() {
  const updateScene = useAction(api.sceneActions.updateScene);
  return useCallback(
    (instanceId: InstanceId, engineSceneId: string, changes: SceneChanges) =>
      updateScene({ instanceId, engineSceneId, ...changes }),
    [updateScene]
  );
}

function useRemoveRequest() {
  const deleteScene = useAction(api.sceneActions.deleteScene);
  return useCallback(
    (instanceId: InstanceId, engineSceneId: string) => deleteScene({ instanceId, engineSceneId }),
    [deleteScene]
  );
}

function useWidgetThemesRequest() {
  const listWidgetThemes = useAction(api.sceneActions.listWidgetThemes);
  return useCallback(
    (instanceId: InstanceId, widgetCanonicalId: string) => listWidgetThemes({ instanceId, widgetCanonicalId }),
    [listWidgetThemes]
  );
}

function useEditorSessionRequest() {
  const getSceneEditorSession = useAction(api.sceneActions.getSceneEditorSession);
  return useCallback(
    (instanceId: InstanceId, engineSceneId: string) => getSceneEditorSession({ instanceId, engineSceneId }),
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
