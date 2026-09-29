import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { FieldOptionsReference } from "@convex/lib/fieldOptions";
import { useAction, useQuery } from "convex/react";
import { useCallback, useMemo, useState } from "react";
import { dispatchErrorMessage } from "@/lib/field-options-request";

/**
 * Press a module settings button whose `action` is `internal`. The engine
 * sends the request the installed manifest declares for `reference`.
 */
export function useInternalSettingAction(
  instanceId: Id<"instances"> | undefined,
  reference: FieldOptionsReference | undefined
): {
  trigger: () => void;
  status: "idle" | "pending" | "success" | "error";
  message: string | null;
  data: unknown;
} {
  const dispatch = useAction(api.fieldOptions.dispatch);
  const [correlationKey, setCorrelationKey] = useState<string | null>(null);
  const [failure, setFailure] = useState<{ correlationKey: string; message: string } | null>(null);

  const trigger = useCallback(() => {
    if (!instanceId || !reference) {
      return;
    }
    const key = crypto.randomUUID();
    setCorrelationKey(key);
    dispatch({ instanceId, reference, correlationKey: key }).catch((error: unknown) => {
      setFailure({ correlationKey: key, message: dispatchErrorMessage(error) });
    });
  }, [instanceId, reference, dispatch]);

  const event = useQuery(
    api.transientEvents.get,
    instanceId && correlationKey ? { instanceId, correlationKey } : "skip"
  );

  return useMemo(() => {
    if (!correlationKey) {
      return { trigger, status: "idle" as const, message: null, data: undefined };
    }
    if (failure !== null && failure.correlationKey === correlationKey) {
      return { trigger, status: "error" as const, message: failure.message, data: undefined };
    }
    if (event === undefined || event === null) {
      return { trigger, status: "pending" as const, message: null, data: undefined };
    }
    if (event.status === "error") {
      return { trigger, status: "error" as const, message: event.message ?? "Request failed", data: undefined };
    }
    return { trigger, status: "success" as const, message: event.message ?? null, data: event.data };
  }, [trigger, correlationKey, failure, event]);
}
