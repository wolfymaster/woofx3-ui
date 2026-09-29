import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { FieldOptionsReference } from "@convex/lib/fieldOptions";
import type { InternalConfigFieldSource } from "@woofx3/api/ui-schema";
import { useAction, useQuery } from "convex/react";
import { useEffect, useMemo, useState } from "react";
import { fieldOptionsReferenceOf, MISSING_FIELD_OPTIONS_REFERENCE } from "@/lib/field-options-reference";
import { dispatchErrorMessage, fieldOptionsRequestKey } from "@/lib/field-options-request";

export type FieldOption = { value: string; label: string };

export function defaultTransform(data: unknown): FieldOption[] {
  if (!Array.isArray(data)) {
    return [];
  }
  const out: FieldOption[] = [];
  for (const item of data) {
    if (typeof item === "string") {
      out.push({ value: item, label: item });
      continue;
    }
    if (item && typeof item === "object") {
      const o = item as Record<string, unknown>;
      if (typeof o.value === "string" && typeof o.label === "string") {
        out.push({ value: o.value, label: o.label });
      }
    }
  }
  return out;
}

/** A dispatch that failed before reaching the worker, so no reply will arrive for its key. */
interface DispatchFailure {
  correlationKey: string;
  message: string;
}

export function useFieldOptions(
  instanceId: Id<"instances"> | undefined,
  source: InternalConfigFieldSource | undefined
): { options: FieldOption[]; loading: boolean; error: string | null; empty: boolean } {
  const dispatch = useAction(api.fieldOptions.dispatch);
  const [correlationKey, setCorrelationKey] = useState<string | null>(null);
  const [failure, setFailure] = useState<DispatchFailure | null>(null);
  const reference = fieldOptionsReferenceOf(source);
  const requestKey = reference ? fieldOptionsRequestKey(reference) : null;

  useEffect(() => {
    if (!instanceId || requestKey === null) {
      setCorrelationKey(null);
      return;
    }
    const requested = JSON.parse(requestKey) as FieldOptionsReference;
    const key = crypto.randomUUID();
    setCorrelationKey(key);
    dispatch({ instanceId, reference: requested, correlationKey: key }).catch((error: unknown) => {
      setFailure({ correlationKey: key, message: dispatchErrorMessage(error) });
    });
  }, [instanceId, requestKey, dispatch]);

  const event = useQuery(
    api.transientEvents.get,
    instanceId && correlationKey ? { instanceId, correlationKey } : "skip"
  );

  const hasSource = source !== undefined;
  return useMemo(() => {
    if (!instanceId || !hasSource) {
      return { options: [], loading: false, error: null, empty: true };
    }
    if (requestKey === null) {
      return { options: [], loading: false, error: MISSING_FIELD_OPTIONS_REFERENCE, empty: true };
    }
    if (failure !== null && failure.correlationKey === correlationKey) {
      return { options: [], loading: false, error: failure.message, empty: true };
    }
    if (event === undefined || event === null) {
      return { options: [], loading: true, error: null, empty: false };
    }
    if (event.status === "error") {
      return { options: [], loading: false, error: event.message ?? "Request failed", empty: true };
    }
    const options = defaultTransform(event.data);
    return {
      options,
      loading: false,
      error: null,
      empty: options.length === 0,
    };
  }, [instanceId, hasSource, requestKey, correlationKey, failure, event]);
}
