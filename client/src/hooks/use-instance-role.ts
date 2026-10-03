import { api } from "@convex/_generated/api";
import { type InstanceRole, roleSatisfies } from "@convex/lib/instanceRoles";
import { useQuery } from "convex/react";
import { useInstance } from "@/hooks/use-instance";

/**
 * The signed-in user's role on the current instance: undefined while loading,
 * null when there is no instance or they are not a member.
 */
export function useInstanceRole(): InstanceRole | null | undefined {
  const { instance, isLoading } = useInstance();
  const role = useQuery(api.instances.viewerRole, instance ? { instanceId: instance._id } : "skip");
  if (isLoading) {
    return undefined;
  }
  return instance ? role : null;
}

/** Whether the user may manage the current instance's settings: undefined while loading. */
export function useIsInstanceAdmin(): boolean | undefined {
  const role = useInstanceRole();
  return role === undefined ? undefined : roleSatisfies(role, "admin");
}
