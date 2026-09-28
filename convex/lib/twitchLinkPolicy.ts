/**
 * Who may (re)connect an instance's Twitch link, and to which account.
 * Pure, so the rules can be tested without a Convex runtime.
 */

import type { InstanceRole } from "./instanceRoles";

/**
 * Connecting replaces the channel every member's automation runs against and
 * the tokens it runs with, so it is an owner's or admin's decision.
 */
export function canManageTwitchLink(role: InstanceRole | null | undefined): boolean {
  return role === "owner" || role === "admin";
}

/**
 * Why a completed Twitch sign-in must not replace the instance's link, or null
 * when it may. A relink must come back as the account already linked: signing
 * in as a different Twitch user would silently move the instance to another
 * channel. Moving channels is a disconnect followed by a fresh connect.
 */
export function relinkRefusal(
  existing: { platformUserId: string; platformUsername: string } | null,
  incomingPlatformUserId: string
): string | null {
  if (!existing || existing.platformUserId === incomingPlatformUserId) {
    return null;
  }
  return `This instance is linked to Twitch account @${existing.platformUsername}. Sign in to Twitch as that account to reconnect, or disconnect it first to link a different one.`;
}
