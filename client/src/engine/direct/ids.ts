import type { ModuleId, SceneId } from "@/engine/types";

// The direct gateway's ids are the engine's own: a scene is its engine scene
// id, a module its manifest id. These convert between the two at the edge,
// and only change the type.

export function toSceneId(engineSceneId: string): SceneId {
  return engineSceneId as SceneId;
}

export function fromSceneId(id: SceneId): string {
  return id as string;
}

/** A module is its manifest id (`woofx3_twitch`), which survives the module being updated. */
export function toModuleId(moduleId: string): ModuleId {
  return moduleId as ModuleId;
}

export function fromModuleId(id: ModuleId): string {
  return id as string;
}
