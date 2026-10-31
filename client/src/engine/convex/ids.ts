import type { Id } from "@convex/_generated/dataModel";
import type {
  InstanceId,
  MacroId,
  ModuleId,
  PinHistoryEntryId,
  SceneId,
  SetupImportId,
  ShoutoutEntryId,
  StreamHighlightId,
  StreamInfoPresetId,
  WebhookEventId,
} from "@/engine/types";

// The Convex gateway's ids are Convex document ids: an instance is its
// `instances` row, an installed module its `moduleRepository` row, a scene
// its `scenes` row. These convert between the two at the edge, and only
// change the type. Outside the adapter, only the boot wiring and
// lib/cloud-ids.ts may use them.

// A missing id converts to the same missing value, so a caller's null or
// undefined passes through untouched.

export function toInstanceId(id: Id<"instances">): InstanceId;
export function toInstanceId(id: Id<"instances"> | undefined): InstanceId | undefined;
export function toInstanceId(id: Id<"instances"> | null): InstanceId | null;
export function toInstanceId(id: Id<"instances"> | null | undefined): InstanceId | null | undefined;
export function toInstanceId(id: Id<"instances"> | null | undefined): InstanceId | null | undefined {
  return id as string | null | undefined as InstanceId | null | undefined;
}

export function fromInstanceId(id: InstanceId): Id<"instances"> {
  return id as string as Id<"instances">;
}

export function toModuleId(id: Id<"moduleRepository">): ModuleId;
export function toModuleId(id: Id<"moduleRepository"> | undefined): ModuleId | undefined;
export function toModuleId(id: Id<"moduleRepository"> | null): ModuleId | null;
export function toModuleId(id: Id<"moduleRepository"> | null | undefined): ModuleId | null | undefined;
export function toModuleId(id: Id<"moduleRepository"> | null | undefined): ModuleId | null | undefined {
  return id as string | null | undefined as ModuleId | null | undefined;
}

export function fromModuleId(id: ModuleId): Id<"moduleRepository"> {
  return id as string as Id<"moduleRepository">;
}

export function toMacroId(id: Id<"macros">): MacroId {
  return id as string as MacroId;
}

export function fromMacroId(id: MacroId): Id<"macros"> {
  return id as string as Id<"macros">;
}

export function toWebhookEventId(id: Id<"engineEventLog">): WebhookEventId {
  return id as string as WebhookEventId;
}

export function fromWebhookEventId(id: WebhookEventId): Id<"engineEventLog"> {
  return id as string as Id<"engineEventLog">;
}

export function toSceneId(id: Id<"scenes">): SceneId {
  return id as string as SceneId;
}

export function fromSceneId(id: SceneId): Id<"scenes"> {
  return id as string as Id<"scenes">;
}

export function toSetupImportId(id: Id<"setupImports">): SetupImportId {
  return id as string as SetupImportId;
}

export function fromSetupImportId(id: SetupImportId): Id<"setupImports"> {
  return id as string as Id<"setupImports">;
}

export function toPinHistoryEntryId(id: Id<"pinnedMessages">): PinHistoryEntryId {
  return id as string as PinHistoryEntryId;
}

export function fromPinHistoryEntryId(id: PinHistoryEntryId): Id<"pinnedMessages"> {
  return id as string as Id<"pinnedMessages">;
}

export function toShoutoutEntryId(id: Id<"shoutoutQueue">): ShoutoutEntryId {
  return id as string as ShoutoutEntryId;
}

export function fromShoutoutEntryId(id: ShoutoutEntryId): Id<"shoutoutQueue"> {
  return id as string as Id<"shoutoutQueue">;
}

export function toStreamInfoPresetId(id: Id<"streamInfoPresets">): StreamInfoPresetId {
  return id as string as StreamInfoPresetId;
}

export function fromStreamInfoPresetId(id: StreamInfoPresetId): Id<"streamInfoPresets"> {
  return id as string as Id<"streamInfoPresets">;
}

export function toStreamHighlightId(id: Id<"streamHighlights">): StreamHighlightId {
  return id as string as StreamHighlightId;
}

export function fromStreamHighlightId(id: StreamHighlightId): Id<"streamHighlights"> {
  return id as string as Id<"streamHighlights">;
}
