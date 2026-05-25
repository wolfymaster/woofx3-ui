import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { InternalConfigFieldSource } from "@woofx3/api/ui-schema";
import { useAction, useQuery } from "convex/react";
import { useEffect, useMemo, useState } from "react";

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

export function useFieldOptions(
  instanceId: Id<"instances"> | undefined,
  source: InternalConfigFieldSource | undefined
): { options: FieldOption[]; loading: boolean; error: string | null; empty: boolean } {
  const dispatch = useAction(api.fieldOptions.dispatch);
  const [correlationKey, setCorrelationKey] = useState<string | null>(null);

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
  }, [instanceId, source, dispatch]);

  const event = useQuery(
    api.transientEvents.get,
    instanceId && correlationKey ? { instanceId, correlationKey } : "skip"
  );

  return useMemo(() => {
    if (!instanceId || !source) {
      return { options: [], loading: false, error: null, empty: true };
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
  }, [instanceId, source, event]);
}
