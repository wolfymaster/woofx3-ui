import type { Id } from "@convex/_generated/dataModel";
import type { InstanceId, MacroId, ModuleId, WebhookEventId } from "@/engine/types";

// The Convex gateway's ids are Convex document ids: an instance is its
// `instances` row, an installed module its `moduleRepository` row. These
// convert between the two at the edge. They only change the type, so code
// that already holds a Convex id (from a cloud-owned query) uses them to call
// the gateway with it.

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
