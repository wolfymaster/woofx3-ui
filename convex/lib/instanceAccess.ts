import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx, QueryCtx } from "../_generated/server";
import { type InstanceRole, roleSatisfies } from "./instanceRoles";
import type { OrgAction, OrgRefusal } from "./orgRoles";
import { getInstanceMembership } from "./teamAccess";

// Guards for public functions that act on one instance. An instance id is not
// a secret -- it travels in URLs and query args -- so being signed in proves
// nothing about access to it; only an instanceMembers row does. Queries that
// answer a non-member with nothing rather than throwing use isInstanceMember
// in teamAccess.ts.

/**
 * The caller's user id when they hold at least `required` on the instance.
 * Throws otherwise, for mutations and actions that change something.
 */
export async function requireInstanceRole(
  ctx: QueryCtx,
  instanceId: Id<"instances">,
  required: InstanceRole = "member"
): Promise<Id<"users">> {
  const userId = await getAuthUserId(ctx);
  if (!userId) {
    throw new Error("Not authenticated");
  }
  const membership = await getInstanceMembership(ctx, instanceId, userId);
  if (!roleSatisfies(membership?.role, required)) {
    throw new Error("Not authorized for this instance");
  }
  return userId;
}

/** `requireInstanceRole` for actions, which cannot read the db directly. */
export async function requireInstanceRoleInAction(
  ctx: ActionCtx,
  instanceId: Id<"instances">,
  required: InstanceRole = "member"
): Promise<Id<"users">> {
  const userId = await getAuthUserId(ctx);
  if (!userId) {
    throw new Error("Not authenticated");
  }
  const membership = await ctx.runQuery(internal.instances.getMembership, { instanceId, userId });
  if (!roleSatisfies(membership?.role, required)) {
    throw new Error("Not authorized for this instance");
  }
  return userId;
}

/**
 * The caller and the instance's organization when the caller's role in that
 * organization allows `action`. For what belongs to the organization rather
 * than the engine, such as payments and license keys: the organization role
 * decides, not the instance role. Throws a `ConvexError<OrgRefusal>` otherwise.
 */
export async function requireOrgActionOnInstanceInAction(
  ctx: ActionCtx,
  instanceId: Id<"instances">,
  action: OrgAction
): Promise<{ userId: Id<"users">; accountId: Id<"accounts"> }> {
  const userId = await getAuthUserId(ctx);
  if (!userId) {
    throw new ConvexError<OrgRefusal>({ code: "not_authenticated", message: "Not authenticated" });
  }
  const accountId = await ctx.runQuery(internal.instances.requireOrgActionOnInstance, { instanceId, userId, action });
  return { userId, accountId };
}
