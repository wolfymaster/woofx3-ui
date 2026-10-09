import { useState } from "react";
import { stepIcon } from "@/components/triggers/action-row";
import { Button } from "@/components/ui/button";
import { ActionPickerDialog } from "@/components/workflows/action-picker-dialog";
import { TriggerConfigForm } from "@/components/workflows/trigger-config-form";
import type { MacroActionStep } from "@/lib/macro-pad";
import type { ActionPreset, TriggerConfigValues } from "@/lib/workflow-presets";
import { presetToActionStep, resolveActionStepPreset } from "@/lib/workflow-presets-json";

interface MacroActionStepEditorProps {
  value: MacroActionStep | null;
  onChange: (step: MacroActionStep) => void;
  /** Every action installed for this instance, from useWorkflowCatalog. */
  actionPresets: ActionPreset[];
  /** Whether the catalog is still loading, so a saved action is not reported missing too early. */
  catalogLoading: boolean;
}

/** The macro's form of the catalog action the user picked, with its default settings. */
export function presetToMacroActionStep(preset: ActionPreset): MacroActionStep {
  const step = presetToActionStep(preset, "action-1");
  return {
    action: step.action,
    ...(step.function && { function: step.function }),
    ...(step.$ref && { ref: step.$ref }),
    parameters: step.parameters ?? {},
  };
}

function findPreset(step: MacroActionStep, presets: ActionPreset[]): ActionPreset | undefined {
  return resolveActionStepPreset({ action: step.action, function: step.function, $ref: step.ref }, presets);
}

/**
 * A "run-action" button's one action: picked from the same catalog dialog the
 * workflow builder uses, and configured through the same settings form a
 * workflow step or chat command step gets, so the action runs exactly as it
 * would there.
 */
export function MacroActionStepEditor({ value, onChange, actionPresets, catalogLoading }: MacroActionStepEditorProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const preset = value ? findPreset(value, actionPresets) : undefined;
  const fields = preset?.config?.fields ?? [];
  const Icon = value ? stepIcon({ handlerType: value.action }, preset) : null;

  return (
    <div className="space-y-4">
      {value && Icon ? (
        <div
          className="flex items-center gap-3 rounded-md border border-border p-3"
          data-testid="macro-action-selected"
        >
          <Icon className="h-4 w-4 shrink-0 text-primary-text" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">{preset?.name ?? value.function ?? value.action}</p>
            {preset?.description && <p className="truncate text-xs text-muted-foreground">{preset.description}</p>}
          </div>
          <Button variant="outline" size="sm" onClick={() => setPickerOpen(true)} data-testid="button-change-action">
            Change
          </Button>
        </div>
      ) : (
        <Button
          variant="outline"
          className="w-full"
          onClick={() => setPickerOpen(true)}
          disabled={catalogLoading}
          data-testid="button-choose-action"
        >
          {catalogLoading ? "Loading actions…" : "Choose an action"}
        </Button>
      )}

      {value &&
        !catalogLoading &&
        (!preset ? (
          <p className="text-xs text-muted-foreground">
            This action isn't in the catalog. Its settings are kept as they are. Reinstall the module that provides it,
            or choose another action.
          </p>
        ) : fields.length === 0 ? (
          <p className="text-xs text-muted-foreground">This action has no settings.</p>
        ) : (
          <TriggerConfigForm
            fields={fields}
            values={(value.parameters ?? {}) as TriggerConfigValues}
            onChange={(parameters) => onChange({ ...value, parameters })}
          />
        ))}

      <ActionPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        actionPresets={actionPresets}
        onSelect={(picked) => onChange(presetToMacroActionStep(picked))}
      />
    </div>
  );
}
