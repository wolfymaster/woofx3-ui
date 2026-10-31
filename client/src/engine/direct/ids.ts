import type { ModuleId, SceneId, StreamHighlightId, WebhookEventId } from "@/engine/types";

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

/** A highlight is the key the gateway stored it under in the engine's local UI settings. */
export function toStreamHighlightId(key: string): StreamHighlightId {
  return key as StreamHighlightId;
}

export function fromStreamHighlightId(id: StreamHighlightId): string {
  return id as string;
}

/** A logged event is the CloudEvent id the engine's event log gives it. */
export function toWebhookEventId(eventId: string): WebhookEventId {
  return eventId as WebhookEventId;
}

export function fromWebhookEventId(id: WebhookEventId): string {
  return id as string;
}
