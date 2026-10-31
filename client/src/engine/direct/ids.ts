import type {
  MacroId,
  ModuleId,
  SceneId,
  ShoutoutEntryId,
  StreamHighlightId,
  StreamInfoPresetId,
  WebhookEventId,
} from "@/engine/types";

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

/** A macro is the key the gateway stored it under in the engine's local UI settings. */
export function toMacroId(key: string): MacroId {
  return key as MacroId;
}

export function fromMacroId(id: MacroId): string {
  return id as string;
}

/** A preset is its name, the key it is stored under: saving under a name replaces that preset. */
export function toStreamInfoPresetId(name: string): StreamInfoPresetId {
  return name as StreamInfoPresetId;
}

export function fromStreamInfoPresetId(id: StreamInfoPresetId): string {
  return id as string;
}

/** A shoutout entry is the number the desktop host numbers its queue with, as text. */
export function toShoutoutEntryId(hostEntryId: number): ShoutoutEntryId {
  return String(hostEntryId) as ShoutoutEntryId;
}

export function fromShoutoutEntryId(id: ShoutoutEntryId): number {
  const hostEntryId = Number(id);
  if (!Number.isSafeInteger(hostEntryId)) {
    throw new Error(`"${id}" is not a shoutout entry id`);
  }
  return hostEntryId;
}

/** A logged event is the CloudEvent id the engine's event log gives it. */
export function toWebhookEventId(eventId: string): WebhookEventId {
  return eventId as WebhookEventId;
}

export function fromWebhookEventId(id: WebhookEventId): string {
  return id as string;
}
