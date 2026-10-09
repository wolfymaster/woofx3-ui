import { api } from "@convex/_generated/api";
import type { ActionStep } from "@woofx3/api";
import { useAction } from "convex/react";
import { useState } from "react";
import type { ResourceDetailProps } from "@/components/resources/resource-kind-page";
import { useInstance } from "@/hooks/use-instance";
import { useToast } from "@/hooks/use-toast";
import { useWorkflowCatalog } from "@/hooks/use-workflow-catalog";
import { escapeDollarKeys } from "@/lib/dollar-keys";
import { type ResourceAction, resourceActionStep, resourceActionStepFor } from "@/lib/resource-actions";
import type { ResourceInstanceDoc } from "@/lib/resource-instance";

/**
 * Runs one of a resource kind's own actions against the instance on show — the
 * same action a workflow or a chat command would run — so a resource page never
 * changes a value any other way. The value shown is the one the engine stored,
 * arriving back through its change event; `run` resolves once the request is
 * sent, not once the change has happened.
 *
 * `pending` is the action id in flight, so a page can disable its controls while
 * one is being sent. `run` reports a failure as a toast and resolves false.
 */
export function useResourceAction({ instance, moduleName }: Pick<ResourceDetailProps, "instance" | "moduleName">) {
  const runResourceAction = useResourceActionRunner();
  const sendStep = useResourceActionSender();
  const { toast } = useToast();
  const [pending, setPending] = useState<string | null>(null);

  async function attempt(key: string, send: () => Promise<boolean>): Promise<boolean> {
    setPending(key);
    try {
      return await send();
    } catch (err) {
      toast({
        title: "That didn't work",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
      return false;
    } finally {
      setPending(null);
    }
  }

  /** Runs the kind's module's action `actionId`, aimed at the instance through its `target` parameter. */
  function run(actionId: string, parameters: Record<string, unknown> = {}): Promise<boolean> {
    return attempt(actionId, () => runResourceAction(instance, moduleName, actionId, parameters));
  }

  /**
   * Runs any action aimed at the kind, from whichever module declares it, through
   * the parameter that action picks an instance with. `pending` holds its preset id.
   */
  function runAction(action: ResourceAction, parameters: Record<string, unknown> = {}): Promise<boolean> {
    return attempt(action.preset.id, () =>
      sendStep(instance, resourceActionStepFor(action, instance.canonicalId, parameters))
    );
  }

  return { run, runAction, pending };
}

/**
 * The request behind `useResourceAction`, for callers that act on many instances rather
 * than one — the quick actions palette. Resolves false when no engine instance is
 * selected, and throws what the engine or the catalog refused.
 */
export function useResourceActionRunner() {
  const { actionPresets } = useWorkflowCatalog();
  const sendStep = useResourceActionSender();

  return async function runResourceAction(
    instance: ResourceInstanceDoc,
    moduleName: string,
    actionId: string,
    parameters: Record<string, unknown> = {}
  ): Promise<boolean> {
    const action = resourceActionStep(actionPresets, moduleName, actionId, {
      target: instance.canonicalId,
      ...parameters,
    });
    return sendStep(instance, action);
  };
}

/**
 * Runs any action aimed at a kind against `instance`, through the parameter that action
 * picks an instance with: `useResourceAction`'s `runAction` for callers that act on many
 * instances, such as the quick actions palette. Throws what the engine refused.
 */
export function useAimedResourceActionRunner() {
  const sendStep = useResourceActionSender();

  return function runAimedAction(
    instance: ResourceInstanceDoc,
    action: ResourceAction,
    parameters: Record<string, unknown> = {}
  ): Promise<boolean> {
    return sendStep(instance, resourceActionStepFor(action, instance.canonicalId, parameters));
  };
}

/** Sends one action step about `instance` to the engine; false when no engine instance is selected. */
function useResourceActionSender() {
  const { instance: engineInstance } = useInstance();
  const runActions = useAction(api.moduleResourceActions.runActions);

  return async function sendStep(instance: ResourceInstanceDoc, step: ActionStep): Promise<boolean> {
    if (!engineInstance) {
      return false;
    }
    await runActions({
      instanceId: engineInstance._id,
      label: `dashboard:${instance.canonicalId}`,
      actions: escapeDollarKeys([step]) as unknown[],
    });
    return true;
  };
}
