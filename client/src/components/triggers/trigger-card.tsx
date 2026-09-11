import { ChevronDown, ChevronRight, Plus, Trash2 } from "lucide-react";
import { ActionRow } from "@/components/triggers/action-row";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TriggerConfigForm } from "@/components/workflows/trigger-config-form";
import { type ProjectedAction, type ProjectedTrigger, UNCONDITIONAL_TRIGGER_ID } from "@/lib/trigger-projection";
import type { ActionPreset, TriggerConfigValues, TriggerPreset } from "@/lib/workflow-presets";

interface TriggerCardProps {
  trigger: ProjectedTrigger;
  triggerPreset: TriggerPreset;
  actionPresets: ActionPreset[];
  /** Values decoded from the trigger's conditions, held by the editor. */
  conditionValues: TriggerConfigValues;
  isExpanded: boolean;
  expandedActionId: string | null;
  onToggleExpanded: () => void;
  onExpandAction: (actionId: string | null) => void;
  onChangeConditions: (values: TriggerConfigValues) => void;
  onChangeActionParameters: (actionId: string, parameters: TriggerConfigValues) => void;
  onToggleActionConcurrent: (actionId: string) => void;
  onRemoveAction: (actionId: string) => void;
  onAddAction: (preset: ActionPreset) => void;
  onRemove: () => void;
  resolveActionPreset: (action: ProjectedAction) => ActionPreset | undefined;
  summary: string;
}

export function TriggerCard({
  trigger,
  triggerPreset,
  actionPresets,
  conditionValues,
  isExpanded,
  expandedActionId,
  onToggleExpanded,
  onExpandAction,
  onChangeConditions,
  onChangeActionParameters,
  onToggleActionConcurrent,
  onRemoveAction,
  onAddAction,
  onRemove,
  resolveActionPreset,
  summary,
}: TriggerCardProps) {
  const conditionFields = triggerPreset.config?.fields ?? [];
  const isUnconditional = trigger.id === UNCONDITIONAL_TRIGGER_ID;

  return (
    <Card data-testid={`trigger-card-${trigger.id}`}>
      <div className="flex items-center gap-2 px-3 py-3">
        <button
          type="button"
          onClick={onToggleExpanded}
          className="flex items-center gap-2 flex-1 min-w-0 text-left cursor-pointer"
        >
          {isExpanded ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          )}
          <span className="min-w-0">
            <span className="block text-sm font-medium truncate">{summary}</span>
            <span className="block text-xs text-muted-foreground truncate">
              {trigger.actions.length === 0
                ? "No actions yet"
                : trigger.actions
                    .map((action) => resolveActionPreset(action)?.name ?? action.functionCall ?? action.handlerType)
                    .join(" · ")}
            </span>
          </span>
        </button>

        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0 text-destructive hover:text-destructive"
          onClick={onRemove}
          title="Remove trigger"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      {isExpanded && (
        <div className="border-t px-4 py-4 space-y-5">
          <div className="space-y-2">
            <h3 className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">When</h3>
            {isUnconditional ? (
              <p className="text-xs text-muted-foreground">
                Runs on every {triggerPreset.name.toLowerCase()}. These actions were authored without conditions.
              </p>
            ) : conditionFields.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                This event has no settings to narrow by — it fires every time.
              </p>
            ) : (
              <TriggerConfigForm fields={conditionFields} values={conditionValues} onChange={onChangeConditions} />
            )}
          </div>

          <div className="space-y-2">
            <h3 className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Then</h3>
            {trigger.actions.length === 0 ? (
              <p className="text-xs text-muted-foreground">Nothing happens yet. Add an action below.</p>
            ) : (
              <div className="space-y-2">
                {trigger.actions.map((action, index) => (
                  <ActionRow
                    key={action.id}
                    action={action}
                    preset={resolveActionPreset(action)}
                    isFirst={index === 0}
                    isExpanded={expandedActionId === action.id}
                    onToggleExpanded={() => onExpandAction(expandedActionId === action.id ? null : action.id)}
                    onChangeParameters={(parameters) => onChangeActionParameters(action.id, parameters)}
                    onToggleConcurrent={() => onToggleActionConcurrent(action.id)}
                    onRemove={() => onRemoveAction(action.id)}
                  />
                ))}
              </div>
            )}

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" data-testid={`add-action-${trigger.id}`}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add action
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="max-h-80 overflow-y-auto w-72">
                {actionPresets.map((preset) => (
                  <DropdownMenuItem
                    key={preset.id}
                    onClick={() => onAddAction(preset)}
                    className="flex-col items-start"
                  >
                    <span className="text-sm">{preset.name}</span>
                    {preset.description && (
                      <span className="text-xs text-muted-foreground line-clamp-2">{preset.description}</span>
                    )}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      )}
    </Card>
  );
}
