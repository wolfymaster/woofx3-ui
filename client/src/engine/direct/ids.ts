import type { SceneId } from "@/engine/types";

// The direct gateway's ids are the engine's own: a scene is its engine scene
// id. These convert between the two at the edge, and only change the type.

export function toSceneId(engineSceneId: string): SceneId {
  return engineSceneId as SceneId;
}

export function fromSceneId(id: SceneId): string {
  return id as string;
}
