import type { ConfigField } from "@woofx3/api/ui-schema";
import { ExternalLink } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { AdvancedDisclosure } from "@/components/alerts/advanced-disclosure";
import { TriggerSentence } from "@/components/alerts/trigger-sentence";
import { TriggerWhenCard } from "@/components/alerts/trigger-when-card";
import { InlineGroupPicker } from "@/components/alerts/trigger-workflow-groups";
import type { LoadedFieldOptions } from "@/components/triggers/condition-sentence";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useResourceInstances } from "@/engine/hooks/use-module-resources";
import {
  useCreateWorkflowRequest,
  useDeleteWorkflowRequest,
  useSetWorkflowEnabledRequest,
  useUpdateWorkflowRequest,
} from "@/engine/hooks/use-workflows";
import type { Workflow } from "@/engine/types";
import { FLOW_REPLACED, useFlowSave } from "@/hooks/use-flow-save";
import { useToast } from "@/hooks/use-toast";
import { useEngineConditionSupport } from "@/hooks/use-viewer-facts";
import { useWorkflowCatalog } from "@/hooks/use-workflow-catalog";
import { storedStepsGained, type TriggerPin, triggerFieldValues, withFieldConditions } from "@/lib/alert-triggers";
import { type OptionLabels, sentenceParts, sentenceText } from "@/lib/condition-sentence";
import { STEPS_CHANGED_TOAST } from "@/lib/flow-save";
import { commitTrigger, type SavedTrigger } from "@/lib/trigger-commit";
import type { TriggerPreset } from "@/lib/workflow-presets";
import { incompleteConditionFields } from "@/lib/workflow-presets-json";
import {
  countActionSteps,
  definitionToTree,
  removeStepFromTree,
  type StepNode,
  treeToDefinition,
  type WorkflowTree,
} from "@/lib/workflow-tree";

export type { SavedTrigger } from "@/lib/trigger-commit";

interface TriggerEditorProps {
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
  /** Every workflow on this trigger card, for the one bottom Group picker. */
  workflows?: readonly Workflow[];
  /** A new trigger's workflow now exists in the engine. */
  onCreated: (engineWorkflowId: string) => void;
  onDeleted: () => void;
  /** What else runs on this trigger, shown under the steps. Delete then says it takes only the steps. */
  alsoRuns?: ReactNode;
  /** Lets the surrounding card save pending edits before it closes, so closing never drops work. */
  registerClose?: (close: () => Promise<boolean>) => void;
}

const LAST_STEP_REASON = "A trigger needs at least one step. Delete the trigger instead, or add another step first.";

function lastStepReason(steps: StepNode[], id: string): string | null {
  return countActionSteps(removeStepFromTree(steps, id)) > 0 ? null : LAST_STEP_REASON;
}

/**
 * One alert trigger opened for editing. A sentence-first editor is the primary surface:
 * clicking a phrase expands only that phrase's settings, inline, against the same workflow
 * tree the full editor uses. Advanced holds the secondary settings and the one way out to
 * the full editor.
 *
 * The trigger is a workflow of its own (lib/alert-triggers.ts), saved as it is edited: a
 * step when it closes, the sentence when a picker closes. A new trigger exists only here
 * until its first step is saved, because the engine refuses a workflow with no steps; it
 * is switched on as it is created, since a trigger just written is meant to fire.
 */
export function TriggerEditor({
  triggerPreset,
  conditionFields,
  saved: savedProp,
  initialTree,
  pin,
  loadedOptions,
  optionLabels,
  workflows,
  onCreated,
  onDeleted,
  alsoRuns,
  registerClose,
}: TriggerEditorProps) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { catalogTriggers, catalogActions, actionPresets, loading: catalogLoading } = useWorkflowCatalog();
  const createFromDefinition = useCreateWorkflowRequest();
  const updateFromDefinition = useUpdateWorkflowRequest();
  const setEnabled = useSetWorkflowEnabledRequest();
  const removeWorkflow = useDeleteWorkflowRequest();
  const resourceInstances = useResourceInstances();
  const conditionSupport = useEngineConditionSupport();
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
  // The revision the steps on screen were read at. Not the latest stored one: an
  // edit of steps that have since changed has to be refused, not saved over them.
  const baseRevisionRef = useRef(saved?.revision);
  const replaceTreeRef = useRef<(read: WorkflowTree, revision: number | undefined) => void>(() => undefined);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  // The name in Advanced edits this workflow, never a copy made by a later save. A merge
  // changes the workflow id, so a new id clears a name that belonged to the old workflow.
  const [customName, setCustomName] = useState<string | null>(null);
  const customNameRef = useRef<string | null>(null);
  customNameRef.current = customName;
  const storedName = saved?.definition.name ?? triggerPreset.name;
  const [nameDraft, setNameDraft] = useState(storedName);
  useEffect(() => {
    setNameDraft(customName ?? storedName);
  }, [customName, storedName]);
  const previousWorkflowIdRef = useRef(saved?.engineWorkflowId);
  useEffect(() => {
    if (previousWorkflowIdRef.current !== saved?.engineWorkflowId) {
      previousWorkflowIdRef.current = saved?.engineWorkflowId;
      setCustomName(null);
    }
  }, [saved?.engineWorkflowId]);

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
    async (next: WorkflowTree): Promise<boolean | typeof FLOW_REPLACED> => {
      const outcome = await commitTrigger({
        tree: next,
        saved,
        conditionFields,
        customName: customNameRef.current ?? undefined,
        revision: baseRevisionRef.current,
        fallbackName: sentenceText(parts) || triggerPreset.name,
        deps: {
          incompleteConditionFields,
          treeToDefinition,
          create: createFromDefinition,
          update: updateFromDefinition,
          setEnabled,
        },
      });
      switch (outcome.kind) {
        case "incomplete":
          toast({
            title: "The trigger isn't finished",
            description: `Choose ${outcome.fields.join(", ")}, or pick Any.`,
            variant: "destructive",
          });
          return false;
        case "needs-step":
          return true;
        case "conflict":
          if (outcome.tree !== null) {
            replaceTreeRef.current(outcome.tree, outcome.revision);
          }
          toast(STEPS_CHANGED_TOAST);
          return FLOW_REPLACED;
        case "failed":
          toast({ title: "Failed to save", description: outcome.error, variant: "destructive" });
          return false;
        case "saved": {
          if (outcome.created) {
            setCreated(outcome.created);
            if (outcome.enableFailed) {
              toast({
                title: "Saved, but not switched on",
                description: "Switch the trigger on from its card.",
                variant: "destructive",
              });
            }
            onCreated(outcome.created.engineWorkflowId);
          } else {
            baseRevisionRef.current = outcome.revision;
          }
          savedTriggerRef.current = JSON.stringify(next.trigger);
          return true;
        }
      }
    },
    [
      conditionFields,
      saved,
      parts,
      triggerPreset.name,
      toast,
      updateFromDefinition,
      createFromDefinition,
      setEnabled,
      onCreated,
    ]
  );

  const save = useFlowSave(
    tree,
    commit,
    !saved && countActionSteps(tree.steps) === 0 ? "Not saved yet. Add a step to save this trigger." : null
  );

  const pendingCloseRef = useRef<() => Promise<boolean>>(async () => true);
  pendingCloseRef.current = async () => {
    if (!save.changed) {
      return true;
    }
    return save.commit(treeRef.current);
  };
  useEffect(() => {
    registerClose?.(() => pendingCloseRef.current());
    return () => registerClose?.(async () => true);
  }, [registerClose]);

  const { markSaved } = save;
  replaceTreeRef.current = (read, revision) => {
    setTree(read);
    markSaved(read);
    savedTriggerRef.current = JSON.stringify(read.trigger);
    baseRevisionRef.current = revision;
  };
  const storedRevisionRef = useRef(saved?.revision);
  storedRevisionRef.current = saved?.revision;
  const storedDefinition = saved?.definition;
  const previousStoredRef = useRef(storedDefinition);
  useEffect(() => {
    const previous = previousStoredRef.current;
    previousStoredRef.current = storedDefinition;
    if (!previous || !storedDefinition || previous === storedDefinition) {
      return;
    }
    const held = treeToDefinition(treeRef.current).tasks;
    if (!storedStepsGained(previous.tasks ?? [], storedDefinition.tasks ?? [], held)) {
      return;
    }
    const read = definitionToTree(storedDefinition);
    if (read.editable) {
      replaceTreeRef.current(read.tree, storedRevisionRef.current);
    }
  }, [storedDefinition]);

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
      void save.commit(current);
    }
  };

  const commitStepName = () => {
    const name = nameDraft.trim();
    if (name.length === 0) {
      toast({ title: "Give this trigger a name", variant: "destructive" });
      setNameDraft(customName ?? storedName);
      return;
    }
    if (name === (customName ?? storedName)) {
      return;
    }
    customNameRef.current = name;
    setCustomName(name);
    void save.commit(treeRef.current);
  };

  async function remove() {
    if (!saved) {
      onDeleted();
      return;
    }
    setIsDeleting(true);
    try {
      await removeWorkflow(saved.engineWorkflowId);
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
      <TriggerSentence
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
        tree={tree}
        onChange={setTree}
        onCommit={save.commit}
        save={save}
        catalogTriggers={catalogTriggers}
        catalogActions={catalogActions}
        catalogLoading={catalogLoading}
        actionPresets={actionPresets}
        resourceLabels={resourceLabels}
        conditionSupport={conditionSupport}
        removeBlockedReason={saved ? lastStepReason : undefined}
        onOpenAdvanced={() => setAdvancedOpen(true)}
      />
      {alsoRuns}
      <AdvancedDisclosure open={advancedOpen} onOpenChange={setAdvancedOpen}>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="trigger-step-name">Step name</Label>
          <Input
            id="trigger-step-name"
            value={nameDraft}
            onChange={(event) => setNameDraft(event.target.value)}
            onBlur={commitStepName}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.currentTarget.blur();
              }
            }}
            data-testid="trigger-step-name"
          />
          <div className="flex flex-col gap-0.5">
            <span className="text-xs text-muted-foreground">Step ID</span>
            <code className="w-fit text-[13px] text-muted-foreground" data-testid="trigger-step-id">
              {tree.trigger.id}
            </code>
          </div>
        </div>
        {workflows && workflows.length > 0 && <InlineGroupPicker workflows={workflows} />}
        <Button
          variant="outline"
          className="h-11 self-start sm:h-9"
          disabled={!saved}
          title={saved ? undefined : "Save a step first"}
          onClick={() => saved && navigate(`/stream/workflows/${saved.engineWorkflowId}`)}
          data-testid="open-full-editor"
        >
          <ExternalLink className="mr-2 h-3.5 w-3.5" aria-hidden="true" />
          Edit this trigger as a workflow →
        </Button>
      </AdvancedDisclosure>
      {confirmingDelete ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] text-muted-foreground">
            {alsoRuns ? "Delete your steps?" : "Delete this trigger?"}
          </span>
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
          className="h-11 self-start text-[13px] text-red-600 hover:bg-destructive/10 hover:text-red-500 dark:text-red-300 dark:hover:text-red-200 sm:h-9"
          onClick={() => setConfirmingDelete(true)}
          data-testid="delete-trigger"
        >
          {alsoRuns ? "Delete your steps" : "Delete trigger"}
        </Button>
      )}
    </div>
  );
}
