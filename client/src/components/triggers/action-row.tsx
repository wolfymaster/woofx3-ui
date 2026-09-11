import type { ConfigField } from "@woofx3/api/ui-schema";
import { ArrowDown, ChevronDown, ChevronRight, GitMerge, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { TriggerConfigForm } from "@/components/workflows/trigger-config-form";
import type { ProjectedAction } from "@/lib/trigger-projection";
import { cn } from "@/lib/utils";
import type { ActionPreset, TriggerConfigValues } from "@/lib/workflow-presets";

interface ActionRowProps {
  action: ProjectedAction;
  preset?: ActionPreset;
  /** Position in its trigger; the first action has nothing to run alongside. */
  isFirst: boolean;
  isExpanded: boolean;
  onToggleExpanded: () => void;
  onChangeParameters: (parameters: TriggerConfigValues) => void;
  onToggleConcurrent: () => void;
  onRemove: () => void;
}

export function ActionRow({
  action,
  preset,
  isFirst,
  isExpanded,
  onToggleExpanded,
  onChangeParameters,
  onToggleConcurrent,
  onRemove,
}: ActionRowProps) {
  const fields = preset?.config?.fields ?? [];
  const concurrent = !isFirst && action.concurrentWithPrevious;

  return (
    <div className="rounded-md border bg-background">
      <div className="flex items-center gap-2 px-2 py-2">
        <button
          type="button"
          onClick={onToggleExpanded}
          className="flex items-center gap-2 flex-1 min-w-0 text-left cursor-pointer"
          data-testid={`action-row-${action.id}`}
        >
          {isExpanded ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          )}
          <span className="min-w-0">
            <span className="block text-sm font-medium truncate">
              {preset?.name ?? action.functionCall ?? action.handlerType}
            </span>
            <span className="block text-xs text-muted-foreground truncate">{summarize(action, fields)}</span>
          </span>
        </button>

        {!isFirst && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={cn("h-8 w-8 shrink-0", concurrent && "text-primary")}
                onClick={onToggleConcurrent}
                data-testid={`action-concurrent-${action.id}`}
              >
                {concurrent ? <GitMerge className="h-4 w-4" /> : <ArrowDown className="h-4 w-4" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="left" className="max-w-xs">
              {concurrent
                ? "Starts with the action above. The engine still runs one action at a time today."
                : "Runs after the action above."}
            </TooltipContent>
          </Tooltip>
        )}

        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0 text-destructive hover:text-destructive"
          onClick={onRemove}
          title="Remove action"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      {isExpanded && (
        <div className="border-t px-3 py-3">
          {!preset ? (
            <p className="text-xs text-muted-foreground">
              This action isn't in the catalog — its settings are kept as they are. Reinstall the module that provides
              it, or edit the workflow in the builder.
            </p>
          ) : fields.length === 0 ? (
            <p className="text-xs text-muted-foreground">This action has no settings.</p>
          ) : (
            <TriggerConfigForm fields={fields} values={action.parameters} onChange={onChangeParameters} />
          )}
        </div>
      )}
    </div>
  );
}

/** First filled-in parameter, so a collapsed row still says what it will do. */
function summarize(action: ProjectedAction, fields: ConfigField[]): string {
  for (const field of fields) {
    const value = action.parameters[field.id];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
    if (typeof value === "number") {
      return `${field.label}: ${value}`;
    }
  }
  return action.functionCall ?? action.handlerType;
}
