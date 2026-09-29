import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useStore } from "@nanostores/react";
import { useQuery } from "convex/react";
import { useEffect } from "react";
import { selectInstance } from "@/lib/instance-selection";
import { $currentInstanceId } from "@/lib/stores";

export function useInstance() {
  const instanceId = useStore($currentInstanceId);
  const instances = useQuery(api.instances.listForCurrentUser);

  const list = instances ?? [];
  const { instance, optimisticInstanceId } = selectInstance(instances, instanceId);

  useEffect(() => {
    if (instance && instance._id !== instanceId) {
      $currentInstanceId.set(instance._id);
    }
  }, [instance, instanceId]);

  function setInstance(id: string) {
    $currentInstanceId.set(id);
  }

  return {
    instance,
    instances: list,
    setInstance,
    isLoading: instances === undefined,
    /**
     * Before the membership list loads, the id selected last session; after,
     * the confirmed instance's id. Lets instance-scoped queries subscribe
     * alongside the list instead of a round trip after it. Only for queries
     * that answer an instance the caller is not a member of with nothing; read
     * them through useOptimisticInstanceQuery.
     */
    optimisticInstanceId: optimisticInstanceId as Id<"instances"> | null,
  };
}

export type { Id };
