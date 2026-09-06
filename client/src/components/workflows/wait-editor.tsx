import type { AggregationConfig, WaitConfig } from "@woofx3/api";
import { VariableAwareInput } from "@/components/common/variable-aware-input";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { VariableOption } from "@/lib/workflow-variables";
import { ConditionEditor } from "./condition-editor";

const DEFAULT_AGGREGATION: AggregationConfig = { strategy: "count", threshold: 1 };

interface WaitEditorProps {
  wait: WaitConfig;
  onChange: (wait: WaitConfig) => void;
  /** Offered when the user types "${" in the event, sum-field, or match-condition inputs. */
  availableVariables?: VariableOption[];
}

export function WaitEditor({ wait, onChange, availableVariables = [] }: WaitEditorProps) {
  const isAggregation = wait.type === "aggregation";

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Wait type</Label>
        <Select
          value={wait.type}
          onValueChange={(value) =>
            onChange({
              ...wait,
              type: value as WaitConfig["type"],
              aggregation: value === "aggregation" ? (wait.aggregation ?? DEFAULT_AGGREGATION) : wait.aggregation,
            })
          }
        >
          <SelectTrigger data-testid="select-wait-type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="event">Until an event fires</SelectItem>
            <SelectItem value="aggregation">Until an aggregation threshold is met</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="wait-event">Event</Label>
        <VariableAwareInput
          id="wait-event"
          value={wait.event}
          onChange={(event) => onChange({ ...wait, event })}
          placeholder="chat.command.hug"
          className="font-mono text-xs"
          availableVariables={availableVariables}
          data-testid="input-wait-event"
        />
        <p className="text-xs text-muted-foreground">
          {isAggregation ? "Event stream to aggregate over." : "NATS event subject to wait for."}
        </p>
      </div>

      {isAggregation && (
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label>Strategy</Label>
            <Select
              value={wait.aggregation?.strategy ?? "count"}
              onValueChange={(value) =>
                onChange({
                  ...wait,
                  aggregation: {
                    ...(wait.aggregation ?? DEFAULT_AGGREGATION),
                    strategy: value as AggregationConfig["strategy"],
                  },
                })
              }
            >
              <SelectTrigger data-testid="select-wait-aggregation-strategy">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="count">Count</SelectItem>
                <SelectItem value="sum">Sum</SelectItem>
                <SelectItem value="threshold">Threshold</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="wait-threshold">Threshold</Label>
            <Input
              id="wait-threshold"
              type="number"
              value={wait.aggregation?.threshold ?? 1}
              onChange={(e) =>
                onChange({
                  ...wait,
                  aggregation: {
                    ...(wait.aggregation ?? DEFAULT_AGGREGATION),
                    threshold: Number(e.target.value) || 0,
                  },
                })
              }
              data-testid="input-wait-threshold"
            />
          </div>
          {wait.aggregation?.strategy === "sum" && (
            <div className="space-y-2 col-span-2">
              <Label htmlFor="wait-aggregation-field">Field to sum</Label>
              <VariableAwareInput
                id="wait-aggregation-field"
                value={wait.aggregation?.field ?? ""}
                onChange={(field) =>
                  onChange({
                    ...wait,
                    aggregation: { ...(wait.aggregation ?? DEFAULT_AGGREGATION), field },
                  })
                }
                placeholder="${trigger.data.amount}"
                className="font-mono text-xs"
                availableVariables={availableVariables}
                data-testid="input-wait-aggregation-field"
              />
            </div>
          )}
          <div className="space-y-2 col-span-2">
            <Label htmlFor="wait-aggregation-window">Time window</Label>
            <Input
              id="wait-aggregation-window"
              value={String(wait.aggregation?.timeWindow ?? "")}
              onChange={(e) =>
                onChange({
                  ...wait,
                  aggregation: { ...(wait.aggregation ?? DEFAULT_AGGREGATION), timeWindow: e.target.value },
                })
              }
              placeholder="5m"
              data-testid="input-wait-aggregation-window"
            />
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="wait-timeout">Timeout</Label>
          <Input
            id="wait-timeout"
            value={String(wait.timeout ?? "")}
            onChange={(e) => onChange({ ...wait, timeout: e.target.value || undefined })}
            placeholder="30s"
            data-testid="input-wait-timeout"
          />
        </div>
        <div className="space-y-2">
          <Label>On timeout</Label>
          <Select
            value={wait.onTimeout ?? "fail"}
            onValueChange={(value) => onChange({ ...wait, onTimeout: value as WaitConfig["onTimeout"] })}
          >
            <SelectTrigger data-testid="select-wait-on-timeout">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="fail">Fail workflow</SelectItem>
              <SelectItem value="continue">Continue anyway</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-2">
        <Label>Match conditions (optional)</Label>
        <p className="text-xs text-muted-foreground">Only resume when the event's payload also matches these.</p>
        <ConditionEditor
          conditions={wait.conditions ?? []}
          onChange={(conditions) => onChange({ ...wait, conditions: conditions.length > 0 ? conditions : undefined })}
          addLabel="Add match condition"
          availableVariables={availableVariables}
        />
      </div>
    </div>
  );
}
