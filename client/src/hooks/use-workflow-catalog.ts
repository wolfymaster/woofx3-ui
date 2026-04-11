import { useAction } from "convex/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@convex/_generated/api";
import { useInstance } from "@/hooks/use-instance";
import { resolveLucideIcon } from "@/lib/resolve-lucide-icon";
import type { ActionPreset, ConfigField, FieldType, TriggerConfig, TriggerPreset } from "@/lib/workflow-presets";

const FIELD_TYPES: FieldType[] = ["number", "range", "text", "select", "media", "toggle"];

function isFieldType(value: unknown): value is FieldType {
  return typeof value === "string" && (FIELD_TYPES as readonly string[]).includes(value);
}

function normalizeConfigFields(raw: unknown): ConfigField[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: ConfigField[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const o = item as Record<string, unknown>;
    const id = typeof o.id === "string" ? o.id : null;
    const label = typeof o.label === "string" ? o.label : null;
    const type = o.type;
    if (!id || !label || !isFieldType(type)) {
      continue;
    }
    const field: ConfigField = {
      id,
      label,
      type,
      required: o.required === true,
      placeholder: typeof o.placeholder === "string" ? o.placeholder : undefined,
      unit: typeof o.unit === "string" ? o.unit : undefined,
      min: typeof o.min === "number" ? o.min : undefined,
      max: typeof o.max === "number" ? o.max : undefined,
      defaultValue: o.defaultValue,
      mediaType:
        o.mediaType === "image" || o.mediaType === "audio" || o.mediaType === "video"
          ? o.mediaType
          : undefined,
    };
    if (Array.isArray(o.options)) {
      field.options = o.options
        .filter(
          (opt): opt is { value: string; label: string } =>
            !!opt &&
            typeof opt === "object" &&
            typeof (opt as { value?: unknown }).value === "string" &&
            typeof (opt as { label?: unknown }).label === "string",
        )
        .map((opt) => ({ value: opt.value, label: opt.label }));
    }
    out.push(field);
  }
  return out;
}

type CatalogTriggerRow = {
  id: string;
  name: string;
  description: string;
  category: string;
  color: string;
  icon: string;
  event?: string;
  allowVariants?: boolean;
  configFields?: unknown;
  supportsTiers?: boolean;
  tierLabel?: string;
};

type CatalogActionRow = {
  id: string;
  name: string;
  description: string;
  category: string;
  color: string;
  icon: string;
  configFields?: unknown;
};

function toTriggerPreset(row: CatalogTriggerRow): TriggerPreset {
  const icon = resolveLucideIcon(row.icon || "CircleHelp");
  const fields = normalizeConfigFields(row.configFields);
  let config: TriggerConfig | undefined;
  if (fields.length > 0 || row.supportsTiers) {
    config = {
      fields,
      supportsTiers: row.supportsTiers,
      tierLabel: typeof row.tierLabel === "string" ? row.tierLabel : undefined,
    };
  }
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    icon,
    category: row.category,
    color: row.color,
    config,
  };
}

function toActionPreset(row: CatalogActionRow): ActionPreset {
  const icon = resolveLucideIcon(row.icon || "CircleHelp");
  const fields = normalizeConfigFields(row.configFields);
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    icon,
    category: row.category,
    color: row.color,
    config: fields.length > 0 ? { fields } : undefined,
  };
}

export type WorkflowCatalogEngineMeta =
  | { status: "ok" }
  | { status: "error"; message?: string }
  | { status: "not_implemented" };

export function useWorkflowCatalog() {
  const { instance, isLoading: instanceLoading } = useInstance();
  const fetchMerged = useAction(api.workflowCatalog.fetchMerged);

  const [raw, setRaw] = useState<{
    triggers: CatalogTriggerRow[];
    actions: CatalogActionRow[];
    engine: WorkflowCatalogEngineMeta;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!instance) {
      setRaw(null);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await fetchMerged({ instanceId: instance._id });
      setRaw({
        triggers: (result.triggers ?? []) as CatalogTriggerRow[],
        actions: (result.actions ?? []) as CatalogActionRow[],
        engine: result.engine as WorkflowCatalogEngineMeta,
      });
    } catch (e) {
      setRaw(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [instance, fetchMerged]);

  useEffect(() => {
    if (!instance?._id) {
      setRaw(null);
      setError(null);
      setLoading(false);
      return;
    }
    void load();
  }, [instance?._id, load]);

  const triggerPresets = useMemo(
    () => (raw ? raw.triggers.map(toTriggerPreset) : []),
    [raw],
  );

  const actionPresets = useMemo(() => (raw ? raw.actions.map(toActionPreset) : []), [raw]);

  return {
    instance,
    instanceLoading,
    triggerPresets,
    actionPresets,
    catalogTriggers: raw?.triggers ?? [],
    catalogActions: raw?.actions ?? [],
    engine: raw?.engine ?? null,
    loading,
    error,
    refresh: load,
  };
}
