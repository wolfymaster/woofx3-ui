import type { ConfigField } from "@woofx3/api/ui-schema";
import { ArrowDown, ArrowRight, ArrowUp, Bell, type LucideIcon, Trash2 } from "lucide-react";
import { Link } from "wouter";
import { AlertLayoutPreview } from "@/components/alerts/alert-layout-preview";
import type { CustomFieldRenderer } from "@/components/common/configuration-form";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { TriggerConfigForm } from "@/components/workflows/trigger-config-form";
import { readAlertLayout } from "@/lib/alert-layout";
import { cn } from "@/lib/utils";
import type { ActionPreset, TriggerConfigValues } from "@/lib/workflow-presets";
import type { VariableOption } from "@/lib/workflow-variables";

/**
 * What a row needs to draw one step, common to a trigger's actions (ProjectedAction) and
 * a chat command's (ActionStep). The two surfaces store their steps differently — only
 * this much is shared, and the row is written against it so both get the same UI.
 */
export interface ActionRowStep {
  id: string;
  /** `action` on the task — the handler type, e.g. `function`. */
  handlerType: string;
  /** Specific registered call for `function` handlers. */
  functionCall?: string;
  parameters: TriggerConfigValues;
}

interface ActionRowProps {
  action: ActionRowStep;
  preset?: ActionPreset;
  /** 1-based position in its trigger, shown on the step. */
  stepNumber: number;
  /** What this action's settings may reference — see projectedActionVariables. */
  availableVariables: VariableOption[];
  /**
   * Where "Edit alert" goes for an action with an alert layout. Omitted on a surface with
   * no alert editor route of its own, and the layout field then offers its own editor.
   */
  alertEditorHref?: string;
  /** Whether this step starts with the one above it, where the surface can run steps at once. */
  concurrentWithPrevious?: boolean;
  isExpanded: boolean;
  onToggleExpanded: () => void;
  onChangeParameters: (parameters: TriggerConfigValues) => void;
  /** Omitted where steps always run in order; the concurrency switch is then not offered. */
  onToggleConcurrent?: () => void;
  /** Omitted where the order is not the user's to change; the move buttons are then not offered. */
  onMove?: (delta: -1 | 1) => void;
  /** Whether a step follows this one, so the last step's Move down is not offered as live. */
  canMoveDown?: boolean;
  onRemove: () => void;
}

/** One numbered step of a trigger: a header that opens its settings, and a remove button. */
export function ActionRow({
  action,
  preset,
  stepNumber,
  availableVariables,
  alertEditorHref,
  concurrentWithPrevious,
  isExpanded,
  onToggleExpanded,
  onChangeParameters,
  onToggleConcurrent,
  onMove,
  canMoveDown = false,
  onRemove,
}: ActionRowProps) {
  const fields = preset?.config?.fields ?? [];
  const isFirst = stepNumber === 1;
  const Icon = stepIcon(action, preset);
  const concurrentId = `step-concurrent-${action.id}`;

  return (
    <div className={cn("rounded-[10px] border", isExpanded ? "bg-muted/50" : "bg-muted/30")}>
      <div className="flex items-center gap-1 p-1">
        <button
          type="button"
          onClick={onToggleExpanded}
          aria-expanded={isExpanded}
          className="flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-lg px-2.5 py-1 text-left hover:bg-accent"
          data-testid={`action-row-${action.id}`}
        >
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-muted font-mono text-xs text-muted-foreground">
            {stepNumber}
          </span>
          <Icon className="h-4 w-4 shrink-0 text-primary-text" aria-hidden="true" />
          <span className="shrink-0 text-sm font-medium">{actionName(action, preset)}</span>
          {!isExpanded && (
            <span className="truncate text-[13px] text-muted-foreground">{stepDetail(action, fields)}</span>
          )}
        </button>
        {onMove && (
          <>
            <Button
              variant="ghost"
              size="icon"
              className="h-10 w-10 shrink-0 text-muted-foreground"
              onClick={() => onMove(-1)}
              disabled={isFirst}
              aria-label="Move step up"
            >
              <ArrowUp className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-10 w-10 shrink-0 text-muted-foreground"
              onClick={() => onMove(1)}
              disabled={!canMoveDown}
              aria-label="Move step down"
            >
              <ArrowDown className="h-4 w-4" />
            </Button>
          </>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="h-10 w-10 shrink-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          onClick={onRemove}
          aria-label="Remove step"
          data-testid={`remove-step-${action.id}`}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      {isExpanded && (
        <div className="space-y-4 px-4 pb-4 pt-1.5 sm:pl-[50px]">
          {onToggleConcurrent && !isFirst && (
            <div className="flex items-center gap-3">
              <Switch id={concurrentId} checked={!!concurrentWithPrevious} onCheckedChange={onToggleConcurrent} />
              <Label htmlFor={concurrentId} className="text-[13px] font-normal text-muted-foreground">
                Start at the same time as step {stepNumber - 1}
              </Label>
            </div>
          )}
          {!preset ? (
            <p className="text-xs text-muted-foreground">
              This action isn't in the catalog — its settings are kept as they are. Reinstall the module that provides
              it, or edit the workflow in the builder.
            </p>
          ) : fields.length === 0 ? (
            <p className="text-xs text-muted-foreground">This step has no settings.</p>
          ) : (
            <TriggerConfigForm
              fields={fields}
              values={action.parameters}
              onChange={onChangeParameters}
              availableVariables={availableVariables}
              rendererOverrides={
                alertEditorHref ? { "field:layout": alertContentRenderer(alertEditorHref) } : undefined
              }
            />
          )}
        </div>
      )}
    </div>
  );
}

export function actionName(
  action: Pick<ActionRowStep, "handlerType" | "functionCall">,
  preset: ActionPreset | undefined
): string {
  return preset?.name ?? action.functionCall ?? action.handlerType;
}

/** What a collapsed step says about itself: its first filled-in setting. */
export function stepDetail(action: Pick<ActionRowStep, "parameters">, fields: ConfigField[]): string {
  for (const field of fields) {
    const value = action.parameters[field.id];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
    if (typeof value === "number") {
      return `${field.label}: ${value}`;
    }
  }
  return "";
}

/**
 * The engine's own Alert handler gets its bell. Every other action shows the icon its
 * catalog entry carries, which is the same default arrow for all of them until modules
 * can declare one.
 */
export function stepIcon(action: Pick<ActionRowStep, "handlerType">, preset: ActionPreset | undefined): LucideIcon {
  if (action.handlerType === "alert") {
    return Bell;
  }
  return preset?.icon ?? ArrowRight;
}

function alertContentRenderer(href: string): CustomFieldRenderer {
  return ({ value }) => <AlertContentCard layout={value} href={href} />;
}

function AlertContentCard({ layout, href }: { layout: unknown; href: string }) {
  return (
    <div className="flex flex-col gap-4 rounded-[10px] border bg-background/60 p-2.5 sm:flex-row sm:items-center">
      <AlertLayoutPreview
        layout={readAlertLayout(layout, (widgetCanonicalId) => widgetCanonicalId)}
        className="h-[132px] shrink-0 sm:h-[63px] sm:w-[112px]"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-sm font-medium">Alert content</span>
        <span className="text-xs text-muted-foreground">
          Scaled to fit the widget. Plays as long as its longest layer.
        </span>
      </div>
      <Button asChild variant="outline" className="h-11 w-full shrink-0 sm:h-9 sm:w-auto">
        <Link href={href} data-testid="link-edit-alert">
          Edit alert
        </Link>
      </Button>
    </div>
  );
}
