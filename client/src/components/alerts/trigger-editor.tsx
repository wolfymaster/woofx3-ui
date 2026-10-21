import type { Id } from "@convex/_generated/dataModel";
import type { WorkflowDefinition } from "@woofx3/api";
import type { ConfigField } from "@woofx3/api/ui-schema";
import { ExternalLink } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { TriggerWhenCard } from "@/components/alerts/trigger-when-card";
import { FlowEditor } from "@/components/flow/flow-editor";
import type { LoadedFieldOptions } from "@/components/triggers/condition-sentence";
import { Button } from "@/components/ui/button";
import { toInstanceId } from "@/engine/convex/ids";
import { useResourceInstances } from "@/engine/hooks/use-module-resources";
import {
  useCreateWorkflowRequest,
  useDeleteWorkflowRequest,
  useSetWorkflowEnabledRequest,
  useUpdateWorkflowRequest,
} from "@/engine/hooks/use-workflows";
import { useToast } from "@/hooks/use-toast";
import { useEngineConditionSupport } from "@/hooks/use-viewer-facts";
import { useWorkflowCatalog } from "@/hooks/use-workflow-catalog";
import { type TriggerPin, triggerFieldValues, withFieldConditions } from "@/lib/alert-triggers";
import { type OptionLabels, sentenceParts, sentenceText } from "@/lib/condition-sentence";
import { escapeDollarKeys } from "@/lib/dollar-keys";
import type { TriggerPreset } from "@/lib/workflow-presets";
import { incompleteConditionFields } from "@/lib/workflow-presets-json";
import {
  countActionSteps,
  removeStepFromTree,
  type StepNode,
  treeToDefinition,
  type WorkflowTree,
} from "@/lib/workflow-tree";

/** The workflow a saved trigger is, as the editor saves it back. */
export interface SavedTrigger {
  engineWorkflowId: string;
  definition: WorkflowDefinition;
}

interface TriggerEditorProps {
  instanceId: Id<"instances">;
  triggerPreset: TriggerPreset;
  conditionFields: ConfigField[];
  /** The trigger's workflow, or undefined for a trigger not saved yet. */
  saved: SavedTrigger | undefined;
  /** The tree the editor starts from: the saved workflow's, or a new trigger's. */
  initialTree: WorkflowTree;
  /** A field the page holds to one value, shown in the sentence but not changed from it. */
  pin?: TriggerPin & { label: string };
  loadedOptions: ReadonlyMap<string, LoadedFieldOptions>;
  optionLabels: OptionLabels;
  /** A new trigger's workflow now exists in the engine. */
  onCreated: (engineWorkflowId: string) => void;
  onDeleted: () => void;
}

const LAST_STEP_REASON = "A trigger needs at least one step. Delete the trigger instead, or add another step first.";

function lastStepReason(steps: StepNode[], id: string): string | null {
  return countActionSteps(removeStepFromTree(steps, id)) > 0 ? null : LAST_STEP_REASON;
}

/**
 * One alert trigger opened for editing: the step editor (FlowEditor) with the trigger's
 * sentence as its "When" card, so its steps can wait, pause and branch like any workflow's.
 *
 * The trigger is a workflow of its own (lib/alert-triggers.ts), saved as it is edited: a
 * step when it closes, the sentence when a picker closes. A new trigger exists only here
 * until its first step is saved, because the engine refuses a workflow with no steps; it
 * is switched on as it is created, since a trigger just written is meant to fire.
 */
export function TriggerEditor({
  instanceId,
  triggerPreset,
  conditionFields,
  saved: savedProp,
  initialTree,
  pin,
  loadedOptions,
  optionLabels,
  onCreated,
  onDeleted,
}: TriggerEditorProps) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { catalogTriggers, catalogActions, actionPresets, loading: catalogLoading } = useWorkflowCatalog();
  const createFromDefinition = useCreateWorkflowRequest();
  const updateFromDefinition = useUpdateWorkflowRequest();
  const setEnabled = useSetWorkflowEnabledRequest();
  const removeWorkflow = useDeleteWorkflowRequest();
  const resourceInstances = useResourceInstances(toInstanceId(instanceId));
  const conditionSupport = useEngineConditionSupport(instanceId);
  const resourceLabels = useMemo(
    () =>
      resourceInstances ? new Map(resourceInstances.map((inst) => [inst.canonicalId, inst.displayName])) : undefined,
    [resourceInstances]
  );

  // A trigger created here is saved from then on, before the list's copy of it arrives.
  const [created, setCreated] = useState<SavedTrigger | undefined>(undefined);
  const saved = savedProp ?? created;
  const [tree, setTree] = useState(initialTree);
  const treeRef = useRef(tree);
  treeRef.current = tree;
  const savedTriggerRef = useRef(JSON.stringify(initialTree.trigger));
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const values = useMemo(
    () => triggerFieldValues(tree.trigger.conditions, conditionFields),
    [tree.trigger.conditions, conditionFields]
  );
  const labels = useMemo<OptionLabels>(() => {
    if (!pin) {
      return optionLabels;
    }
    return new Map(optionLabels).set(pin.fieldId, new Map([[pin.value, pin.label]]));
  }, [optionLabels, pin]);
  const parts = sentenceParts(triggerPreset.sentence, conditionFields, values, labels);
  const editableFields = pin ? conditionFields.filter((field) => field.id !== pin.fieldId) : conditionFields;

  const commit = useCallback(
    async (next: WorkflowTree): Promise<boolean> => {
      const missing = incompleteConditionFields(
        conditionFields,
        triggerFieldValues(next.trigger.conditions, conditionFields)
      );
      if (missing.length > 0) {
        toast({
          title: "The trigger isn't finished",
          description: `Choose ${missing.map((field) => field.label.toLowerCase()).join(", ")}, or pick Any.`,
          variant: "destructive",
        });
        return false;
      }
      if (countActionSteps(next.steps) === 0) {
        // Nothing to run yet, so nothing the engine would keep: the trigger waits here for a step.
        return true;
      }
      const definition = treeToDefinition(next);
      try {
        if (saved) {
          definition.id = saved.definition.id;
          definition.name = saved.definition.name;
          await updateFromDefinition(toInstanceId(instanceId), saved.engineWorkflowId, escapeDollarKeys(definition));
        } else {
          const { id: _unsaved, ...unsaved } = definition;
          const name = sentenceText(parts) || triggerPreset.name;
          const { engineWorkflowId } = await createFromDefinition(
            toInstanceId(instanceId),
            escapeDollarKeys({ ...unsaved, name })
          );
          setCreated({ engineWorkflowId, definition: { ...definition, id: engineWorkflowId, name } });
          try {
            await setEnabled(toInstanceId(instanceId), engineWorkflowId, true);
          } catch {
            toast({
              title: "Saved, but not switched on",
              description: "Switch the trigger on from its card.",
              variant: "destructive",
            });
          }
          onCreated(engineWorkflowId);
        }
        savedTriggerRef.current = JSON.stringify(next.trigger);
        return true;
      } catch (err) {
        toast({
          title: "Failed to save",
          description: err instanceof Error ? err.message : String(err),
          variant: "destructive",
        });
        return false;
      }
    },
    [
      conditionFields,
      saved,
      instanceId,
      parts,
      triggerPreset.name,
      toast,
      updateFromDefinition,
      createFromDefinition,
      setEnabled,
      onCreated,
    ]
  );

  const changeValue = (fieldId: string, value: unknown) => {
    const conditions = withFieldConditions(tree.trigger.conditions, conditionFields, {
      ...values,
      [fieldId]: value as never,
    });
    setTree({ ...tree, trigger: { ...tree.trigger, conditions } });
  };

  const settleSentence = () => {
    const current = treeRef.current;
    if (JSON.stringify(current.trigger) !== savedTriggerRef.current) {
      void commit(current);
    }
  };

  async function remove() {
    if (!saved) {
      onDeleted();
      return;
    }
    setIsDeleting(true);
    try {
      await removeWorkflow(toInstanceId(instanceId), saved.engineWorkflowId);
      onDeleted();
    } catch (err) {
      toast({
        title: "Couldn't delete the trigger",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setIsDeleting(false);
      setConfirmingDelete(false);
    }
  }

  return (
    <div className="flex flex-col gap-4" data-testid="trigger-editor">
      <FlowEditor
        tree={tree}
        onChange={setTree}
        onCommit={commit}
        catalogTriggers={catalogTriggers}
        catalogActions={catalogActions}
        catalogLoading={catalogLoading}
        actionPresets={actionPresets}
        resourceLabels={resourceLabels}
        conditionSupport={conditionSupport}
        removeBlockedReason={saved ? lastStepReason : undefined}
        when={
          <TriggerWhenCard
            parts={parts}
            editableFields={editableFields}
            values={values}
            loadedOptions={loadedOptions}
            onChangeValue={changeValue}
            onSettle={settleSentence}
            fallback={triggerPreset.name}
          />
        }
      />
      {!saved && countActionSteps(tree.steps) === 0 && (
        <p className="px-1 text-sm text-muted-foreground">Add a step to save this trigger.</p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
        <Button
          variant="ghost"
          className="h-11 text-[13px] text-muted-foreground sm:h-9"
          onClick={() => saved && navigate(`/stream/workflows/${saved.engineWorkflowId}`)}
          disabled={!saved}
          title={saved ? undefined : "Save a step first: the workflow doesn't exist yet"}
        >
          <ExternalLink className="mr-2 h-3.5 w-3.5" aria-hidden="true" />
          Open in workflow editor
        </Button>
        {confirmingDelete ? (
          <div className="flex items-center gap-2">
            <span className="text-[13px] text-muted-foreground">Delete this trigger?</span>
            <Button variant="ghost" className="h-11 sm:h-9" onClick={() => setConfirmingDelete(false)}>
              Keep it
            </Button>
            <Button
              variant="destructive"
              className="h-11 sm:h-9"
              onClick={() => void remove()}
              disabled={isDeleting}
              data-testid="confirm-delete-trigger"
            >
              Delete
            </Button>
          </div>
        ) : (
          <Button
            variant="ghost"
            className="h-11 text-[13px] text-red-600 hover:bg-destructive/10 hover:text-red-500 dark:text-red-300 dark:hover:text-red-200 sm:h-9"
            onClick={() => setConfirmingDelete(true)}
            data-testid="delete-trigger"
          >
            Delete trigger
          </Button>
        )}
      </div>
    </div>
  );
}
