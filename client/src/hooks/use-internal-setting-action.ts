import type { Id } from "@convex/_generated/dataModel";
import type { FieldOptionsReference } from "@convex/lib/fieldOptions";
import { useCallback, useMemo } from "react";
import { toInstanceId } from "@/engine/convex/ids";
import { useCorrelatedRequest } from "@/engine/hooks/use-correlated-request";
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
  const { correlationKey, start, event, failure } = useCorrelatedRequest(
    "fieldOptions",
    toInstanceId(instanceId ?? null)
  );

  const trigger = useCallback(() => {
    if (!instanceId || !reference) {
      return;
    }
    start(reference);
  }, [instanceId, reference, start]);

  return useMemo(() => {
    if (!correlationKey) {
      return { trigger, status: "idle" as const, message: null, data: undefined };
    }
    if (failure !== null) {
      return { trigger, status: "error" as const, message: dispatchErrorMessage(failure.error), data: undefined };
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
