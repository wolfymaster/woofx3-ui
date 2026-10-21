import { useEngineGateway } from "@/engine/context";
import type { ReadOptions } from "@/engine/types";

/** Every scene on the instance. */
export function useScenes(options?: ReadOptions) {
  return useEngineGateway().scenes.useScenes(options);
}

/** One scene by the engine's id; null until its webhook arrives. */
export function useScene(engineSceneId: string) {
  return useEngineGateway().scenes.useScene(engineSceneId);
}

/** The widgets the instance can place, with their module's name. */
export function useSceneWidgetCatalog(options?: ReadOptions) {
  return useEngineGateway().scenes.useWidgetCatalog(options);
}

/** Every name the alert widgets on the instance's scenes answer to, the default first. */
export function useAlertWidgetNames(options?: ReadOptions) {
  return useEngineGateway().scenes.useAlertWidgetNames(options);
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

/** Asks the engine to repair a scene or alert it cannot read. */
export function useRepairSceneRequest() {
  return useEngineGateway().scenes.useRepairRequest();
}

/** Asks the engine for a short-lived grant to open sceneManager's editor socket for one scene. */
export function useSceneEditorSessionRequest() {
  return useEngineGateway().scenes.useEditorSessionRequest();
}
