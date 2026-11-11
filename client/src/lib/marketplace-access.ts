import type { OrganizationAccess } from "@/engine/types";

// Payments and license keys belong to the organization that owns the engine,
// so the caller's organization role decides them. The server refuses anyone
// else; these keep the UI from offering what it would refuse. `undefined` is
// access still loading, which allows nothing.

/** Only who manages the organization's billing, its owner, may start a payment. */
export function canStartPayment(access: OrganizationAccess | null | undefined): boolean {
  return access?.manageBilling === true;
}

/**
 * A license key downloads the module, so only those who see the
 * organization's billing (its owner and admins) may see or copy it. Anyone
 * else is never sent it.
 */
export function canSeeLicenseKey(access: OrganizationAccess | null | undefined): boolean {
  return access?.viewBilling === true;
}

export const OWNER_MUST_PURCHASE_MESSAGE = "Only the organization's owner can buy this. Ask them to purchase it.";
