import { useEngineGateway } from "@/engine/context";
import type { InstanceId } from "@/engine/types";

/** Every scene on the instance; a null id skips the read. */
export function useScenes(instanceId: InstanceId | null) {
  return useEngineGateway().scenes.useScenes(instanceId);
}

/** One scene by the engine's id; null until its webhook arrives. */
export function useScene(instanceId: InstanceId, engineSceneId: string) {
  return useEngineGateway().scenes.useScene(instanceId, engineSceneId);
}

/** The widgets the instance can place, with their module's name; a null id skips the read. */
export function useSceneWidgetCatalog(instanceId: InstanceId | null) {
  return useEngineGateway().scenes.useWidgetCatalog(instanceId);
}

/** Every name the alert widgets on the instance's scenes answer to, the default first; a null id skips the read. */
export function useAlertWidgetNames(instanceId: InstanceId | null) {
  return useEngineGateway().scenes.useAlertWidgetNames(instanceId);
}

/** Alert step targets, and the alert widget names on the instance's other scenes, for one scene's editor. */
export function useAlertTargetUsage(instanceId: InstanceId, engineSceneId: string) {
  return useEngineGateway().scenes.useAlertTargetUsage(instanceId, engineSceneId);
}

export function useCreateSceneRequest() {
  return useEngineGateway().scenes.useCreateRequest();
}

export function useUpdateSceneRequest() {
  return useEngineGateway().scenes.useUpdateRequest();
}

export function useDeleteSceneRequest() {
  return useEngineGateway().scenes.useRemoveRequest();
}

/** Lists the installed themes made for one widget. */
export function useWidgetThemesRequest() {
  return useEngineGateway().scenes.useWidgetThemesRequest();
}

/** Asks the engine for a short-lived grant to open sceneManager's editor socket for one scene. */
export function useSceneEditorSessionRequest() {
  return useEngineGateway().scenes.useEditorSessionRequest();
}
