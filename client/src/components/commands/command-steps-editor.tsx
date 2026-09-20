import type { ActionStep } from "@woofx3/api";
import { useState } from "react";
import { ActionRow } from "@/components/triggers/action-row";
import { StepTiles } from "@/components/triggers/step-tiles";
import { commandStepId } from "@/lib/command-drafts";
import type { ActionPreset, TriggerConfigValues } from "@/lib/workflow-presets";
import { presetToActionStep, resolveActionStepPreset } from "@/lib/workflow-presets-json";
import type { VariableOption } from "@/lib/workflow-variables";

interface CommandStepsEditorProps {
  actions: ActionStep[];
  onChange: (actions: ActionStep[]) => void;
  /** The catalog to pick from — every action installed for this instance. */
  actionPresets: ActionPreset[];
  /** Offered in the steps' text fields; see commandActionVariables. */
  availableVariables: VariableOption[];
  /** Where a step's alert content is edited — its own route, like every other editor here. */
  alertEditorHref: (actionId: string) => string;
}

/**
 * What a chat command runs, as the numbered steps the Alerts screen uses.
 *
 * The rows and the tile picker are the same components a trigger's steps are built from
 * (ActionRow, StepTiles), so an action configured on a command and the same action
 * configured on an alert look and behave alike — including a step's alert content, which
 * opens on its own route here as it does there. Two differences are the command's own:
 * its steps always run in order — the engine has no concurrency for them — so no
 * "start at the same time" switch is offered, and the order is the user's to change, so
 * the rows carry move buttons.
 */
export function CommandStepsEditor({
  actions,
  onChange,
  actionPresets,
  availableVariables,
  alertEditorHref,
}: CommandStepsEditorProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const nextId = () => {
    const used = new Set(actions.map((action) => action.id));
    let n = actions.length + 1;
    while (used.has(`action-${n}`)) {
      n += 1;
    }
    return `action-${n}`;
  };

  const addAction = (preset: ActionPreset) => {
    const step = presetToActionStep(preset, nextId());
    onChange([...actions, step]);
    setExpandedId(step.id ?? null);
  };

  const updateAction = (index: number, change: (step: ActionStep) => ActionStep) => {
    onChange(actions.map((step, i) => (i === index ? change(step) : step)));
  };

  const removeAction = (index: number) => {
    onChange(actions.filter((_, i) => i !== index));
  };

  const moveAction = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= actions.length) {
      return;
    }
    const reordered = [...actions];
    const [moved] = reordered.splice(index, 1);
    reordered.splice(target, 0, moved);
    onChange(reordered);
  };

  return (
    <div className="flex flex-col gap-2">
      {actions.length === 0 && (
        <p className="pt-2.5 text-sm text-muted-foreground">
          Nothing happens yet. Pick a step below — or leave it empty for a command that only fires its workflow trigger.
        </p>
      )}
      {actions.map((step, index) => {
        const id = commandStepId(step, index);
        return (
          <ActionRow
            key={id}
            action={{
              id,
              handlerType: step.action,
              functionCall: step.function,
              parameters: (step.parameters ?? {}) as TriggerConfigValues,
            }}
            preset={resolveActionStepPreset(step, actionPresets)}
            stepNumber={index + 1}
            availableVariables={availableVariables}
            alertEditorHref={alertEditorHref(id)}
            isExpanded={expandedId === id}
            canMoveDown={index < actions.length - 1}
            onToggleExpanded={() => setExpandedId(expandedId === id ? null : id)}
            onChangeParameters={(parameters) =>
              updateAction(index, (current) => ({
                ...current,
                parameters: parameters as ActionStep["parameters"],
              }))
            }
            onMove={(delta) => moveAction(index, delta)}
            onRemove={() => removeAction(index)}
          />
        );
      })}

      <div className="mt-2 flex flex-col gap-2.5">
        <span className="text-[13px] text-muted-foreground">Add a step</span>
        <StepTiles actionPresets={actionPresets} onAdd={addAction} />
      </div>
    </div>
  );
}
