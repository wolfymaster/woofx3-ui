import type { CatalogActionRow, CatalogTriggerRow } from "@/hooks/use-workflow-catalog";
import type { ActionNode, TriggerNode } from "@/lib/workflow-tree";

/** Minimal shape needed to resolve a trigger's catalog row — satisfied by a full TriggerNode
 * or by a bare `WorkflowDefinition.trigger` (e.g. for the workflows list, which has no tree). */
type TriggerIdentity = Pick<TriggerNode, "event" | "ref">;

export function resolveCatalogTrigger(
  node: TriggerIdentity,
  catalog: CatalogTriggerRow[]
): CatalogTriggerRow | undefined {
  if (node.ref) {
    const byRef = catalog.find((c) => c.canonicalRef === node.ref);
    if (byRef) {
      return byRef;
    }
  }
  // Chat-command style triggers assemble the stored event as `${base}.${commandName}`
  // (see assembleEventType in workflow-presets-json.ts), so match on the base prefix too.
  return catalog.find((c) => !!c.event && (c.event === node.event || node.event.startsWith(`${c.event}.`)));
}

export function resolveCatalogAction(node: ActionNode, catalog: CatalogActionRow[]): CatalogActionRow | undefined {
  if (node.ref) {
    const byRef = catalog.find((c) => c.canonicalRef === node.ref);
    if (byRef) {
      return byRef;
    }
  }
  if (node.function) {
    const byFunction = catalog.find((c) => !!c.functionCall && c.functionCall === node.function);
    if (byFunction) {
      return byFunction;
    }
  }
  // Last resort: match on handler type, but only when it's unambiguous.
  const byHandlerType = catalog.filter((c) => !!c.handlerType && c.handlerType === node.action);
  return byHandlerType.length === 1 ? byHandlerType[0] : undefined;
}

/** Friendly display name for a trigger step, falling back to the raw event string. */
export function triggerNodeLabel(node: TriggerIdentity, catalog: CatalogTriggerRow[]): string {
  return resolveCatalogTrigger(node, catalog)?.name ?? node.event ?? "Trigger";
}

/** Friendly display name for an action step, falling back to the raw handler type. */
export function actionNodeLabel(node: ActionNode, catalog: CatalogActionRow[]): string {
  return resolveCatalogAction(node, catalog)?.name ?? node.action ?? "Action";
}
