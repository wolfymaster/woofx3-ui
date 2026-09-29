/**
 * What each instance role may do, as one ordering rather than role lists
 * repeated at every call site.
 *
 * - member: read everything on the instance and change its content (modules,
 *   module settings, resources, scenes, workflows, dashboards).
 * - admin / owner: additionally change what the instance is bound to (engine
 *   registration and credentials, deletion, the linked Twitch channel).
 *
 * Pure, so the ordering can be tested without a Convex runtime.
 */

export type InstanceRole = "owner" | "admin" | "member";

const RANK: Record<InstanceRole, number> = { member: 0, admin: 1, owner: 2 };

/** Whether `role` (null when not a member at all) grants at least `required`. */
export function roleSatisfies(role: InstanceRole | null | undefined, required: InstanceRole): boolean {
  if (!role) {
    return false;
  }
  return RANK[role] >= RANK[required];
}
