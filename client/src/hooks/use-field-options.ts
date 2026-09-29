import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { InternalConfigFieldSource } from "@woofx3/api/ui-schema";
import { useAction, useQuery } from "convex/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { type FieldOption, parseFieldOptionsReply } from "@/lib/field-options";

export interface FieldOptionsState {
  options: FieldOption[];
  loading: boolean;
  error: string | null;
  empty: boolean;
  /** Ask the worker again, e.g. after the streamer added a scene. */
  refresh: () => void;
}

export function useFieldOptions(
  instanceId: Id<"instances"> | undefined,
  source: InternalConfigFieldSource | undefined
): FieldOptionsState {
  const dispatch = useAction(api.fieldOptions.dispatch);
  const [correlationKey, setCorrelationKey] = useState<string | null>(null);
  const [requestCount, setRequestCount] = useState(0);
  const refresh = useCallback(() => setRequestCount((count) => count + 1), []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: requestCount is the refresh signal, not read here
  useEffect(() => {
    if (!instanceId || !source) {
      setCorrelationKey(null);
      return;
    }
    const key = crypto.randomUUID();
    setCorrelationKey(key);
    dispatch({ instanceId, descriptor: source, correlationKey: key }).catch(() => {
      /* errors surface via transientEvents */
    });
  }, [instanceId, source, dispatch, requestCount]);

  const event = useQuery(
    api.transientEvents.get,
    instanceId && correlationKey ? { instanceId, correlationKey } : "skip"
  );

  return useMemo(() => {
    if (!instanceId || !source) {
      return { options: [], loading: false, error: null, empty: true, refresh };
    }
    if (event === undefined || event === null) {
      return { options: [], loading: true, error: null, empty: false, refresh };
    }
    if (event.status === "error") {
      return { options: [], loading: false, error: event.message ?? "Request failed", empty: true, refresh };
    }
    const { options, error } = parseFieldOptionsReply(event.data);
    return { options, loading: false, error, empty: options.length === 0, refresh };
  }, [instanceId, source, event, refresh]);
}
