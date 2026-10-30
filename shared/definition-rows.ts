import { parseDataShape, parseFieldList } from "@woofx3/api/ui-schema";

// No engine field carries a definition's color or icon, so every row takes
// these; the category is the engine's for a trigger that names one.
const DEFAULT_UI_COLOR = "#888888";
const DEFAULT_TRIGGER_ICON = "Zap";
const DEFAULT_TRIGGER_CATEGORY = "General";
const DEFAULT_ACTION_ICON = "ArrowRight";
const DEFAULT_ACTION_CATEGORY = "General";

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
 * The catalog row for an engine trigger, owned by `moduleId` (whatever id the
 * caller keeps modules by).
 *
 * The Convex registration webhook and engine sync both write this row, and
 * each write replaces the other's, so they must build it the same way: a field
 * one of them leaves out is erased by the other's next patch. The direct
 * gateway builds its catalog from the same rows.
 */
export function triggerDefinitionRow<ModuleRef>(t: EngineTriggerFields, moduleId: ModuleRef | undefined) {
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

/**
 * An action as the engine describes it, from either a `module.action.*`
 * webhook or an action listing. `type` is the handler kind and `call` the
 * function a `function` action calls.
 */
export interface EngineActionFields {
  id: string;
  name?: string;
  description?: string;
  call?: string;
  type?: string;
  paramsSchema?: string;
  returns?: string;
  projectionKey?: string;
  taxonomy?: string[];
  sentence?: string;
}

/**
 * The catalog row for an engine action; see `triggerDefinitionRow` for why
 * every writer builds it here. `returns` is a DataShape, not a field list: it
 * names values that exist at runtime rather than controls to render. An action
 * with a `call` and no `type` is a function action.
 */
export function actionDefinitionRow<ModuleRef>(a: EngineActionFields, moduleId: ModuleRef | undefined) {
  const configFields = parseFieldList(a.paramsSchema);
  const returns = parseDataShape(a.returns);
  const functionCall = a.call?.trim() || undefined;
  return {
    slug: a.id,
    name: a.name ?? a.id,
    description: a.description ?? "",
    category: DEFAULT_ACTION_CATEGORY,
    color: DEFAULT_UI_COLOR,
    icon: DEFAULT_ACTION_ICON,
    configFields: configFields.length > 0 ? configFields : undefined,
    returns: returns ? returns.fields : undefined,
    projectionKey: a.projectionKey,
    taxonomy: a.taxonomy,
    sentence: a.sentence?.trim() || undefined,
    handlerType: a.type?.trim() || (functionCall ? "function" : undefined),
    functionCall,
    moduleId,
  };
}
