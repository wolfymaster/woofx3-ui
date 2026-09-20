import type { ActionStep } from "@woofx3/api";
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ActionPickerDialog } from "@/components/workflows/action-picker-dialog";
import { TriggerConfigForm } from "@/components/workflows/trigger-config-form";
import { cn } from "@/lib/utils";
import type { ActionPreset, TriggerConfigValues } from "@/lib/workflow-presets";
import { presetToActionStep, resolveActionStepPreset } from "@/lib/workflow-presets-json";
import type { VariableOption } from "@/lib/workflow-variables";

interface ActionListEditorProps {
  actions: ActionStep[];
  onChange: (actions: ActionStep[]) => void;
  /** The catalog to pick from — every action installed for this instance. */
  actionPresets: ActionPreset[];
  /** Offered in the actions' text fields; see computeAvailableVariables. */
  availableVariables?: VariableOption[];
  /** Shown in place of the list when nothing has been added yet. */
  emptyHint?: string;
}

/**
 * An ordered list of actions, and the settings of whichever one is open.
 *
 * Actions run top to bottom, which is why the order is editable here rather
 * than implied by a dependency the user cannot see. Each row's settings are the
 * action's own declared fields, rendered by the same form a workflow step uses,
 * so an action configured here and the same action configured in the builder
 * offer exactly the same controls.
 */
export function ActionListEditor({
  actions,
  onChange,
  actionPresets,
  availableVariables,
  emptyHint,
}: ActionListEditorProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
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
    setPickerOpen(false);
  };

  const updateAction = (index: number, change: (step: ActionStep) => ActionStep) => {
    onChange(actions.map((step, i) => (i === index ? change(step) : step)));
  };

  const removeAction = (index: number) => {
    onChange(actions.filter((_, i) => i !== index));
  };

  const moveAction = (index: number, delta: number) => {
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
    <div className="space-y-2">
      {actions.length === 0 ? (
        <p className="text-xs text-muted-foreground border rounded-md px-3 py-4 text-center">
          {emptyHint ?? "No actions yet. Add one to decide what happens."}
        </p>
      ) : (
        <div className="space-y-2">
          {actions.map((step, index) => {
            const preset = resolveActionStepPreset(step, actionPresets);
            const fields = preset?.config?.fields ?? [];
            const isExpanded = expandedId === step.id;
            return (
              <div key={step.id ?? index} className="rounded-md border bg-background">
                <div className="flex items-center gap-2 px-2 py-2">
                  <button
                    type="button"
                    onClick={() => setExpandedId(isExpanded ? null : (step.id ?? null))}
                    className="flex items-center gap-2 flex-1 min-w-0 text-left cursor-pointer"
                    data-testid={`action-row-${step.id ?? index}`}
                  >
                    {isExpanded ? (
                      <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                    <span className="min-w-0">
                      <span className="block text-sm font-medium truncate">
                        {preset?.name ?? step.function ?? step.action}
                      </span>
                      <span className="block text-xs text-muted-foreground truncate">{summarize(step, preset)}</span>
                    </span>
                  </button>

                  <div className="flex items-center shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      className={cn("h-8 w-8", index === 0 && "invisible")}
                      onClick={() => moveAction(index, -1)}
                      aria-label="Move action up"
                    >
                      <ArrowUp className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className={cn("h-8 w-8", index === actions.length - 1 && "invisible")}
                      onClick={() => moveAction(index, 1)}
                      aria-label="Move action down"
                    >
                      <ArrowDown className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive hover:text-destructive"
                      onClick={() => removeAction(index)}
                      aria-label="Remove action"
                      data-testid={`remove-action-${step.id ?? index}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>

                {isExpanded && (
                  <div className="border-t px-3 py-3">
                    {!preset ? (
                      <p className="text-xs text-muted-foreground">
                        This action isn't in the catalog — its settings are kept as they are. Reinstall the module that
                        provides it to edit them here.
                      </p>
                    ) : fields.length === 0 ? (
                      <p className="text-xs text-muted-foreground">This action has no settings.</p>
                    ) : (
                      <TriggerConfigForm
                        fields={fields}
                        values={(step.parameters ?? {}) as TriggerConfigValues}
                        onChange={(parameters) =>
                          updateAction(index, (current) => ({
                            ...current,
                            parameters: parameters as ActionStep["parameters"],
                          }))
                        }
                        availableVariables={availableVariables}
                      />
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <Button variant="outline" size="sm" onClick={() => setPickerOpen(true)} data-testid="button-add-action">
        <Plus className="h-4 w-4 mr-2" />
        Add action
      </Button>

      <ActionPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        actionPresets={actionPresets}
        onSelect={addAction}
      />
    </div>
  );
}

/** First filled-in parameter, so a collapsed row still says what it will do. */
function summarize(step: ActionStep, preset: ActionPreset | undefined): string {
  for (const field of preset?.config?.fields ?? []) {
    const value = step.parameters?.[field.id];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
    if (typeof value === "number") {
      return `${field.label}: ${value}`;
    }
  }
  return preset?.description || step.function || step.action;
}
