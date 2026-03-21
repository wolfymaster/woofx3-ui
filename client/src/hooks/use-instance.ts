import { useQuery } from 'convex/react';
import { useStore } from '@nanostores/react';
import { api } from '@convex/_generated/api';
import { $currentInstanceId } from '@/lib/stores';
import type { Id } from '@convex/_generated/dataModel';

export function useInstance() {
  const instanceId = useStore($currentInstanceId);
  const instances = useQuery(api.instances.listForCurrentUser);

  const instance =
    (instanceId
      ? instances?.find((i: { _id: string }) => i?._id === instanceId)
      : null) ??
    instances?.[0] ??
    null;

  function setInstance(id: string) {
    $currentInstanceId.set(id);
  }

  return {
    instance,
    instances: instances ?? [],
    setInstance,
    isLoading: instances === undefined,
  };
}

export type { Id };
