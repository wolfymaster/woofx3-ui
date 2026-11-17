import type { MyOrganization } from "@convex/organizations";
import { parseCheckoutReturn } from "@/lib/checkout-return";

/** Where the portal sends someone who arrived from the marketing site's "Start free trial" link. */
export const START_TRIAL_PATH = "/auth/onboarding";

/**
 * Whether `/account?start=trial` should go straight to onboarding: only while the
 * caller is on no engine at all, owned or invited to. Onboarding picks up any
 * engine the caller is on, so a member of someone else's organization would be
 * dropped into that organization's engine setup; anyone with an engine just
 * sees the overview.
 */
export function startsTrial(search: string, organizations: ReadonlyArray<Pick<MyOrganization, "engines">>): boolean {
  if (new URLSearchParams(search).get("start") !== "trial") {
    return false;
  }
  return !organizations.some((org) => org.engines.length > 0);
}

/**
 * Whether a return from checkout (`?checkout=done`) belongs to onboarding: the
 * customer paid for a plan before any engine exists, so the engine is next.
 * Checkout returns to the portal; with an engine already there, it stays.
 */
export function resumesOnboarding(
  search: string,
  organizations: ReadonlyArray<Pick<MyOrganization, "engines">>
): boolean {
  return parseCheckoutReturn(search).kind === "done" && !organizations.some((org) => org.engines.length > 0);
}
