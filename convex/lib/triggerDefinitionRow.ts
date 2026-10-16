import { parseDataShape, parseFieldList } from "@woofx3/api/ui-schema";
import type { Id } from "../_generated/dataModel";

const DEFAULT_UI_COLOR = "#888888";
const DEFAULT_TRIGGER_ICON = "Zap";
const DEFAULT_TRIGGER_CATEGORY = "General";

/**
 * A trigger as the engine describes it, from either a `module.trigger.*`
 * webhook or a `getTriggers()` listing. Only `id` is guaranteed: a partial
 * payload still produces a renderable row.
 */
export interface EngineTriggerFields {
  id: string;
  category?: string;
  name?: string;
  description?: string;
  event?: string;
  configSchema?: string;
  emits?: string;
  sentence?: string;
  allowVariants?: boolean;
  projectionKey?: string;
  taxonomy?: string[];
  transport?: string;
}

/**
 * The `triggerDefinitions` row for an engine trigger.
 *
 * The registration webhook and the engine sync both write this row, and each
 * write replaces the other's, so they must build it the same way: a field one
 * of them leaves out is erased by the other's next patch.
 *
 * `color` and `icon` take the defaults: no engine field carries them.
 */
export function triggerDefinitionRow(t: EngineTriggerFields, moduleId: Id<"moduleRepository"> | undefined) {
  const configFields = parseFieldList(t.configSchema);
  const emits = parseDataShape(t.emits);
  return {
    slug: t.id,
    name: t.name ?? t.id,
    description: t.description ?? "",
    category: t.category ?? DEFAULT_TRIGGER_CATEGORY,
    event: t.event || undefined,
    color: DEFAULT_UI_COLOR,
    icon: DEFAULT_TRIGGER_ICON,
    configFields: configFields.length > 0 ? configFields : undefined,
    emits: emits ? emits.fields : undefined,
    sentence: t.sentence?.trim() || undefined,
    summary: emits?.summary,
    summaryDetails: emits?.details,
    allowVariants: t.allowVariants,
    projectionKey: t.projectionKey,
    taxonomy: t.taxonomy,
    transport: t.transport,
    moduleId,
  };
}
