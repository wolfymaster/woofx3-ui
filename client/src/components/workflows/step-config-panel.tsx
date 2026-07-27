import type { ConditionConfig, WaitConfig } from "@woofx3/api";
import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { CatalogActionRow, CatalogTriggerRow } from "@/hooks/use-workflow-catalog";
import { parseConfigFields, withModuleName } from "@/lib/parse-config-fields";
import { resolveCatalogAction, resolveCatalogTrigger } from "@/lib/workflow-node-label";
import type { TriggerConfigValues } from "@/lib/workflow-presets";
import { conditionsToFieldValues, fieldValuesToConditions } from "@/lib/workflow-presets-json";
import type { ActionNode, ConditionNode, StepNode, TriggerNode, WaitNode } from "@/lib/workflow-tree";
import { isValidStepId, type VariableOption } from "@/lib/workflow-variables";
import { ConditionEditor } from "./condition-editor";
import { TriggerConfigForm } from "./trigger-config-form";
import { WaitEditor } from "./wait-editor";

interface StepConfigPanelProps {
  node: TriggerNode | StepNode;
  catalogTriggers: CatalogTriggerRow[];
  catalogActions: CatalogActionRow[];
  catalogLoading: boolean;
  existingStepIds: ReadonlySet<string>;
  /** Variables the currently-selected action step can reference — see computeAvailableVariables. */
  availableVariables: VariableOption[];
  onUpdateTriggerConditions: (conditions: ConditionConfig[]) => void;
  onUpdateActionParameters: (id: string, parameters: Record<string, unknown>) => void;
  onUpdateConditionConditions: (id: string, conditions: ConditionConfig[]) => void;
  onUpdateWaitConfig: (id: string, wait: WaitConfig) => void;
  onUpdateActionId: (oldId: string, newId: string) => void;
}

/** Editable step id, committed on blur/Enter rather than per keystroke — renaming mid-tree updates the
 * tree, autosaves, and re-selects under the new id, which would be disruptive on every character typed. */
function StepIdField({
  id,
  existingStepIds,
  onUpdateActionId,
}: {
  id: string;
  existingStepIds: ReadonlySet<string>;
  onUpdateActionId: (oldId: string, newId: string) => void;
}) {
  const [draft, setDraft] = useState(id);

  useEffect(() => {
    setDraft(id);
  }, [id]);

  const trimmed = draft.trim();
  const error =
    trimmed.length === 0
      ? "Step ID can't be empty."
      : !isValidStepId(trimmed)
        ? "Use only letters, numbers, dots, underscores, and hyphens."
        : trimmed !== id && existingStepIds.has(trimmed)
          ? "Already used by another step in this workflow."
          : null;

  const commit = () => {
    if (error) {
      setDraft(id);
      return;
    }
    if (trimmed !== id) {
      onUpdateActionId(id, trimmed);
    }
  };

  return (
    <div className="space-y-2">
      <Label htmlFor="step-id">Step ID</Label>
      <Input
        id="step-id"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.currentTarget.blur();
          }
        }}
        className="font-mono text-xs"
        data-testid="input-step-id"
      />
      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : (
        <p className="text-xs text-muted-foreground">
          Reference this step's output elsewhere as <code>{`\${${trimmed || id}.field}`}</code>.
        </p>
      )}
    </div>
  );
}

function TriggerConfigPanel({
  node,
  catalog,
  onUpdateTriggerConditions,
}: {
  node: TriggerNode;
  catalog: CatalogTriggerRow[];
  onUpdateTriggerConditions: (conditions: ConditionConfig[]) => void;
}) {
  const catalogRow = resolveCatalogTrigger(node, catalog);
  const fields = withModuleName(parseConfigFields(catalogRow?.configFields), catalogRow?.moduleName);
  if (fields.length === 0) {
    return <p className="text-sm text-muted-foreground">This trigger has no configurable settings.</p>;
  }
  const values = conditionsToFieldValues(fields, node.conditions);
  return (
    <TriggerConfigForm
      fields={fields}
      values={values}
      onChange={(next) => onUpdateTriggerConditions(fieldValuesToConditions(fields, next))}
    />
  );
}

function ActionConfigPanel({
  node,
  catalog,
  existingStepIds,
  availableVariables,
  onUpdateActionParameters,
  onUpdateActionId,
}: {
  node: ActionNode;
  catalog: CatalogActionRow[];
  existingStepIds: ReadonlySet<string>;
  availableVariables: VariableOption[];
  onUpdateActionParameters: (id: string, parameters: Record<string, unknown>) => void;
  onUpdateActionId: (oldId: string, newId: string) => void;
}) {
  const catalogRow = resolveCatalogAction(node, catalog);
  const fields = withModuleName(parseConfigFields(catalogRow?.configFields), catalogRow?.moduleName);
  return (
    <div className="space-y-6">
      <StepIdField id={node.id} existingStepIds={existingStepIds} onUpdateActionId={onUpdateActionId} />
      {fields.length === 0 ? (
        <p className="text-sm text-muted-foreground">This action has no other configurable settings.</p>
      ) : (
        <TriggerConfigForm
          fields={fields}
          values={node.parameters as TriggerConfigValues}
          onChange={(next) => onUpdateActionParameters(node.id, next)}
          availableVariables={availableVariables}
        />
      )}
    </div>
  );
}

function ConditionConfigPanel({
  node,
  onUpdateConditionConditions,
}: {
  node: ConditionNode;
  onUpdateConditionConditions: (id: string, conditions: ConditionConfig[]) => void;
}) {
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        The workflow continues down the "then" branch when every condition below matches, otherwise it takes "else".
      </p>
      <ConditionEditor
        conditions={node.conditions}
        onChange={(conditions) => onUpdateConditionConditions(node.id, conditions)}
      />
    </div>
  );
}

function WaitConfigPanel({
  node,
  onUpdateWaitConfig,
}: {
  node: WaitNode;
  onUpdateWaitConfig: (id: string, wait: WaitConfig) => void;
}) {
  return <WaitEditor wait={node.wait} onChange={(wait) => onUpdateWaitConfig(node.id, wait)} />;
}

export function StepConfigPanel({
  node,
  catalogTriggers,
  catalogActions,
  catalogLoading,
  existingStepIds,
  availableVariables,
  onUpdateTriggerConditions,
  onUpdateActionParameters,
  onUpdateConditionConditions,
  onUpdateWaitConfig,
  onUpdateActionId,
}: StepConfigPanelProps) {
  if (catalogLoading) {
    return <p className="text-sm text-muted-foreground">Loading catalog…</p>;
  }
  if (node.type === "trigger") {
    return (
      <TriggerConfigPanel node={node} catalog={catalogTriggers} onUpdateTriggerConditions={onUpdateTriggerConditions} />
    );
  }
  if (node.type === "action") {
    return (
      <ActionConfigPanel
        node={node}
        catalog={catalogActions}
        existingStepIds={existingStepIds}
        availableVariables={availableVariables}
        onUpdateActionParameters={onUpdateActionParameters}
        onUpdateActionId={onUpdateActionId}
      />
    );
  }
  if (node.type === "condition") {
    return <ConditionConfigPanel node={node} onUpdateConditionConditions={onUpdateConditionConditions} />;
  }
  return <WaitConfigPanel node={node} onUpdateWaitConfig={onUpdateWaitConfig} />;
}
