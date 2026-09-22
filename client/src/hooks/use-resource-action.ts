import { api } from "@convex/_generated/api";
import { useAction } from "convex/react";
import { useState } from "react";
import type { ResourceDetailProps } from "@/components/resources/resource-kind-page";
import { useInstance } from "@/hooks/use-instance";
import { useToast } from "@/hooks/use-toast";
import { useWorkflowCatalog } from "@/hooks/use-workflow-catalog";
import { escapeDollarKeys } from "@/lib/dollar-keys";
import { resourceActionStep } from "@/lib/resource-actions";

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
  const { instance: engineInstance } = useInstance();
  const { actionPresets } = useWorkflowCatalog();
  const runActions = useAction(api.moduleResourceActions.runActions);
  const { toast } = useToast();
  const [pending, setPending] = useState<string | null>(null);

  async function run(actionId: string, parameters: Record<string, unknown> = {}): Promise<boolean> {
    if (!engineInstance) {
      return false;
    }
    setPending(actionId);
    try {
      const action = resourceActionStep(actionPresets, moduleName, actionId, {
        target: instance.canonicalId,
        ...parameters,
      });
      await runActions({
        instanceId: engineInstance._id,
        label: `dashboard:${instance.canonicalId}`,
        actions: escapeDollarKeys([action]) as unknown[],
      });
      return true;
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

  return { run, pending };
}
