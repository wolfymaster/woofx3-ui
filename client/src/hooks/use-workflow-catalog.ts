import { api } from "@convex/_generated/api";
import { useQuery } from "convex/react";
import { useMemo } from "react";
import { useInstance } from "@/hooks/use-instance";
import { parseConfigFields, parseDataShapeFields, withModuleName } from "@/lib/parse-config-fields";
import { resolveLucideIcon } from "@/lib/resolve-lucide-icon";
import type { ActionPreset, TriggerConfig, TriggerPreset } from "@/lib/workflow-presets";

export type CatalogTriggerRow = {
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
  /** DataShapeField[] naming what `trigger.data` carries when this trigger fires. */
  emits?: unknown;
  /** Engine classification, e.g. ["platform.twitch"] — groups entries by source. */
  taxonomy?: string[];
  moduleId?: string;
  moduleName?: string;
};

export type CatalogActionRow = {
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
  /** DataShapeField[] naming what this action's function hands back (e.g. {next, previous}). */
  returns?: unknown;
  /** See CatalogTriggerRow.taxonomy. */
  taxonomy?: string[];
  moduleId?: string;
  moduleName?: string;
};

function toTriggerPreset(row: CatalogTriggerRow): TriggerPreset {
  const icon = resolveLucideIcon(row.icon || "CircleHelp");
  const fields = withModuleName(parseConfigFields(row.configFields), row.moduleName);
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
    taxonomy: row.taxonomy,
    config,
  };
}

function toActionPreset(row: CatalogActionRow): ActionPreset {
  const icon = resolveLucideIcon(row.icon || "CircleHelp");
  const fields = withModuleName(parseConfigFields(row.configFields), row.moduleName);
  const outputs = parseDataShapeFields(row.returns);
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
    config:
      fields.length > 0 || outputs.length > 0
        ? { fields, outputs: outputs.length > 0 ? outputs : undefined }
        : undefined,
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
