import { api } from "@convex/_generated/api";
import { useQuery } from "convex/react";
import { useMemo } from "react";
import { useInstance } from "@/hooks/use-instance";
import { parseConfigFields } from "@/lib/parse-config-fields";
import { resolveLucideIcon } from "@/lib/resolve-lucide-icon";
import type { ActionPreset, TriggerConfig, TriggerPreset } from "@/lib/workflow-presets";

type CatalogTriggerRow = {
  id: string;
  canonicalRef?: string;
  name: string;
  description: string;
  category: string;
  color: string;
  icon: string;
  event?: string;
  allowVariants?: boolean;
  configFields?: unknown;
};

type CatalogActionRow = {
  id: string;
  canonicalRef?: string;
  handlerType?: string;
  functionCall?: string;
  name: string;
  description: string;
  category: string;
  color: string;
  icon: string;
  configFields?: unknown;
};

function toTriggerPreset(row: CatalogTriggerRow): TriggerPreset {
  const icon = resolveLucideIcon(row.icon || "CircleHelp");
  const fields = parseConfigFields(row.configFields);
  let config: TriggerConfig | undefined;
  if (fields.length > 0 || row.allowVariants) {
    config = {
      fields,
      allowVariants: row.allowVariants === true,
    };
  }
  return {
    id: row.id,
    canonicalRef: row.canonicalRef,
    name: row.name,
    description: row.description,
    icon,
    category: row.category,
    color: row.color,
    event: row.event,
    config,
  };
}

function toActionPreset(row: CatalogActionRow): ActionPreset {
  const icon = resolveLucideIcon(row.icon || "CircleHelp");
  const fields = parseConfigFields(row.configFields);
  const handlerType = row.handlerType?.trim() || (row.functionCall?.trim() ? "function" : undefined);
  return {
    id: row.id,
    canonicalRef: row.canonicalRef,
    handlerType,
    functionCall: row.functionCall?.trim() || undefined,
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
  const raw = useQuery(api.workflowCatalog.get, instance ? { instanceId: instance._id } : "skip");

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
