import type { ConditionConfig } from "@woofx3/api";
import { ActionConfigPanel, ConditionConfigPanel, WaitConfigPanel } from "@/components/workflows/step-config-panel";
import type { CatalogActionRow, CatalogTriggerRow } from "@/hooks/use-workflow-catalog";
import type { WaitConfig } from "@/lib/wait-config";
import type { StepNode } from "@/lib/workflow-tree";
import type { VariableOption } from "@/lib/workflow-variables";

export interface StepInlineEditorProps {
  step: StepNode;
  catalogTriggers: CatalogTriggerRow[];
  catalogActions: CatalogActionRow[];
  catalogLoading: boolean;
  existingStepIds: ReadonlySet<string>;
  /** Values of the trigger and of earlier steps this step can read. */
  availableVariables: VariableOption[];
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
  onChange,
  onRename,
}: StepInlineEditorProps) {
  if (catalogLoading) {
    return <p className="text-sm text-muted-foreground">Loading catalog…</p>;
  }
  switch (step.type) {
    case "action":
      return (
        <ActionConfigPanel
          node={step}
          catalog={catalogActions}
          existingStepIds={existingStepIds}
          availableVariables={availableVariables}
          onUpdateActionParameters={(_id, parameters: Record<string, unknown>) => onChange({ ...step, parameters })}
          onUpdateActionId={onRename}
        />
      );
    case "condition":
      return (
        <ConditionConfigPanel
          node={step}
          availableVariables={availableVariables}
          onUpdateConditionConditions={(_id, conditions: ConditionConfig[]) => onChange({ ...step, conditions })}
        />
      );
    case "wait":
      return (
        <WaitConfigPanel
          node={step}
          catalogTriggers={catalogTriggers}
          onUpdateWaitConfig={(_id, wait: WaitConfig) => onChange({ ...step, wait })}
        />
      );
    default:
      return null;
  }
}
