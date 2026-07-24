import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useAction, useQuery } from "convex/react";
import { useCallback, useMemo, useState } from "react";

export interface InternalSettingActionRequest {
  event: string;
  payload?: Record<string, unknown>;
}

export function useInternalSettingAction(
  instanceId: Id<"instances"> | undefined,
  request: InternalSettingActionRequest | undefined,
  timeoutMs?: number
): {
  trigger: () => void;
  status: "idle" | "pending" | "success" | "error";
  message: string | null;
  data: unknown;
} {
  const dispatch = useAction(api.fieldOptions.dispatch);
  const [correlationKey, setCorrelationKey] = useState<string | null>(null);

  const trigger = useCallback(() => {
    if (!instanceId || !request) {
      return;
    }
    const key = crypto.randomUUID();
    setCorrelationKey(key);
    dispatch({ instanceId, descriptor: { kind: "internal", request, timeoutMs }, correlationKey: key }).catch(() => {
      /* errors surface via transientEvents */
    });
  }, [instanceId, request, timeoutMs, dispatch]);

  const event = useQuery(
    api.transientEvents.get,
    instanceId && correlationKey ? { instanceId, correlationKey } : "skip"
  );

  return useMemo(() => {
    if (!correlationKey) {
      return { trigger, status: "idle" as const, message: null, data: undefined };
    }
    if (event === undefined || event === null) {
      return { trigger, status: "pending" as const, message: null, data: undefined };
    }
    if (event.status === "error") {
      return { trigger, status: "error" as const, message: event.message ?? "Request failed", data: undefined };
    }
    return { trigger, status: "success" as const, message: event.message ?? null, data: event.data };
  }, [trigger, correlationKey, event]);
}
