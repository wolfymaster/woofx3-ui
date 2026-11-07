import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import type { OrgRole } from "./organization";

export type OrgAction =
  | "viewOrganization"
  | "renameOrganization"
  | "manageMembers"
  | "manageEngines"
  | "createEngine"
  | "viewBilling"
  | "manageBilling";

/** Which org roles may take each action. Admin is Owner minus billing. */
const ALLOWED: Record<OrgAction, readonly OrgRole[]> = {
  viewOrganization: ["owner", "admin", "member"],
  renameOrganization: ["owner", "admin"],
  manageMembers: ["owner", "admin"],
  // See every engine of the org and rename them.
  manageEngines: ["owner", "admin"],
  // A new engine starts or extends what the org is billed for, so it is the
  // billing holder's call.
  createEngine: ["owner"],
  // The plan and its state, read-only; acting on them is manageBilling.
  viewBilling: ["owner", "admin"],
  manageBilling: ["owner"],
};

export const ORG_ACTIONS = Object.keys(ALLOWED) as OrgAction[];

/** Whether `role` (null when not in the org) may take `action`. Pure. */
export function orgCan(role: OrgRole | null, action: OrgAction): boolean {
  return role !== null && ALLOWED[action].includes(role);
}

export type OrgRefusal =
  | { code: "not_authenticated"; message: string }
  | { code: "organization_not_found"; accountId: Id<"accounts">; message: string }
  | { code: "not_authorized"; action: OrgAction; message: string };

/**
 * The user's role in the org, or null when they aren't in it.
 *
 * Ownership is `accounts.ownerId` alone. An `owner` membership row for anyone
 * else breaks I1 and counts as `admin` until `migrations/organizations`
 * demotes it, so a stray row never grants billing. A duplicate row reads as
 * the first one, as every membership lookup does; checkOrgInvariants reports it.
 */
export async function orgRoleOf(ctx: QueryCtx, account: Doc<"accounts">, userId: Id<"users">): Promise<OrgRole | null> {
  if (account.ownerId === userId) {
    return "owner";
  }
  const row = await ctx.db
    .query("accountMembers")
    .withIndex("by_account_user", (q) => q.eq("accountId", account._id).eq("userId", userId))
    .first();
  if (row === null) {
    return null;
  }
  return row.role === "owner" ? "admin" : row.role;
}

export interface OrgActor {
  userId: Id<"users">;
  role: OrgRole;
  account: Doc<"accounts">;
}

/** `requireOrgAction` for a known user, as internal functions called on someone's behalf need. */
export async function requireOrgActionFor(
  ctx: QueryCtx,
  accountId: Id<"accounts">,
  userId: Id<"users">,
  action: OrgAction
): Promise<OrgActor> {
  const account = await ctx.db.get(accountId);
  if (account === null) {
    throw new ConvexError<OrgRefusal>({
      code: "organization_not_found",
      accountId,
      message: "Organization not found",
    });
  }
  const role = await orgRoleOf(ctx, account, userId);
  if (role === null || !orgCan(role, action)) {
    throw new ConvexError<OrgRefusal>({
      code: "not_authorized",
      action,
      message: "Your organization role doesn't allow this",
    });
  }
  return { userId, role, account };
}

/** The signed-in caller, when their org role allows `action`. Throws a `ConvexError<OrgRefusal>` otherwise. */
export async function requireOrgAction(ctx: QueryCtx, accountId: Id<"accounts">, action: OrgAction): Promise<OrgActor> {
  const userId = await getAuthUserId(ctx);
  if (userId === null) {
    throw new ConvexError<OrgRefusal>({ code: "not_authenticated", message: "Not authenticated" });
  }
  return requireOrgActionFor(ctx, accountId, userId, action);
}
