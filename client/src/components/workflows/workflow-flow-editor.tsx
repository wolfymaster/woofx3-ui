import { escapeDollarKeys, unescapeDollarKeys } from "@shared/dollar-keys";
import type { WorkflowDefinition } from "@woofx3/api";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlowEditor } from "@/components/flow/flow-editor";
import { ScrollArea } from "@/components/ui/scroll-area";
import { WorkflowNotEditable } from "@/components/workflows/workflow-not-editable";
import { useResourceInstances } from "@/engine/hooks/use-module-resources";
import { useScenes } from "@/engine/hooks/use-scenes";
import { useUpdateWorkflowRequest, useWorkflow } from "@/engine/hooks/use-workflows";
import { FLOW_REPLACED, useFlowSave } from "@/hooks/use-flow-save";
import { useToast } from "@/hooks/use-toast";
import { useEngineConditionSupport } from "@/hooks/use-viewer-facts";
import { useWorkflowCatalog } from "@/hooks/use-workflow-catalog";
import { STEPS_CHANGED_TOAST } from "@/lib/flow-save";
import {
  countActionSteps,
  definitionToTree,
  removeStepFromTree,
  type StepNode,
  treeToDefinition,
  type WorkflowTree,
} from "@/lib/workflow-tree";

interface WorkflowFlowEditorProps {
  engineWorkflowId: string;
  /** Every edit as a full definition, for the header's Save. */
  onDefinitionChange?: (definition: WorkflowDefinition) => void;
}

const LAST_ACTION_REASON = "A workflow needs at least one action. Add another action before removing this one.";

/** A workflow keeps at least one action, so the last one can't go, nor a condition holding every remaining one. */
function lastActionReason(steps: StepNode[], id: string): string | null {
  return countActionSteps(removeStepFromTree(steps, id)) > 0 ? null : LAST_ACTION_REASON;
}

/**
 * The workflow editor's steps as a flow (FlowEditor), read from and saved to the stored
 * definition. Saves go through the same action and key escaping as the header's Save.
 */
export function WorkflowFlowEditor({ engineWorkflowId, onDefinitionChange }: WorkflowFlowEditorProps) {
  const { catalogTriggers, catalogActions, actionPresets, loading: catalogLoading } = useWorkflowCatalog();
  const { toast } = useToast();
  const conditionSupport = useEngineConditionSupport();
  const updateFromDefinition = useUpdateWorkflowRequest();
  const workflow = useWorkflow(engineWorkflowId);
  const resourceInstances = useResourceInstances();
  const scenes = useScenes();
  const resourceLabels = useMemo(
    () =>
      resourceInstances ? new Map(resourceInstances.map((inst) => [inst.canonicalId, inst.displayName])) : undefined,
    [resourceInstances]
  );

  const [tree, setTree] = useState<WorkflowTree | null>(null);
  const [notEditableReason, setNotEditableReason] = useState<string | null>(null);
  const baseRevisionRef = useRef<number | undefined>(undefined);

  const toDefinition = useCallback(
    (next: WorkflowTree): WorkflowDefinition | null => {
      if (!workflow?.definition) {
        return null;
      }
      const stored = workflow.definition as WorkflowDefinition;
      const definition = treeToDefinition(next);
      definition.id = stored.id;
      definition.name = stored.name;
      return definition;
    },
    [workflow]
  );

  const handleChange = useCallback(
    (next: WorkflowTree) => {
      setTree(next);
      const definition = toDefinition(next);
      if (definition && onDefinitionChange) {
        onDefinitionChange(definition);
      }
    },
    [toDefinition, onDefinitionChange]
  );

  const markSavedRef = useRef<(tree: WorkflowTree) => void>(() => undefined);

  const handleCommit = useCallback(
    async (next: WorkflowTree): Promise<boolean | typeof FLOW_REPLACED> => {
      const definition = toDefinition(next);
      if (!definition) {
        return true;
      }
      try {
        const outcome = await updateFromDefinition(
          engineWorkflowId,
          escapeDollarKeys(definition) as WorkflowDefinition,
          baseRevisionRef.current
        );
        if (outcome.conflict) {
          const read = definitionToTree(unescapeDollarKeys(outcome.definition) as WorkflowDefinition);
          if (read.editable) {
            setTree(read.tree);
            markSavedRef.current(read.tree);
          }
          baseRevisionRef.current = outcome.revision;
          toast(STEPS_CHANGED_TOAST);
          return FLOW_REPLACED;
        }
        baseRevisionRef.current = outcome.revision;
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
    [toDefinition, updateFromDefinition, engineWorkflowId, toast]
  );

  const save = useFlowSave(tree, handleCommit);
  const { markSaved } = save;
  markSavedRef.current = markSaved;

  useEffect(() => {
    if (workflow?.definition) {
      const result = definitionToTree(unescapeDollarKeys(workflow.definition) as WorkflowDefinition);
      setTree(result.editable ? result.tree : null);
      baseRevisionRef.current = workflow.revision;
      if (result.editable) {
        markSaved(result.tree);
      }
      setNotEditableReason(result.editable ? null : result.message);
    }
  }, [workflow?.definition, workflow?.revision, markSaved]);

  return (
    <ScrollArea className="h-full">
      <div className="mx-auto max-w-3xl p-8">
        {workflow === undefined ? (
          <div className="text-sm text-muted-foreground">Loading workflow…</div>
        ) : !workflow ? (
          <div className="text-sm text-muted-foreground">Workflow not found.</div>
        ) : tree ? (
          <FlowEditor
            tree={tree}
            onChange={handleChange}
            onCommit={save.commit}
            save={save}
            catalogTriggers={catalogTriggers}
            catalogActions={catalogActions}
            catalogLoading={catalogLoading}
            actionPresets={actionPresets}
            resourceLabels={resourceLabels}
            scenes={scenes}
            removeBlockedReason={lastActionReason}
            conditionSupport={conditionSupport}
          />
        ) : notEditableReason ? (
          <WorkflowNotEditable reason={notEditableReason} />
        ) : null}
      </div>
    </ScrollArea>
  );
}
