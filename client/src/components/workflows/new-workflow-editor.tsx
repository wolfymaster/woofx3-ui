import type { Id } from "@convex/_generated/dataModel";
import type { WorkflowDefinition } from "@woofx3/api";
import { Loader2 } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { EventCatalog } from "@/components/flow/event-catalog";
import { FlowEditor } from "@/components/flow/flow-editor";
import { Button } from "@/components/ui/button";
import { useResourceInstances } from "@/engine/hooks/use-module-resources";
import { useScenes } from "@/engine/hooks/use-scenes";
import { useCreateWorkflowRequest } from "@/engine/hooks/use-workflows";
import { useToast } from "@/hooks/use-toast";
import { useEngineConditionSupport } from "@/hooks/use-viewer-facts";
import { useWorkflowCatalog } from "@/hooks/use-workflow-catalog";
import { newTriggerTree } from "@/lib/alert-triggers";
import { escapeDollarKeys } from "@/lib/dollar-keys";
import { conditionFieldsOf } from "@/lib/event-workflow-state";
import { type WaitEventChoice, waitEventGroups } from "@/lib/wait-event";
import type { TriggerPreset } from "@/lib/workflow-presets";
import { countActionSteps, treeToDefinition, type WorkflowTree } from "@/lib/workflow-tree";

/** Nothing is saved until the workflow is created, so closing a step has nothing to commit. */
const keepUnsaved = async () => true;

/**
 * A workflow not yet saved: first what starts it, picked from the same event list a wait
 * uses, then its steps in the flow editor every other surface edits with. It is created
 * once it has an action, named after its trigger, and opens in the workflow editor.
 */
export function NewWorkflowEditor({ instanceId }: { instanceId: Id<"instances"> }) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { catalogTriggers, catalogActions, triggerPresets, actionPresets, loading } = useWorkflowCatalog();
  const conditionSupport = useEngineConditionSupport(instanceId);
  const createFromDefinition = useCreateWorkflowRequest();
  const resourceInstances = useResourceInstances(instanceId);
  const scenes = useScenes(instanceId);
  const resourceLabels = useMemo(
    () =>
      resourceInstances ? new Map(resourceInstances.map((inst) => [inst.canonicalId, inst.displayName])) : undefined,
    [resourceInstances]
  );
  const groups = useMemo(() => waitEventGroups(catalogTriggers), [catalogTriggers]);

  const [triggerPreset, setTriggerPreset] = useState<TriggerPreset | null>(null);
  const [tree, setTree] = useState<WorkflowTree | null>(null);
  const [creating, setCreating] = useState(false);

  const pickTrigger = useCallback(
    (choice: WaitEventChoice) => {
      const preset = triggerPresets.find((candidate) => candidate.id === choice.row.id);
      if (!preset) {
        return;
      }
      setTriggerPreset(preset);
      setTree(newTriggerTree({ triggerPreset: preset, conditionFields: conditionFieldsOf(preset) }));
    },
    [triggerPresets]
  );

  const create = async () => {
    if (!tree || !triggerPreset) {
      return;
    }
    setCreating(true);
    try {
      const { id: _unsaved, ...definition } = treeToDefinition(tree);
      const { engineWorkflowId } = await createFromDefinition(
        instanceId,
        escapeDollarKeys({ ...definition, name: triggerPreset.name }) as Omit<WorkflowDefinition, "id">
      );
      toast({ title: "Workflow created" });
      navigate(`/stream/workflows/${engineWorkflowId}`);
    } catch (err) {
      toast({
        title: "Failed to create workflow",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
      setCreating(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!tree || !triggerPreset) {
    return (
      <div className="flex max-w-3xl flex-col gap-3">
        <h2 className="text-base font-semibold">What starts this workflow?</h2>
        <EventCatalog
          groups={groups}
          onPick={pickTrigger}
          onClose={() => navigate("/stream/workflows")}
          legend="Events that can start a workflow"
          testId="new-workflow-event"
        />
      </div>
    );
  }

  const hasAction = countActionSteps(tree.steps) > 0;

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm text-muted-foreground">
          Starts when <span className="font-medium text-foreground">{triggerPreset.name}</span> happens.
        </p>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setTriggerPreset(null);
            setTree(null);
          }}
          data-testid="button-new-workflow-change-trigger"
        >
          Pick a different trigger
        </Button>
      </div>
      <FlowEditor
        tree={tree}
        onChange={setTree}
        onCommit={keepUnsaved}
        catalogTriggers={catalogTriggers}
        catalogActions={catalogActions}
        catalogLoading={loading}
        actionPresets={actionPresets}
        resourceLabels={resourceLabels}
        scenes={scenes}
        conditionSupport={conditionSupport}
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => void create()} disabled={!hasAction || creating} data-testid="button-create-workflow">
          {creating && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
          Create workflow
        </Button>
        {!hasAction && <p className="text-sm text-muted-foreground">Add an action to create the workflow.</p>}
      </div>
    </div>
  );
}
