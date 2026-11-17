import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { type ActionCtx, internalQuery, type QueryCtx } from "../_generated/server";
import type { EngineRole, OrgRole } from "../lib/organization";

// Who may do what, for the organization and for each of its engines. Public
// functions decide through `requireAction` (or `can`, for queries that answer
// a refusal with nothing), never by comparing roles themselves.

export type OrgAction =
  | "viewOrganization"
  | "renameOrganization"
  | "manageMembers"
  | "viewMemberEmails"
  | "manageEngines"
  | "renameEngine"
  | "createEngine"
  | "changeEngineUrl"
  | "deleteEngine"
  | "viewBilling"
  | "manageBilling";

/** Which org roles may take each action. Admin is Owner minus billing. */
const ORG_ALLOWED: Record<OrgAction, readonly OrgRole[]> = {
  viewOrganization: ["owner", "admin", "member"],
  renameOrganization: ["owner"],
  manageMembers: ["owner", "admin"],
  // Members are mostly invited by their platform name, so their addresses are
  // private: only the owner, who holds the account, sees them.
  viewMemberEmails: ["owner"],
  // See every engine of the org.
  manageEngines: ["owner", "admin"],
  renameEngine: ["owner"],
  // A new engine starts or extends what the org is billed for, so it is the
  // billing holder's call.
  createEngine: ["owner"],
  // Every engine call sends the engine's credentials to its address, so pointing it elsewhere hands them over.
  changeEngineUrl: ["owner"],
  // Engine admin operates an engine; whether it exists, and what the owner pays for, is the owner's call.
  deleteEngine: ["owner"],
  // The plan and its state, read-only; acting on them is manageBilling.
  viewBilling: ["owner", "admin"],
  manageBilling: ["owner"],
};

export type EngineAction = "viewEngine" | "operateEngine" | "manageEngineMembers";

/**
 * Which engine roles may take each action. An engine role is granted per
 * engine, so nothing here may spend the org's money or decide whether an
 * engine exists: those are org actions, checked on the engine's org.
 */
const ENGINE_ALLOWED: Record<EngineAction, readonly EngineRole[]> = {
  viewEngine: ["owner", "admin", "member"],
  // What the engine is bound to and how it runs: registration, builds, upgrades, the linked channel.
  operateEngine: ["owner", "admin"],
  // Who is on the engine and with which engine role.
  manageEngineMembers: ["owner", "admin"],
};

export type Action = OrgAction | EngineAction;

export const ORG_ACTIONS = Object.keys(ORG_ALLOWED) as OrgAction[];
export const ENGINE_ACTIONS = Object.keys(ENGINE_ALLOWED) as EngineAction[];

export const orgActionValidator = v.union(
  v.literal("viewOrganization"),
  v.literal("renameOrganization"),
  v.literal("manageMembers"),
  v.literal("viewMemberEmails"),
  v.literal("manageEngines"),
  v.literal("renameEngine"),
  v.literal("createEngine"),
  v.literal("changeEngineUrl"),
  v.literal("deleteEngine"),
  v.literal("viewBilling"),
  v.literal("manageBilling")
);

export const engineActionValidator = v.union(
  v.literal("viewEngine"),
  v.literal("operateEngine"),
  v.literal("manageEngineMembers")
);

function isEngineAction(action: Action): action is EngineAction {
  return action in ENGINE_ALLOWED;
}

/** Whether `role` (null when not in the org) may take `action`. Pure. */
export function orgCan(role: OrgRole | null, action: OrgAction): boolean {
  return role !== null && ORG_ALLOWED[action].includes(role);
}

/** Whether `role` (null when not on the engine) may take `action`. Pure. */
export function engineCan(role: EngineRole | null, action: EngineAction): boolean {
  return role !== null && ENGINE_ALLOWED[action].includes(role);
}

/** A user's roles for a subject: the engine role is null for an org, or when they are not on the engine. */
export interface Roles {
  org: OrgRole | null;
  engine: EngineRole | null;
}

/** Whether someone holding `roles` may take `action`; each action is decided by its own table. Pure. */
export function can(roles: Roles, action: Action): boolean {
  return isEngineAction(action) ? engineCan(roles.engine, action) : orgCan(roles.org, action);
}

/** What an action is taken on: an org, or one engine (whose org decides the org actions). */
export type Subject = { org: Id<"accounts"> } | { engine: Id<"instances"> };

/** Engine actions need an engine to be decided on. */
type SubjectFor<A extends Action> = A extends EngineAction ? { engine: Id<"instances"> } : Subject;

export type Refusal =
  | { code: "not_authenticated"; message: string }
  | { code: "organization_not_found"; accountId: Id<"accounts">; message: string }
  | { code: "engine_not_found"; instanceId: Id<"instances">; message: string }
  | { code: "not_authorized"; action: Action; message: string };

/** The user allowed an action, with the org it was decided in. */
export interface Actor {
  userId: Id<"users">;
  account: Doc<"accounts">;
  roles: Roles;
}

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

/** The user's role on the engine, or null when they aren't on it. */
export async function engineRoleOf(
  ctx: QueryCtx,
  instanceId: Id<"instances">,
  userId: Id<"users">
): Promise<EngineRole | null> {
  const row = await ctx.db
    .query("instanceMembers")
    .withIndex("by_instance_user", (q) => q.eq("instanceId", instanceId).eq("userId", userId))
    .first();
  return row?.role ?? null;
}

async function subjectAccount(ctx: QueryCtx, subject: Subject): Promise<Doc<"accounts">> {
  if ("org" in subject) {
    const account = await ctx.db.get(subject.org);
    if (account === null) {
      throw new ConvexError<Refusal>({
        code: "organization_not_found",
        accountId: subject.org,
        message: "Organization not found",
      });
    }
    return account;
  }
  const instance = await ctx.db.get(subject.engine);
  if (instance === null) {
    throw new ConvexError<Refusal>({
      code: "engine_not_found",
      instanceId: subject.engine,
      message: "Engine not found",
    });
  }
  const account = await ctx.db.get(instance.accountId);
  if (account === null) {
    throw new Error(`Engine ${instance._id} belongs to missing org ${instance.accountId}`);
  }
  return account;
}

/** `requireAction` for a known user, as internal functions called on someone's behalf need. */
export async function requireActionFor<A extends Action>(
  ctx: QueryCtx,
  userId: Id<"users">,
  subject: SubjectFor<A>,
  action: A
): Promise<Actor> {
  const account = await subjectAccount(ctx, subject);
  const roles: Roles = {
    org: await orgRoleOf(ctx, account, userId),
    engine: "engine" in subject ? await engineRoleOf(ctx, subject.engine, userId) : null,
  };
  if (!can(roles, action)) {
    throw new ConvexError<Refusal>({
      code: "not_authorized",
      action,
      message: isEngineAction(action)
        ? "Your role on this engine doesn't allow this"
        : "Your organization role doesn't allow this",
    });
  }
  return { userId, account, roles };
}

async function requireSignedIn(ctx: QueryCtx | ActionCtx): Promise<Id<"users">> {
  const userId = await getAuthUserId(ctx);
  if (userId === null) {
    throw new ConvexError<Refusal>({ code: "not_authenticated", message: "Not authenticated" });
  }
  return userId;
}

/** The signed-in caller, when they may take `action` on `subject`. Throws a `ConvexError<Refusal>` otherwise. */
export async function requireAction<A extends Action>(
  ctx: QueryCtx,
  subject: SubjectFor<A>,
  action: A
): Promise<Actor> {
  return requireActionFor(ctx, await requireSignedIn(ctx), subject, action);
}

/** `requireAction` for actions, which cannot read the db directly. */
export async function requireActionInAction<A extends Action>(
  ctx: ActionCtx,
  subject: SubjectFor<A>,
  action: A
): Promise<Actor> {
  const userId = await requireSignedIn(ctx);
  return ctx.runQuery(internal.org.policy.authorize, { userId, subject, action });
}

/** `requireActionFor` behind a query, for `requireActionInAction`. */
export const authorize = internalQuery({
  args: {
    userId: v.id("users"),
    subject: v.union(v.object({ org: v.id("accounts") }), v.object({ engine: v.id("instances") })),
    action: v.union(orgActionValidator, engineActionValidator),
  },
  handler: async (ctx, { userId, subject, action }): Promise<Actor> => {
    if (isEngineAction(action) && !("engine" in subject)) {
      throw new Error(`authorize: engine action ${action} needs an engine subject`);
    }
    return requireActionFor<Action>(ctx, userId, subject, action);
  },
});
