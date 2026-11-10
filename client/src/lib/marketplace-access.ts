import { type InstanceRole, roleSatisfies } from "@convex/lib/instanceRoles";

/**
 * Payments belong to the account, so only its owner may start one. The
 * server refuses anyone else; this keeps the UI from offering what it would
 * refuse. `undefined` is a role still loading, which cannot pay.
 */
export function canStartPayment(role: InstanceRole | null | undefined): boolean {
  return roleSatisfies(role, "owner");
}

export const OWNER_MUST_PURCHASE_MESSAGE = "Only the account owner can buy this. Ask an owner to purchase it.";
