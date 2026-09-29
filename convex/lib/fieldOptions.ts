import type { RpcTarget } from "@woofx3/api/client";
import { v } from "convex/values";

/**
 * How the dashboard asks the engine for a field's options, or to press a
 * settings button: by naming where the field is declared, never by sending
 * the request. The engine reads the request from the installed module's
 * manifest, so a signed-in user cannot make it send anything a module did not
 * declare.
 *
 * Declared here rather than imported because `@woofx3/api` on the engine's
 * master does not export them yet. They must match `FieldOptionsDeclaration`,
 * `FieldOptionsReference` and `dispatchFieldOptionsRequest` in the engine's
 * `shared/clients/typescript/api/api.ts`. Once `@woofx3/api` exports them,
 * import them from there and delete these.
 */
export type FieldOptionsDeclaration = "trigger" | "action" | "widget" | "resource" | "setting";

export interface FieldOptionsReference {
  /** Manifest-local module id, the first segment of the module's canonical ids. */
  moduleId: string;
  declaration: FieldOptionsDeclaration;
  /** The trigger, action or widget id, or the resource kind. Absent for a module setting. */
  declarationId?: string;
  fieldId: string;
}

export interface FieldOptionsApi extends RpcTarget {
  dispatchFieldOptionsRequest(
    reference: FieldOptionsReference,
    correlationKey: string
  ): Promise<{ dispatched: boolean }>;
}

export const fieldOptionsReferenceValidator = v.object({
  moduleId: v.string(),
  declaration: v.union(
    v.literal("trigger"),
    v.literal("action"),
    v.literal("widget"),
    v.literal("resource"),
    v.literal("setting")
  ),
  declarationId: v.optional(v.string()),
  fieldId: v.string(),
});
