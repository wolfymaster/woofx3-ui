import type { FieldOptionsReference } from "@convex/lib/fieldOptions";
import type { InternalConfigFieldSource } from "@woofx3/api/ui-schema";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useCorrelatedRequest } from "@/engine/hooks/use-correlated-request";
import type { InstanceId } from "@/engine/types";
import { type FieldOption, parseFieldOptionsReply } from "@/lib/field-options";
import { fieldOptionsReferenceOf, MISSING_FIELD_OPTIONS_REFERENCE } from "@/lib/field-options-reference";
import { dispatchErrorMessage, fieldOptionsRequestKey } from "@/lib/field-options-request";

export interface FieldOptionsState {
  options: FieldOption[];
  loading: boolean;
  error: string | null;
  empty: boolean;
  /** Ask the worker again, e.g. after the streamer added a scene. */
  refresh: () => void;
}

export function useFieldOptions(
  instanceId: InstanceId | null,
  source: InternalConfigFieldSource | undefined
): FieldOptionsState {
  // A failure is a dispatch that never reached the worker, so no reply will arrive for it.
  const { start, clear, event, failure } = useCorrelatedRequest("fieldOptions", instanceId);
  const [requestCount, setRequestCount] = useState(0);
  const refresh = useCallback(() => setRequestCount((count) => count + 1), []);
  const reference = fieldOptionsReferenceOf(source);
  const requestKey = reference ? fieldOptionsRequestKey(reference) : null;

  // biome-ignore lint/correctness/useExhaustiveDependencies: requestCount is the refresh signal, not read here
  useEffect(() => {
    if (!instanceId || requestKey === null) {
      clear();
      return;
    }
    start(JSON.parse(requestKey) as FieldOptionsReference);
  }, [instanceId, requestKey, start, clear, requestCount]);

  const hasSource = source !== undefined;
  return useMemo(() => {
    if (!instanceId || !hasSource) {
      return { options: [], loading: false, error: null, empty: true, refresh };
    }
    if (requestKey === null) {
      return { options: [], loading: false, error: MISSING_FIELD_OPTIONS_REFERENCE, empty: true, refresh };
    }
    if (failure !== null) {
      return { options: [], loading: false, error: dispatchErrorMessage(failure.error), empty: true, refresh };
    }
    if (event === undefined || event === null) {
      return { options: [], loading: true, error: null, empty: false, refresh };
    }
    if (event.status === "error") {
      return { options: [], loading: false, error: event.message ?? "Request failed", empty: true, refresh };
    }
    const { options, error } = parseFieldOptionsReply(event.data);
    return { options, loading: false, error, empty: options.length === 0, refresh };
  }, [instanceId, hasSource, requestKey, failure, event, refresh]);
}
