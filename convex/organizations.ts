import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, type QueryCtx, query } from "./_generated/server";
import type { SubscriptionSummary } from "./lib/entitlements";
import type { EngineRole, OrgRole } from "./lib/organization";
import type { ProjectedDiscount } from "./lib/orgBilling";
import { linkedPlatformNames, memberDisplayName, memberEmailField } from "./lib/teamAccess";
import { loadOrgContext, type OrgContext } from "./org/context";
import { can, ORG_ACTIONS, type OrgAction, orgCan, orgRoleOf, requireAction, viewerRoles } from "./org/policy";

// The org portal's reads. Storage calls an organization an account; these
// answer in the portal's terms. What each role sees follows orgCan: a page a
// role can't see answers null rather than throwing, so the portal can hide it.

/** Organization names are shown in headers and emails, so they stay short. */
export const MAX_ORGANIZATION_NAME_LENGTH = 64;

type ProvisioningStatus = Doc<"engineProvisioning">["status"];

export interface OrgEngine {
  instanceId: Id<"instances">;
  name: string;
  hosting: "managed" | "external";
  /** A managed engine's provisioning status; null for a self-hosted one. */
  status: ProvisioningStatus | null;
  /** Whether the caller is on the engine, so "Open dashboard" works for them. */
  canOpen: boolean;
}

/** The subscription as the portal shows it. The discount is billing detail, so only the owner gets it. */
export interface OrgSubscription extends SubscriptionSummary {
  spinDownAt: number | null;
  /** A provider subscription exists, so plan changes go through the provider's portal. */
  hasProviderSubscription: boolean;
  discount: ProjectedDiscount | null;
}

export type OrgCapabilities = Record<OrgAction, boolean>;

export interface MyOrganization {
  accountId: Id<"accounts">;
  name: string;
  role: OrgRole;
  can: OrgCapabilities;
  /** Every engine of the org for owners and admins; the ones they're on for members. */
  engines: OrgEngine[];
  /** Null for a role that can't see billing. */
  subscription: OrgSubscription | null;
  /**
   * Null for a role that can't manage members. `limit` is null when no seat
   * limit applies: an org with only self-hosted engines, or a plan without one.
   */
  seats: { used: number; limit: number | null } | null;
}

function capabilities(role: OrgRole): OrgCapabilities {
  return Object.fromEntries(ORG_ACTIONS.map((action) => [action, orgCan(role, action)])) as OrgCapabilities;
}

async function orgEngines(ctx: QueryCtx, org: OrgContext, userId: Id<"users">, all: boolean) {
  const engines: OrgEngine[] = [];
  for (const instance of org.instances) {
    const membership = await ctx.db
      .query("instanceMembers")
      .withIndex("by_instance_user", (q) => q.eq("instanceId", instance._id).eq("userId", userId))
      .first();
    if (!all && membership === null) {
      continue;
    }
    const managed = instance.hosting === "managed";
    const provisioning = managed
      ? await ctx.db
          .query("engineProvisioning")
          .withIndex("by_instance", (q) => q.eq("instanceId", instance._id))
          .first()
      : null;
    engines.push({
      instanceId: instance._id,
      name: instance.name,
      hosting: managed ? "managed" : "external",
      status: provisioning?.status ?? null,
      canOpen: membership !== null,
    });
  }
  return engines;
}

function orgSubscription(org: OrgContext): OrgSubscription | null {
  if (org.billing === null) {
    return null;
  }
  return {
    ...org.billing.summary,
    spinDownAt: org.billing.spinDownAt,
    hasProviderSubscription: org.billing.hasProviderSubscription,
    discount: orgCan(org.role, "manageBilling") ? org.billing.discount : null,
  };
}

async function myOrganization(
  ctx: QueryCtx,
  accountId: Id<"accounts">,
  userId: Id<"users">
): Promise<MyOrganization | null> {
  const org = await loadOrgContext(ctx, accountId, userId);
  if (org === null) {
    return null;
  }
  const allowed = capabilities(org.role);
  return {
    accountId,
    name: org.account.name,
    role: org.role,
    can: allowed,
    engines: await orgEngines(ctx, org, userId, allowed.manageEngines),
    subscription: allowed.viewBilling ? orgSubscription(org) : null,
    seats: allowed.manageMembers ? org.seats : null,
  };
}

/**
 * What the caller may do in the organization that owns `instanceId`, for an
 * engine's screens that act for it (paying for a listing, reading a license
 * key); null when they are not in it or the engine does not exist.
 */
export const capabilitiesForInstance = query({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, { instanceId }): Promise<OrgCapabilities | null> => {
    const viewer = await viewerRoles(ctx, { engine: instanceId });
    if (viewer === null || viewer.roles.org === null) {
      return null;
    }
    return capabilities(viewer.roles.org);
  },
});

/** The organizations the caller belongs to, each as their role may see it. */
export const mine = query({
  args: {},
  handler: async (ctx): Promise<MyOrganization[]> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      return [];
    }
    const owned = await ctx.db
      .query("accounts")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .collect();
    const rows = await ctx.db
      .query("accountMembers")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const accountIds = new Set<Id<"accounts">>([...owned.map((a) => a._id), ...rows.map((r) => r.accountId)]);
    const organizations: MyOrganization[] = [];
    for (const accountId of accountIds) {
      const organization = await myOrganization(ctx, accountId, userId);
      if (organization !== null) {
        organizations.push(organization);
      }
    }
    return organizations;
  },
});

export interface OrgMember {
  userId: Id<"users">;
  name: string;
  /** Present only for a viewer allowed `viewMemberEmails`; null when the member has no address. */
  email?: string | null;
  image: string | null;
  role: OrgRole;
  engines: Array<{ instanceId: Id<"instances">; name: string; role: EngineRole }>;
}

/** The org's members with their engines, for a role that may manage members; null otherwise. */
export const members = query({
  args: { accountId: v.id("accounts") },
  handler: async (ctx, { accountId }): Promise<OrgMember[] | null> => {
    const viewer = await viewerRoles(ctx, { org: accountId });
    if (viewer === null || !can(viewer.roles, "manageMembers")) {
      return null;
    }
    const { account } = viewer;
    const showEmails = can(viewer.roles, "viewMemberEmails");
    const instances = await ctx.db
      .query("instances")
      .withIndex("by_account", (q) => q.eq("accountId", accountId))
      .collect();
    const platformNames = await linkedPlatformNames(
      ctx,
      instances.map((instance) => instance._id)
    );
    const rows = await ctx.db
      .query("accountMembers")
      .withIndex("by_account", (q) => q.eq("accountId", accountId))
      .collect();
    const result: OrgMember[] = [];
    for (const row of rows) {
      const user = await ctx.db.get(row.userId);
      const role = await orgRoleOf(ctx, account, row.userId);
      if (user === null || role === null) {
        continue;
      }
      const engines: OrgMember["engines"] = [];
      for (const instance of instances) {
        const membership = await ctx.db
          .query("instanceMembers")
          .withIndex("by_instance_user", (q) => q.eq("instanceId", instance._id).eq("userId", row.userId))
          .first();
        if (membership !== null) {
          engines.push({ instanceId: instance._id, name: instance.name, role: membership.role });
        }
      }
      result.push({
        userId: user._id,
        name: memberDisplayName(user, platformNames),
        ...memberEmailField(user, showEmails),
        image: user.image ?? null,
        role,
        engines,
      });
    }
    return result;
  },
});

export const rename = mutation({
  args: { accountId: v.id("accounts"), name: v.string() },
  handler: async (ctx, { accountId, name }) => {
    await requireAction(ctx, { org: accountId }, "renameOrganization");
    const trimmed = name.trim();
    if (trimmed === "" || trimmed.length > MAX_ORGANIZATION_NAME_LENGTH) {
      throw new ConvexError({
        code: "invalid_name",
        message: `An organization name is 1 to ${MAX_ORGANIZATION_NAME_LENGTH} characters`,
      });
    }
    await ctx.db.patch(accountId, { name: trimmed });
  },
});
