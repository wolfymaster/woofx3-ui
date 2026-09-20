import type { ConfigField } from "@woofx3/api/ui-schema";
import { ChevronRight, ExternalLink } from "lucide-react";
import { ActionRow, actionName, stepDetail } from "@/components/triggers/action-row";
import { ConditionSentence, type LoadedFieldOptions } from "@/components/triggers/condition-sentence";
import { StepTiles } from "@/components/triggers/step-tiles";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { type SentencePart, sentenceText } from "@/lib/condition-sentence";
import { type ProjectedAction, type ProjectedTrigger, UNCONDITIONAL_TRIGGER_ID } from "@/lib/trigger-projection";
import { cn } from "@/lib/utils";
import type { ActionPreset, TriggerConfigValues, TriggerPreset } from "@/lib/workflow-presets";
import { projectedActionVariables } from "@/lib/workflow-variables";

interface TriggerCardProps {
  trigger: ProjectedTrigger;
  triggerPreset: TriggerPreset;
  actionPresets: ActionPreset[];
  /** The fields the sentence names; see ConditionSentence. */
  conditionFields: ConfigField[];
  conditionValues: TriggerConfigValues;
  sentence: SentencePart[];
  loadedOptions: ReadonlyMap<string, LoadedFieldOptions>;
  openFieldId: string | null;
  isExpanded: boolean;
  expandedActionId: string | null;
  /** Where "Edit alert" goes for one of this trigger's actions. */
  alertEditorHref: (actionId: string) => string;
  onOpenFieldChange: (fieldId: string | null) => void;
  onToggleExpanded: () => void;
  onExpandAction: (actionId: string | null) => void;
  onChangeConditionValue: (fieldId: string, value: unknown) => void;
  onToggleEnabled: () => void;
  onChangeActionParameters: (actionId: string, parameters: TriggerConfigValues) => void;
  onToggleActionConcurrent: (actionId: string) => void;
  onRemoveAction: (actionId: string) => void;
  onAddAction: (preset: ActionPreset) => void;
  onRemove: () => void;
  /** Absent until the workflow has been saved once, since there is nothing to open. */
  onOpenInWorkflowEditor?: () => void;
  resolveActionPreset: (action: ProjectedAction) => ActionPreset | undefined;
}

/**
 * One trigger: a row reading as its condition sentence with an on/off switch, which
 * opens onto the numbered steps it runs. The row button is stretched over the whole
 * row so the row toggles anywhere, while the sentence's value buttons and the switch sit
 * above it and stay separately clickable — no button is nested in another.
 */
export function TriggerCard({
  trigger,
  triggerPreset,
  actionPresets,
  conditionFields,
  conditionValues,
  sentence,
  loadedOptions,
  openFieldId,
  isExpanded,
  expandedActionId,
  alertEditorHref,
  onOpenFieldChange,
  onToggleExpanded,
  onExpandAction,
  onChangeConditionValue,
  onToggleEnabled,
  onChangeActionParameters,
  onToggleActionConcurrent,
  onRemoveAction,
  onAddAction,
  onRemove,
  onOpenInWorkflowEditor,
  resolveActionPreset,
}: TriggerCardProps) {
  const isUnconditional = trigger.id === UNCONDITIONAL_TRIGGER_ID;
  const summary =
    trigger.actions.length === 0
      ? "No steps yet"
      : trigger.actions
          .map((action) => {
            const preset = resolveActionPreset(action);
            const detail = stepDetail(action, preset?.config?.fields ?? []);
            return detail ? `${actionName(action, preset)} · ${detail}` : actionName(action, preset);
          })
          .join("  →  ");

  return (
    <article
      className={cn("rounded-2xl border bg-card", isExpanded && "border-foreground/20")}
      data-testid={`trigger-card-${trigger.id}`}
    >
      <div className="relative flex items-center gap-2 py-2.5 pl-2 pr-2.5">
        <button
          type="button"
          onClick={onToggleExpanded}
          aria-expanded={isExpanded}
          aria-label={`${sentenceText(sentence)}. ${isExpanded ? "Collapse" : "Expand"}`}
          className="flex h-[52px] w-9 shrink-0 items-center justify-center rounded-[10px] after:absolute after:inset-0 after:rounded-2xl after:content-[''] hover:bg-accent"
        >
          <ChevronRight
            className={cn("h-4 w-4 transition-transform duration-150", isExpanded && "rotate-90")}
            aria-hidden="true"
          />
        </button>
        <div className="flex min-w-0 flex-1 flex-col gap-1 py-1.5">
          {isUnconditional ? (
            <span className="text-base font-medium">Every {triggerPreset.name.toLowerCase()}</span>
          ) : (
            <ConditionSentence
              parts={sentence}
              fields={conditionFields}
              values={conditionValues}
              loadedOptions={loadedOptions}
              openFieldId={openFieldId}
              onOpenFieldChange={onOpenFieldChange}
              onChangeValue={onChangeConditionValue}
            />
          )}
          <span className="flex min-w-0 items-center gap-2 text-[13px] text-muted-foreground">
            {!trigger.enabled && (
              <span className="shrink-0 rounded-full bg-muted px-2 py-px text-xs text-foreground/80">Paused</span>
            )}
            <span className="truncate">{summary}</span>
          </span>
        </div>
        {!isUnconditional && (
          <div className="relative z-10 flex h-11 w-14 shrink-0 items-center justify-center">
            <Switch
              checked={trigger.enabled}
              onCheckedChange={onToggleEnabled}
              aria-label="Trigger enabled"
              data-testid={`trigger-enabled-${trigger.id}`}
            />
          </div>
        )}
      </div>

      {isExpanded && (
        <>
          <div className="grid gap-x-5 gap-y-2 border-t px-4 py-6 sm:grid-cols-[64px_minmax(0,1fr)] sm:px-7">
            <h3 className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground sm:pt-3.5">Then</h3>
            <div className="flex flex-col gap-2">
              {trigger.actions.length === 0 && (
                <p className="pt-2.5 text-sm text-muted-foreground">Nothing happens yet. Pick a step below.</p>
              )}
              {trigger.actions.map((action, index) => (
                <ActionRow
                  key={action.id}
                  action={action}
                  preset={resolveActionPreset(action)}
                  stepNumber={index + 1}
                  availableVariables={projectedActionVariables(
                    triggerPreset,
                    trigger.actions,
                    index,
                    resolveActionPreset
                  )}
                  alertEditorHref={alertEditorHref(action.id)}
                  concurrentWithPrevious={action.concurrentWithPrevious}
                  isExpanded={expandedActionId === action.id}
                  onToggleExpanded={() => onExpandAction(expandedActionId === action.id ? null : action.id)}
                  onChangeParameters={(parameters) => onChangeActionParameters(action.id, parameters)}
                  onToggleConcurrent={() => onToggleActionConcurrent(action.id)}
                  onRemove={() => onRemoveAction(action.id)}
                />
              ))}
              <div className="mt-2 flex flex-col gap-2.5">
                <span className="text-[13px] text-muted-foreground">Add a step</span>
                <StepTiles actionPresets={actionPresets} onAdd={onAddAction} />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 border-t p-2 sm:flex sm:items-center sm:justify-between sm:py-2 sm:pl-5 sm:pr-3">
            <Button
              variant="ghost"
              className="h-11 text-[13px] text-muted-foreground sm:h-9 sm:px-0 sm:hover:bg-transparent sm:hover:text-foreground"
              onClick={onOpenInWorkflowEditor}
              disabled={!onOpenInWorkflowEditor}
              title={onOpenInWorkflowEditor ? undefined : "Save first: the workflow doesn't exist yet"}
            >
              <ExternalLink className="mr-2 h-3.5 w-3.5" aria-hidden="true" />
              <span className="sm:hidden">Workflow</span>
              <span className="hidden sm:inline">Open in workflow editor</span>
            </Button>
            <Button
              variant="ghost"
              className="h-11 text-[13px] text-red-600 hover:bg-destructive/10 hover:text-red-500 dark:text-red-300 dark:hover:text-red-200 sm:h-9"
              onClick={onRemove}
              data-testid={`delete-trigger-${trigger.id}`}
            >
              Delete trigger
            </Button>
          </div>
        </>
      )}
    </article>
  );
}
