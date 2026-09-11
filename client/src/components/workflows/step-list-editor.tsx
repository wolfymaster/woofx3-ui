import { api } from "@convex/_generated/api";
import { useStore } from "@nanostores/react";
import type { ConditionConfig, WaitConfig, WorkflowDefinition } from "@woofx3/api";
import { useAction, useQuery } from "convex/react";
import { Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "wouter";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import { type CatalogActionRow, type CatalogTriggerRow, useWorkflowCatalog } from "@/hooks/use-workflow-catalog";
import { escapeDollarKeys, unescapeDollarKeys } from "@/lib/dollar-keys";
import { $currentInstanceId } from "@/lib/stores";
import { actionNodeLabel, triggerNodeLabel } from "@/lib/workflow-node-label";
import type { ActionPreset } from "@/lib/workflow-presets";
import { presetToActionNode } from "@/lib/workflow-presets-json";
import {
  type BranchPath,
  countActionSteps,
  definitionToTree,
  findStepInTree,
  insertStepInTree,
  removeStepFromTree,
  type StepNode,
  treeToDefinition,
  updateStepInTree,
  type WorkflowTree,
} from "@/lib/workflow-tree";
import {
  collectStepIds,
  computeAvailableVariables,
  generateStepId,
  isStepIdReferenced,
  isValidStepId,
} from "@/lib/workflow-variables";
import { ActionPickerDialog } from "./action-picker-dialog";
import { StepConfigPanel } from "./step-config-panel";
import { StepNodeCard } from "./step-node";

interface InsertButtonProps {
  onInsert: (type: "action" | "condition" | "wait") => void;
  label?: string;
}

function InsertButton({ onInsert, label }: InsertButtonProps) {
  return (
    <div className="flex items-center justify-center py-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="h-6 text-xs text-muted-foreground hover:text-foreground">
            <Plus className="h-3 w-3 mr-1" />
            {label || "Add step"}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="center">
          <DropdownMenuItem onClick={() => onInsert("action")}>Action</DropdownMenuItem>
          <DropdownMenuItem onClick={() => onInsert("condition")}>Condition</DropdownMenuItem>
          <DropdownMenuItem onClick={() => onInsert("wait")}>Wait</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

interface StepListProps {
  steps: StepNode[];
  /** Where this list lives in the tree — null for the root step list. */
  path: BranchPath;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onInsertAtPath: (path: BranchPath, index: number, type: "action" | "condition" | "wait") => void;
  depth?: number;
  catalogTriggers: CatalogTriggerRow[];
  catalogActions: CatalogActionRow[];
  resourceLabels?: Map<string, string>;
}

function StepList({
  steps,
  path,
  selectedId,
  onSelect,
  onInsertAtPath,
  depth = 0,
  catalogTriggers,
  catalogActions,
  resourceLabels,
}: StepListProps) {
  return (
    <div className="space-y-0">
      {steps.map((step, index) => (
        <div key={step.id}>
          <StepNodeCard
            node={step}
            isSelected={selectedId === step.id}
            onSelect={() => onSelect(step.id)}
            depth={depth}
            catalogTriggers={catalogTriggers}
            catalogActions={catalogActions}
            resourceLabels={resourceLabels}
          />
          {step.type === "condition" && (
            <div className="mt-2 mb-2">
              <div className="flex items-center gap-2 ml-6">
                <div className="h-px w-4 bg-border" />
                <span className="text-xs text-muted-foreground font-medium">THEN</span>
              </div>
              <div className="mt-1 border-l-2 border-green-500/30 pl-4">
                {step.thenBranch.length > 0 ? (
                  <StepList
                    steps={step.thenBranch}
                    path={{ parentId: step.id, branch: "thenBranch" }}
                    selectedId={selectedId}
                    onSelect={onSelect}
                    onInsertAtPath={onInsertAtPath}
                    depth={depth + 1}
                    catalogTriggers={catalogTriggers}
                    catalogActions={catalogActions}
                    resourceLabels={resourceLabels}
                  />
                ) : (
                  <div className="py-2">
                    <InsertButton
                      onInsert={(type) => onInsertAtPath({ parentId: step.id, branch: "thenBranch" }, 0, type)}
                      label="Add to then"
                    />
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2 ml-6 mt-2">
                <div className="h-px w-4 bg-border" />
                <span className="text-xs text-muted-foreground font-medium">ELSE</span>
              </div>
              <div className="mt-1 border-l-2 border-red-500/30 pl-4">
                {step.elseBranch.length > 0 ? (
                  <StepList
                    steps={step.elseBranch}
                    path={{ parentId: step.id, branch: "elseBranch" }}
                    selectedId={selectedId}
                    onSelect={onSelect}
                    onInsertAtPath={onInsertAtPath}
                    depth={depth + 1}
                    catalogTriggers={catalogTriggers}
                    catalogActions={catalogActions}
                    resourceLabels={resourceLabels}
                  />
                ) : (
                  <div className="py-2">
                    <InsertButton
                      onInsert={(type) => onInsertAtPath({ parentId: step.id, branch: "elseBranch" }, 0, type)}
                      label="Add to else"
                    />
                  </div>
                )}
              </div>
            </div>
          )}
          <InsertButton onInsert={(type) => onInsertAtPath(path, index + 1, type)} />
        </div>
      ))}
    </div>
  );
}

interface StepListEditorProps {
  onDefinitionChange?: (definition: WorkflowDefinition) => void;
}

export default function StepListEditor({ onDefinitionChange }: StepListEditorProps) {
  const params = useParams<{ id: string }>();
  const engineWorkflowId = params?.id;
  const instanceId = useStore($currentInstanceId);
  const { catalogTriggers, catalogActions, actionPresets, loading: catalogLoading } = useWorkflowCatalog();
  const { toast } = useToast();
  const updateFromDefinition = useAction(api.workflowActions.updateFromDefinition);

  const workflow = useQuery(
    api.workflows.getByEngineId,
    instanceId && engineWorkflowId ? { instanceId: instanceId as never, engineWorkflowId } : "skip"
  );

  // Backs the step-list summary line for resource_ref fields (e.g. Increment
  // Counter's "Counter" picker) — resolves the stored canonical id to the
  // module resource instance's friendly display name.
  const resourceInstances = useQuery(
    api.moduleResourceInstances.listForInstance,
    instanceId ? { instanceId: instanceId as never } : "skip"
  );
  const resourceLabels = useMemo(() => {
    if (!resourceInstances) {
      return undefined;
    }
    return new Map(resourceInstances.map((inst) => [inst.canonicalId, inst.displayName]));
  }, [resourceInstances]);

  const [tree, setTree] = useState<WorkflowTree | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [pendingActionInsert, setPendingActionInsert] = useState<{ path: BranchPath; index: number } | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  /** Snapshot of the tree taken when a panel opens for an already-existing node, so
   * handlePanelExit can tell whether anything actually changed by the time the user leaves.
   * `null` means "always save" — used for freshly-inserted steps, which have no prior saved
   * state to compare against and must be persisted regardless of further edits. */
  const panelBaselineRef = useRef<string | null>(null);

  const selectNode = useCallback(
    (id: string) => {
      panelBaselineRef.current = tree ? JSON.stringify(tree) : null;
      setSelectedNodeId(id);
    },
    [tree]
  );

  useEffect(() => {
    if (workflow?.definition) {
      setTree(definitionToTree(unescapeDollarKeys(workflow.definition) as WorkflowDefinition));
    }
  }, [workflow?.definition]);

  const buildFullDefinition = useCallback(
    (newTree: WorkflowTree): WorkflowDefinition | null => {
      if (!workflow?.definition) {
        return null;
      }
      const def = treeToDefinition(newTree);
      def.id = (workflow.definition as WorkflowDefinition).id;
      def.name = (workflow.definition as WorkflowDefinition).name;
      return def;
    },
    [workflow]
  );

  const applyTreeUpdate = useCallback(
    (newTree: WorkflowTree) => {
      setTree(newTree);
      const def = buildFullDefinition(newTree);
      if (onDefinitionChange && def) {
        onDefinitionChange(def);
      }
    },
    [buildFullDefinition, onDefinitionChange]
  );

  /**
   * Persists `definition` to the engine. Field-level edits (typing in the config panel) no
   * longer auto-save on a debounce — every change only touches local tree state (see
   * applyTreeUpdate) until the user explicitly saves or leaves the panel (handlePanelExit).
   * This is the one place that talks to the network, so both paths funnel through it.
   * Only surfaces anything to the user on failure — success is silent, the panel closing
   * (or the Save button reverting from "Saving…") is feedback enough.
   */
  const saveDefinition = useCallback(
    async (definition: WorkflowDefinition): Promise<boolean> => {
      if (!instanceId || !engineWorkflowId) {
        return true;
      }
      setIsSaving(true);
      try {
        await updateFromDefinition({
          instanceId: instanceId as never,
          engineWorkflowId,
          definition: escapeDollarKeys(definition) as WorkflowDefinition,
        });
        return true;
      } catch (err) {
        toast({
          title: "Failed to save",
          description: err instanceof Error ? err.message : String(err),
          variant: "destructive",
        });
        return false;
      } finally {
        setIsSaving(false);
      }
    },
    [instanceId, engineWorkflowId, updateFromDefinition, toast]
  );

  const saveTree = useCallback(
    (treeToSave: WorkflowTree): Promise<boolean> => {
      const definition = buildFullDefinition(treeToSave);
      return definition ? saveDefinition(definition) : Promise.resolve(true);
    },
    [buildFullDefinition, saveDefinition]
  );

  /** Inserts `newStep` at the given tree position and selects it so its config panel opens
   * immediately — local-only, like every other edit; it's persisted whenever the panel is saved
   * or closed (handlePanelExit), same as the rest of that step's configuration. There's no prior
   * saved state for a brand-new step to fall back to, so it's always considered dirty — even if
   * the user closes the panel without touching anything, the new step itself is the change. */
  const insertStepAndSelect = useCallback(
    (path: BranchPath, index: number, newStep: StepNode) => {
      if (!tree) {
        return;
      }
      const newSteps = insertStepInTree(tree.steps, path, index, newStep);
      applyTreeUpdate({ ...tree, steps: newSteps });
      panelBaselineRef.current = null;
      setSelectedNodeId(newStep.id);
    },
    [tree, applyTreeUpdate]
  );

  /** Condition/wait steps have no catalog to pick from, so they're inserted immediately. Action steps
   * need the user to choose which action first — remember where to insert and open the picker. */
  const handleInsertRequest = useCallback(
    (path: BranchPath, index: number, type: "action" | "condition" | "wait") => {
      if (type === "action") {
        setPendingActionInsert({ path, index });
        return;
      }
      const newStep: StepNode =
        type === "condition"
          ? { type: "condition", id: `step-${Date.now()}`, conditions: [], thenBranch: [], elseBranch: [] }
          : { type: "wait", id: `step-${Date.now()}`, wait: { type: "event", event: "" } };
      insertStepAndSelect(path, index, newStep);
    },
    [insertStepAndSelect]
  );

  const handleActionPicked = useCallback(
    (preset: ActionPreset) => {
      if (!pendingActionInsert || !tree) {
        return;
      }
      const id = generateStepId(preset.name, collectStepIds(tree.steps));
      const newStep = presetToActionNode(preset, id);
      insertStepAndSelect(pendingActionInsert.path, pendingActionInsert.index, newStep);
      setPendingActionInsert(null);
    },
    [pendingActionInsert, tree, insertStepAndSelect]
  );

  const handleUpdateTriggerConditions = useCallback(
    (conditions: ConditionConfig[]) => {
      if (!tree) {
        return;
      }
      applyTreeUpdate({ ...tree, trigger: { ...tree.trigger, conditions } });
    },
    [tree, applyTreeUpdate]
  );

  const handleUpdateActionParameters = useCallback(
    (id: string, parameters: Record<string, unknown>) => {
      if (!tree) {
        return;
      }
      const newSteps = updateStepInTree(tree.steps, id, (step) =>
        step.type === "action" ? { ...step, parameters } : step
      );
      applyTreeUpdate({ ...tree, steps: newSteps });
    },
    [tree, applyTreeUpdate]
  );

  /** Renaming doesn't rewrite ${oldId....} references elsewhere in the tree — this only touches
   * onTrue/onFalse/dependsOn, which are recomputed fresh from tree structure at save time, so
   * those stay correct. A stale ${} reference in another step's own field value gets a toast warning. */
  const handleUpdateActionId = useCallback(
    (oldId: string, rawNewId: string) => {
      if (!tree) {
        return;
      }
      const newId = rawNewId.trim();
      if (newId === oldId) {
        return;
      }
      if (!newId || !isValidStepId(newId)) {
        toast({
          title: "Invalid step ID",
          description: "Use only letters, numbers, dots, underscores, and hyphens.",
          variant: "destructive",
        });
        return;
      }
      const existingIds = collectStepIds(tree.steps);
      existingIds.delete(oldId);
      if (existingIds.has(newId)) {
        toast({
          title: "Step ID already in use",
          description: `"${newId}" is already used by another step in this workflow.`,
          variant: "destructive",
        });
        return;
      }
      const referencedElsewhere = isStepIdReferenced(tree.steps, oldId);
      const newSteps = updateStepInTree(tree.steps, oldId, (step) => ({ ...step, id: newId }));
      applyTreeUpdate({ ...tree, steps: newSteps });
      setSelectedNodeId(newId);
      if (referencedElsewhere) {
        toast({
          title: "Step ID renamed",
          description: `Other steps referencing \${${oldId}....} weren't updated — edit them to use \${${newId}....}.`,
        });
      }
    },
    [tree, applyTreeUpdate, toast]
  );

  const handleUpdateConditionConditions = useCallback(
    (id: string, conditions: ConditionConfig[]) => {
      if (!tree) {
        return;
      }
      const newSteps = updateStepInTree(tree.steps, id, (step) =>
        step.type === "condition" ? { ...step, conditions } : step
      );
      applyTreeUpdate({ ...tree, steps: newSteps });
    },
    [tree, applyTreeUpdate]
  );

  const handleUpdateWaitConfig = useCallback(
    (id: string, wait: WaitConfig) => {
      if (!tree) {
        return;
      }
      const newSteps = updateStepInTree(tree.steps, id, (step) => (step.type === "wait" ? { ...step, wait } : step));
      applyTreeUpdate({ ...tree, steps: newSteps });
    },
    [tree, applyTreeUpdate]
  );

  /** Deletion is a discrete, confirmed action (via the AlertDialog) rather than an in-progress
   * edit, and there's no panel left afterward to defer saving to — so it saves immediately,
   * using the freshly computed tree directly rather than the (not-yet-updated) `tree` state. */
  const handleRemoveStep = useCallback(
    (id: string) => {
      if (!tree) {
        return;
      }
      const newSteps = removeStepFromTree(tree.steps, id);
      const newTree = { ...tree, steps: newSteps };
      applyTreeUpdate(newTree);
      setSelectedNodeId(null);
      setDeleteConfirmOpen(false);
      void saveTree(newTree);
    },
    [tree, applyTreeUpdate, saveTree]
  );

  /** Attempts to leave the currently-open config panel — whether the user clicked "Save",
   * clicked outside the sheet, or pressed Escape. Skips the network call entirely if the tree
   * matches panelBaselineRef (nothing changed since the panel opened, or the user toggled
   * something and landed back on the original value) — otherwise saves the current
   * (already-applied-locally) tree; the panel only actually closes once that succeeds, so a
   * failed save leaves it open with every change still in place, ready to retry. */
  const handlePanelExit = useCallback(() => {
    if (!tree) {
      setSelectedNodeId(null);
      return;
    }
    if (panelBaselineRef.current !== null && JSON.stringify(tree) === panelBaselineRef.current) {
      setSelectedNodeId(null);
      return;
    }
    void saveTree(tree).then((ok) => {
      if (ok) {
        setSelectedNodeId(null);
      }
    });
  }, [tree, saveTree]);

  const isLoading = workflow === undefined;

  const selectedNode = useMemo(() => {
    if (!tree || !selectedNodeId) {
      return null;
    }
    if (selectedNodeId === "__trigger") {
      return tree.trigger;
    }
    return findStepInTree(tree.steps, selectedNodeId) ?? null;
  }, [tree, selectedNodeId]);

  /** Every step id currently in use, for the Step ID field's live uniqueness check. */
  const existingStepIds = useMemo(() => (tree ? collectStepIds(tree.steps) : new Set<string>()), [tree]);

  /** ${stepId.field} variables the selected step can reference — only steps that would
   * have already run by the time it executes (see computeAvailableVariables). Conditions and
   * waits get these too: their field/value/event inputs read runtime context the same way an
   * action's parameters do. The trigger is excluded — nothing runs before it. */
  const availableVariables = useMemo(() => {
    if (!tree || !selectedNode || selectedNode.type === "trigger") {
      return [];
    }
    return computeAvailableVariables(tree, selectedNode.id, catalogActions, catalogTriggers);
  }, [tree, selectedNode, catalogActions, catalogTriggers]);

  const selectedNodeLabel = useMemo(() => {
    if (!selectedNode) {
      return "Node Configuration";
    }
    if (selectedNode.type === "trigger") {
      return triggerNodeLabel(selectedNode, catalogTriggers);
    }
    if (selectedNode.type === "action") {
      return actionNodeLabel(selectedNode, catalogActions);
    }
    return selectedNode.type === "condition" ? "Condition" : "Wait";
  }, [selectedNode, catalogTriggers, catalogActions]);

  /** A workflow must always keep a trigger and at least one action, so the last remaining action can't be removed
   * (nor a condition whose branches hold the only remaining actions). */
  const canRemoveSelected = useMemo(() => {
    if (!tree || !selectedNode || selectedNode.type === "trigger") {
      return false;
    }
    return countActionSteps(removeStepFromTree(tree.steps, selectedNode.id)) > 0;
  }, [tree, selectedNode]);

  const deleteDialogDescription = useMemo(() => {
    if (
      selectedNode?.type === "condition" &&
      (selectedNode.thenBranch.length > 0 || selectedNode.elseBranch.length > 0)
    ) {
      return "This will also delete every step inside its Then and Else branches. This action cannot be undone.";
    }
    return "This action cannot be undone.";
  }, [selectedNode]);

  return (
    <div className="h-full flex overflow-hidden">
      <ScrollArea className="flex-1">
        <div className="p-8 max-w-2xl mx-auto">
          {isLoading ? (
            <div className="text-sm text-muted-foreground">Loading workflow…</div>
          ) : !workflow ? (
            <div className="text-sm text-muted-foreground">Workflow not found.</div>
          ) : tree ? (
            <div className="space-y-0">
              <StepNodeCard
                node={tree.trigger}
                isSelected={selectedNodeId === "__trigger"}
                onSelect={() => selectNode("__trigger")}
                catalogTriggers={catalogTriggers}
                catalogActions={catalogActions}
                resourceLabels={resourceLabels}
              />
              <InsertButton onInsert={(type) => handleInsertRequest(null, 0, type)} label="Add step after trigger" />
              <StepList
                steps={tree.steps}
                path={null}
                selectedId={selectedNodeId}
                onSelect={selectNode}
                onInsertAtPath={handleInsertRequest}
                catalogTriggers={catalogTriggers}
                catalogActions={catalogActions}
                resourceLabels={resourceLabels}
              />
            </div>
          ) : null}
        </div>
      </ScrollArea>

      <ActionPickerDialog
        open={!!pendingActionInsert}
        onOpenChange={(open) => {
          if (!open) {
            setPendingActionInsert(null);
          }
        }}
        actionPresets={actionPresets}
        onSelect={handleActionPicked}
      />

      <Sheet
        open={!!selectedNode}
        onOpenChange={(open) => {
          if (!open) {
            handlePanelExit();
          }
        }}
      >
        <SheetContent className="w-[400px] flex flex-col overflow-hidden">
          <SheetHeader>
            <SheetTitle>{selectedNodeLabel}</SheetTitle>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto mt-6 space-y-6">
            {selectedNode && (
              <StepConfigPanel
                node={selectedNode}
                catalogTriggers={catalogTriggers}
                catalogActions={catalogActions}
                catalogLoading={catalogLoading}
                existingStepIds={existingStepIds}
                availableVariables={availableVariables}
                onUpdateTriggerConditions={handleUpdateTriggerConditions}
                onUpdateActionParameters={handleUpdateActionParameters}
                onUpdateConditionConditions={handleUpdateConditionConditions}
                onUpdateWaitConfig={handleUpdateWaitConfig}
                onUpdateActionId={handleUpdateActionId}
              />
            )}
            {selectedNode && (
              <details>
                <summary className="text-sm text-muted-foreground cursor-pointer">Raw JSON</summary>
                <pre className="mt-2 text-xs bg-muted p-3 rounded overflow-auto max-h-64">
                  {JSON.stringify(selectedNode, null, 2)}
                </pre>
              </details>
            )}
          </div>
          <div className="mt-4 pt-4 border-t flex items-center justify-between gap-2 shrink-0">
            {selectedNode && selectedNode.type !== "trigger" ? (
              <Button
                variant="ghost"
                size="icon"
                className="text-destructive hover:text-destructive"
                disabled={!canRemoveSelected}
                onClick={() => setDeleteConfirmOpen(true)}
                title={
                  canRemoveSelected
                    ? "Delete step"
                    : "A workflow needs at least one action — add another action before removing this one."
                }
                data-testid="button-delete-step"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            ) : (
              <div />
            )}
            <Button onClick={handlePanelExit} disabled={isSaving} data-testid="button-save-step">
              {isSaving ? "Saving…" : "Save"}
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this step?</AlertDialogTitle>
            <AlertDialogDescription>{deleteDialogDescription}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (selectedNode) {
                  handleRemoveStep(selectedNode.id);
                }
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
