import type { Id } from "@convex/_generated/dataModel";
import type { MyOrganization } from "@convex/organizations";

/**
 * What the portal is showing. Everyone has a personal scope (their own sponsorships, settings and the engines they
 * can open); an organization scope adds that organization's team, billing and plan.
 */
export type PortalScope = { kind: "personal" } | { kind: "organization"; accountId: Id<"accounts"> };

export const PERSONAL_SCOPE: PortalScope = { kind: "personal" };

/**
 * The scope to show: the person's pick while it still exists, else the organization of the engine they were last in,
 * else one they own, else the first, else personal.
 */
export function resolveScope(
  organizations: readonly MyOrganization[],
  picked: PortalScope | null,
  engineAccountId: Id<"accounts"> | undefined
): PortalScope {
  if (picked?.kind === "personal") {
    return picked;
  }
  const organization =
    organizations.find((org) => org.accountId === (picked?.accountId ?? engineAccountId)) ??
    organizations.find((org) => org.role === "owner") ??
    organizations[0];
  return organization === undefined ? PERSONAL_SCOPE : { kind: "organization", accountId: organization.accountId };
}
