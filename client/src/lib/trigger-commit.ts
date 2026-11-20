import { escapeDollarKeys, unescapeDollarKeys } from "@shared/dollar-keys";
import type { WorkflowDefinition } from "@woofx3/api";
import type { ConfigField } from "@woofx3/api/ui-schema";
import type { WorkflowSaveOutcome } from "@/engine/types";
import { triggerFieldValues } from "@/lib/alert-triggers";
import type { TriggerConfigValues } from "@/lib/workflow-presets";
import { countActionSteps, definitionToTree, type WorkflowTree } from "@/lib/workflow-tree";

/** Every decision about a save is here; the caller only says what to show and where to go. */

/** The workflow a saved trigger is, as the editor saves it back. */
export interface SavedTrigger {
  engineWorkflowId: string;
  definition: WorkflowDefinition;
  revision?: number;
}

export type TriggerCommitOutcome =
  | {
      kind: "saved";
      revision: number | undefined;
      /** A trigger that didn't exist before, now stored under this engine id. */
      created?: SavedTrigger;
      /** Stored, but the engine refused the switch-on; the caller can point at the card. */
      enableFailed?: boolean;
    }
  | { kind: "needs-step" }
  | { kind: "incomplete"; fields: string[] }
  /** The caller's tree was replaced; `tree` is null when the stored version isn't editable here. */
  | { kind: "conflict"; tree: WorkflowTree | null; revision: number | undefined }
  | { kind: "failed"; error: string };

export interface TriggerCommitDeps {
  incompleteConditionFields: (fields: ConfigField[], values: TriggerConfigValues) => ConfigField[];
  treeToDefinition: (tree: WorkflowTree) => WorkflowDefinition;
  /** Takes a `$`-escaped definition and resolves once the engine has the workflow. */
  create: (definition: unknown) => Promise<{ engineWorkflowId: string }>;
  /** Takes a `$`-escaped definition and the revision the tree was read at. */
  update: (engineWorkflowId: string, definition: unknown, revision: number | undefined) => Promise<WorkflowSaveOutcome>;
  setEnabled: (engineWorkflowId: string, enabled: boolean) => Promise<unknown>;
}

export interface TriggerCommitArgs {
  tree: WorkflowTree;
  saved: SavedTrigger | undefined;
  conditionFields: ConfigField[];
  customName: string | undefined;
  revision: number | undefined;
  /** The sentence, or the preset's name when the sentence has no text yet. */
  fallbackName: string;
  deps: TriggerCommitDeps;
}

/** What happened to one attempt to save a trigger tree, without toasts, navigation or React. */
export async function commitTrigger({
  tree,
  saved,
  conditionFields,
  customName,
  revision,
  fallbackName,
  deps,
}: TriggerCommitArgs): Promise<TriggerCommitOutcome> {
  const missing = deps.incompleteConditionFields(
    conditionFields,
    triggerFieldValues(tree.trigger.conditions, conditionFields)
  );
  if (missing.length > 0) {
    return { kind: "incomplete", fields: missing.map((field) => field.label.toLowerCase()) };
  }
  if (countActionSteps(tree.steps) === 0) {
    // Nothing to run yet, so nothing the engine would keep: the trigger waits here for a step.
    return { kind: "needs-step" };
  }

  const definition = deps.treeToDefinition(tree);
  try {
    if (saved) {
      definition.id = saved.definition.id;
      definition.name = customName ?? saved.definition.name;
      const outcome = await deps.update(saved.engineWorkflowId, escapeDollarKeys(definition), revision);
      if (outcome.conflict) {
        const read = definitionToTree(unescapeDollarKeys(outcome.definition) as WorkflowDefinition);
        return { kind: "conflict", tree: read.editable ? read.tree : null, revision: outcome.revision };
      }
      return { kind: "saved", revision: outcome.revision };
    }

    const { id: _unsaved, ...unsaved } = definition;
    const name = customName ?? fallbackName;
    const { engineWorkflowId } = await deps.create(escapeDollarKeys({ ...unsaved, name }));
    let enableFailed = false;
    try {
      await deps.setEnabled(engineWorkflowId, true);
    } catch {
      enableFailed = true;
    }
    return {
      kind: "saved",
      revision: undefined,
      created: { engineWorkflowId, definition: { ...definition, id: engineWorkflowId, name } },
      enableFailed,
    };
  } catch (err) {
    return { kind: "failed", error: err instanceof Error ? err.message : String(err) };
  }
}
