import { useEffect } from 'react';
import { useQuery } from 'convex/react';
import { useStore } from '@nanostores/react';
import { api } from '@convex/_generated/api';
import { $currentInstanceId } from '@/lib/stores';
import type { Id } from '@convex/_generated/dataModel';

export function useInstance() {
  const instanceId = useStore($currentInstanceId);
  const instances = useQuery(api.instances.listForCurrentUser);

  const list = instances ?? [];

  useEffect(() => {
    if (instances === undefined || instances.length === 0) {
      return;
    }
    const first = instances.find((i) => i !== null);
    if (!first) {
      return;
    }
    if (!instanceId || !instances.some((i) => i !== null && i._id === instanceId)) {
      $currentInstanceId.set(first._id);
    }
  }, [instances, instanceId]);

  const instance =
    (instanceId ? list.find((i) => i !== null && i._id === instanceId) : null) ?? list.find(Boolean) ?? null;

  function setInstance(id: string) {
    $currentInstanceId.set(id);
  }

  return {
    instance,
    instances: list,
    setInstance,
    isLoading: instances === undefined,
  };
}

export type { Id };
