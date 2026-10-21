import { ArrowRight, Bell, type LucideIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { ObjectActionPicker } from "@/components/flow/object-action-picker";
import { StepInlineEditor } from "@/components/flow/step-inline-editor";
import { Button } from "@/components/ui/button";
import { useActionObjectInstances } from "@/hooks/use-action-object-instances";
import type { CatalogActionRow } from "@/hooks/use-workflow-catalog";
import { actionObjects, stepTarget } from "@/lib/action-objects";
import { type MacroActionStep, macroStepFromNode, macroStepNode } from "@/lib/macro-pad";
import { stepSummary } from "@/lib/step-summary";
import { resolveCatalogAction } from "@/lib/workflow-node-label";
import type { ActionPreset } from "@/lib/workflow-presets";
import { presetToActionStep, resolveActionStepPreset } from "@/lib/workflow-presets-json";

const NO_STEP_IDS: ReadonlySet<string> = new Set();

/** The engine's own Alert handler gets its bell; every other action shows its catalog entry's icon. */
function stepIcon(handlerType: string, preset: ActionPreset | undefined): LucideIcon {
  if (handlerType === "alert") {
    return Bell;
  }
  return preset?.icon ?? ArrowRight;
}

interface MacroActionStepEditorProps {
  value: MacroActionStep | null;
  onChange: (step: MacroActionStep) => void;
  /** Every action installed for this instance, from useWorkflowCatalog. */
  actionPresets: ActionPreset[];
  /** The same catalog as rows, which the flow's step editors read. */
  catalogActions: CatalogActionRow[];
  /** Whether the catalog is still loading, so a saved action is not reported missing too early. */
  catalogLoading: boolean;
  /** How the chosen action reads, from useMacroActionSentence. */
  sentence: string;
}

/** The macro's form of the catalog action the user picked, with `parameters` or else its default settings. */
export function presetToMacroActionStep(preset: ActionPreset, parameters?: Record<string, unknown>): MacroActionStep {
  const step = presetToActionStep(preset, "action-1");
  return {
    action: step.action,
    ...(step.function && { function: step.function }),
    ...(step.$ref && { ref: step.$ref }),
    parameters: parameters ?? step.parameters ?? {},
  };
}

function findPreset(step: MacroActionStep, presets: ActionPreset[]): ActionPreset | undefined {
  return resolveActionStepPreset({ action: step.action, function: step.function, $ref: step.ref }, presets);
}

/**
 * How a button's action reads as a step, "Increment Hype counter", worded as the
 * flow words a collapsed step. `ready` is false until the catalog and the thing
 * the action points at have loaded, so the sentence will not change under a
 * caller that compares a stored label with it.
 */
export function useMacroActionSentence(
  step: MacroActionStep | null,
  actionPresets: ActionPreset[],
  catalogActions: CatalogActionRow[],
  catalogLoading: boolean
): { sentence: string; ready: boolean } {
  const preset = step ? findPreset(step, actionPresets) : undefined;
  // Only the object the action is listed under, so only its things are loaded.
  const objects = useMemo(
    () =>
      preset
        ? actionObjects(actionPresets).filter((object) =>
            object.actions.some((candidate) => candidate.preset.id === preset.id)
          )
        : [],
    [actionPresets, preset]
  );
  const instances = useActionObjectInstances(objects);
  if (!step) {
    return { sentence: "", ready: !catalogLoading };
  }
  const node = macroStepNode(step);
  const action = resolveCatalogAction(node, catalogActions);
  if (!action || !preset) {
    return { sentence: step.function ?? step.action, ready: !catalogLoading };
  }
  const { target, ready } = stepTarget(objects, instances, preset, node.parameters);
  return { sentence: stepSummary(node, { action, target }).title, ready: ready && !catalogLoading };
}

/**
 * A "run-action" button's one action, picked in place with the same picker a
 * flow adds steps with (actions only, since a button runs one), then shown as
 * that step with its settings under it, edited by the flow's own step editor so
 * the action runs exactly as it would there.
 */
export function MacroActionStepEditor({
  value,
  onChange,
  actionPresets,
  catalogActions,
  catalogLoading,
  sentence,
}: MacroActionStepEditorProps) {
  // With no action yet the picker is open unless the streamer closed it; with
  // one, only after "Change". Kept apart so an action arriving after the first
  // render (the editor is reset as it opens) shows as chosen, not as the picker.
  const [changing, setChanging] = useState(false);
  const [closedEmpty, setClosedEmpty] = useState(false);
  const picking = value ? changing : !closedEmpty;

  if (catalogLoading) {
    return <p className="text-sm text-muted-foreground">Loading actions…</p>;
  }

  if (picking) {
    return (
      <ObjectActionPicker
        presets={actionPresets}
        flowSteps={[]}
        heading={value ? "Choose another action" : "Choose an action"}
        onPick={(pick) => {
          if (pick.kind !== "action") {
            return;
          }
          onChange(presetToMacroActionStep(pick.preset, pick.parameters));
          setChanging(false);
        }}
        onCancel={() => {
          setChanging(false);
          setClosedEmpty(true);
        }}
      />
    );
  }

  if (!value) {
    return (
      <Button
        variant="outline"
        className="w-full"
        onClick={() => setClosedEmpty(false)}
        data-testid="button-choose-action"
      >
        Choose an action
      </Button>
    );
  }

  const preset = findPreset(value, actionPresets);
  const Icon = stepIcon(value.action, preset);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 rounded-md border border-border p-3" data-testid="macro-action-selected">
        <Icon className="h-4 w-4 shrink-0 text-primary-text" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium" data-testid="text-macro-action-sentence">
            {sentence}
          </p>
          {preset?.description && <p className="truncate text-xs text-muted-foreground">{preset.description}</p>}
        </div>
        <Button variant="outline" size="sm" onClick={() => setChanging(true)} data-testid="button-change-action">
          Change
        </Button>
      </div>

      {preset ? (
        <StepInlineEditor
          step={macroStepNode(value)}
          catalogTriggers={[]}
          catalogActions={catalogActions}
          catalogLoading={false}
          existingStepIds={NO_STEP_IDS}
          availableVariables={[]}
          onChange={(step) => {
            if (step.type === "action") {
              onChange(macroStepFromNode(step));
            }
          }}
        />
      ) : (
        <p className="text-xs text-muted-foreground">
          This action isn't in the catalog. Its settings are kept as they are. Reinstall the module that provides it, or
          choose another action.
        </p>
      )}
    </div>
  );
}
