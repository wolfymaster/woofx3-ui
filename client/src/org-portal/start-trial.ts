import type { MyOrganization } from "@convex/organizations";

/** Where the portal sends someone who arrived from the marketing site's "Start free trial" link. */
export const START_TRIAL_PATH = "/auth/onboarding";

/**
 * Whether `/org/?start=trial` should go straight to onboarding: only while the
 * caller owns no organization with an engine, so an owner who already has one
 * just sees the overview.
 */
export function startsTrial(
  search: string,
  organizations: ReadonlyArray<Pick<MyOrganization, "role" | "engines">>
): boolean {
  if (new URLSearchParams(search).get("start") !== "trial") {
    return false;
  }
  return !organizations.some((org) => org.role === "owner" && org.engines.length > 0);
}
