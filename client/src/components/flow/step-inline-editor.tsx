import { ActionSettingsEditor } from "@/components/flow/action-settings-editor";
import { ConditionStepEditor } from "@/components/flow/condition-builder";
import { WaitStepEditor } from "@/components/flow/wait-step-editor";
import type { CatalogActionRow, CatalogTriggerRow } from "@/hooks/use-workflow-catalog";
import { type ConditionSources, NO_ENGINE_CONDITION_SUPPORT } from "@/lib/condition-builder";
import type { WaitConfig } from "@/lib/wait-config";
import type { StepNode } from "@/lib/workflow-tree";
import type { VariableOption } from "@/lib/workflow-variables";

const NO_CONDITION_SOURCES: ConditionSources = { fields: [], namesViewer: false, support: NO_ENGINE_CONDITION_SUPPORT };

export interface StepInlineEditorProps {
  step: StepNode;
  catalogTriggers: CatalogTriggerRow[];
  catalogActions: CatalogActionRow[];
  catalogLoading: boolean;
  existingStepIds: ReadonlySet<string>;
  /** Values of the trigger and of earlier steps this step can read. */
  availableVariables: VariableOption[];
  /** What a condition step's rows can check; see conditionSourcesFor. Only a flow with condition steps passes it. */
  conditionSources?: ConditionSources;
  onChange: (step: StepNode) => void;
  /** Absent where steps have no ids the streamer edits, as on a macro button. */
  onRename?: (oldId: string, newId: string) => void;
}

/**
 * The settings of one step, shown inside its row in the flow. Each step kind's editor is
 * chosen here and nowhere else, so a kind's editor can be replaced on its own.
 */
export function StepInlineEditor({
  step,
  catalogTriggers,
  catalogActions,
  catalogLoading,
  existingStepIds,
  availableVariables,
  conditionSources,
  onChange,
  onRename,
}: StepInlineEditorProps) {
  if (catalogLoading) {
    return <p className="text-sm text-muted-foreground">Loading catalog…</p>;
  }
  switch (step.type) {
    case "action":
      return (
        <ActionSettingsEditor
          step={step}
          catalogActions={catalogActions}
          existingStepIds={existingStepIds}
          availableVariables={availableVariables}
          onChange={onChange}
          onRename={onRename}
        />
      );
    case "condition":
      return (
        <ConditionStepEditor
          step={step}
          sources={conditionSources ?? NO_CONDITION_SOURCES}
          availableVariables={availableVariables}
          onChange={onChange}
        />
      );
    case "wait":
      return (
        <WaitStepEditor
          key={step.id}
          step={step}
          catalogTriggers={catalogTriggers}
          onChange={(wait: WaitConfig) => onChange({ ...step, wait })}
        />
      );
    default:
      return null;
  }
}
