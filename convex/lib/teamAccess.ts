import { getAuthUserId } from "@convex-dev/auth/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import type { EngineRole, OrgRole } from "./organization";

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function getInstanceMembership(ctx: QueryCtx, instanceId: Id<"instances">, userId: Id<"users">) {
  return ctx.db
    .query("instanceMembers")
    .withIndex("by_instance_user", (q) => q.eq("instanceId", instanceId).eq("userId", userId))
    .first();
}

/**
 * Whether the caller is signed in and a member of the instance.
 *
 * For read paths that answer with nothing rather than raising: every one of
 * these is a live `useQuery` subscription, and a throw during the moment
 * between mount and auth resolving surfaces in the UI as a crashed panel
 * instead of an empty one. Callers that change data should reject instead.
 */
export async function isInstanceMember(ctx: QueryCtx, instanceId: Id<"instances">): Promise<boolean> {
  const userId = await getAuthUserId(ctx);
  if (!userId) {
    return false;
  }
  return (await getInstanceMembership(ctx, instanceId, userId)) !== null;
}

export interface TeamMemberDto {
  userId: Id<"users">;
  name: string;
  /** Present only for a viewer allowed `viewMemberEmails`; null when the member has no address. */
  email?: string | null;
  image: string | null;
  orgRole: OrgRole | null;
  engineRole: EngineRole;
  createdAt: number | null;
}

/** Platform display names (a Twitch name) of the people who linked a platform on these engines, by user id. */
export async function linkedPlatformNames(
  ctx: QueryCtx,
  instanceIds: ReadonlyArray<Id<"instances">>
): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  for (const instanceId of instanceIds) {
    const links = await ctx.db
      .query("platformLinks")
      .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
      .collect();
    for (const link of links) {
      if (link.connectedByUserId !== undefined && !names.has(link.connectedByUserId)) {
        names.set(link.connectedByUserId, link.platformUsername);
      }
    }
  }
  return names;
}

/** What a member list calls someone: their name, else the platform name they linked, else "Member". Never their email. */
export function memberDisplayName(user: Doc<"users">, platformNames: ReadonlyMap<string, string>): string {
  const name = user.name?.trim();
  if (name) {
    return name;
  }
  return platformNames.get(user._id) ?? "Member";
}

/** The member's email for a viewer allowed to see it, as a field to spread into a DTO; nothing otherwise. */
export function memberEmailField(user: Doc<"users">, showEmail: boolean): { email?: string | null } {
  return showEmail ? { email: user.email ?? null } : {};
}

/**
 * An address with all but the first character of its local part hidden
 * (`w***@example.com`), so someone who may not read members' addresses can
 * still tell invitations apart.
 */
export function maskedEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 1) {
    return "***";
  }
  return `${email[0]}***${email.slice(at)}`;
}

export function toTeamMemberDto(
  user: Doc<"users">,
  membership: Doc<"instanceMembers">,
  orgRole: OrgRole | null,
  name: string,
  showEmail: boolean
): TeamMemberDto {
  return {
    userId: user._id,
    name,
    ...memberEmailField(user, showEmail),
    image: user.image ?? null,
    orgRole,
    engineRole: membership.role,
    createdAt: membership.createdAt ?? null,
  };
}
