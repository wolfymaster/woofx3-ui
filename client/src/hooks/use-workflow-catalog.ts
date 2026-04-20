import { useQuery } from "convex/react";
import { useMemo } from "react";
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

export function useWorkflowCatalog() {
  const { instance, isLoading: instanceLoading } = useInstance();
  const raw = useQuery(
    api.workflowCatalog.get,
    instance ? { instanceId: instance._id } : "skip",
  );

  const triggers = (raw?.triggers ?? []) as CatalogTriggerRow[];
  const actions = (raw?.actions ?? []) as CatalogActionRow[];

  const triggerPresets = useMemo(() => triggers.map(toTriggerPreset), [triggers]);
  const actionPresets = useMemo(() => actions.map(toActionPreset), [actions]);

  return {
    instance,
    instanceLoading,
    triggerPresets,
    actionPresets,
    catalogTriggers: triggers,
    catalogActions: actions,
    loading: instanceLoading || (!!instance && raw === undefined),
  };
}
