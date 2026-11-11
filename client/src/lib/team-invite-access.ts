export type TeamInviteAccess = "loading" | "allowed" | "denied";

/**
 * Whether the viewer may create invitations, from the engine team query's result:
 * undefined while loading, null for a non-member. `canManage` there is the engine-admin
 * check the invite actions enforce.
 */
export function teamInviteAccess(team: { canManage: boolean } | null | undefined): TeamInviteAccess {
  if (team === undefined) {
    return "loading";
  }
  return team?.canManage ? "allowed" : "denied";
}
