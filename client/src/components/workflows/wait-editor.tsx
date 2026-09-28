import type { AggregationConfig } from "@woofx3/api";
import { useEffect, useState } from "react";
import { VariableAwareInput } from "@/components/common/variable-aware-input";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DEFAULT_AGGREGATION,
  DEFAULT_ON_TIMEOUT,
  DEFAULT_WAIT_TIMEOUT,
  type DelayUnit,
  type DelayWaitConfig,
  delayAmount,
  describeWaitTimeout,
  type EventWaitConfig,
  parseDelayInput,
  pickDelayUnit,
  switchWaitType,
  type WaitConfig,
  type WaitType,
} from "@/lib/wait-config";
import type { VariableOption } from "@/lib/workflow-variables";
import { ConditionEditor } from "./condition-editor";

interface WaitEditorProps {
  wait: WaitConfig;
  onChange: (wait: WaitConfig) => void;
  /** Offered when the user types "{" in the event, sum-field, or match-condition inputs. */
  availableVariables?: VariableOption[];
}

export function WaitEditor({ wait, onChange, availableVariables = [] }: WaitEditorProps) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Wait type</Label>
        <Select value={wait.type} onValueChange={(value) => onChange(switchWaitType(wait, value as WaitType))}>
          <SelectTrigger data-testid="select-wait-type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="event">Until an event fires</SelectItem>
            <SelectItem value="aggregation">Until an aggregation threshold is met</SelectItem>
            <SelectItem value="delay">For a set time</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {wait.type === "delay" ? (
        <DelayDurationInput wait={wait} onChange={onChange} />
      ) : (
        <EventWaitFields wait={wait} onChange={onChange} availableVariables={availableVariables} />
      )}
    </div>
  );
}

/**
 * Keeps the typed text as a draft so an out-of-range or half-typed entry can show its error
 * without being saved; only a valid duration reaches `onChange`.
 */
function DelayDurationInput({ wait, onChange }: { wait: DelayWaitConfig; onChange: (wait: WaitConfig) => void }) {
  const [unit, setUnit] = useState<DelayUnit>(() => pickDelayUnit(wait.durationMs));
  const [text, setText] = useState(() => String(delayAmount(wait.durationMs, unit)));
  const parsed = parseDelayInput(text, unit);

  // biome-ignore lint/correctness/useExhaustiveDependencies: only an outside change of the stored duration resets the draft; typing must not
  useEffect(() => {
    const current = parseDelayInput(text, unit);
    if (!current.ok || current.durationMs !== wait.durationMs) {
      const nextUnit = pickDelayUnit(wait.durationMs);
      setUnit(nextUnit);
      setText(String(delayAmount(wait.durationMs, nextUnit)));
    }
  }, [wait.durationMs]);

  const commit = (nextText: string, nextUnit: DelayUnit) => {
    setText(nextText);
    setUnit(nextUnit);
    const result = parseDelayInput(nextText, nextUnit);
    if (result.ok && result.durationMs !== wait.durationMs) {
      onChange({ type: "delay", durationMs: result.durationMs });
    }
  };

  return (
    <div className="space-y-2">
      <Label htmlFor="wait-delay-amount">Wait for</Label>
      <div className="flex gap-2">
        <Input
          id="wait-delay-amount"
          type="number"
          inputMode="decimal"
          min={0}
          step="any"
          value={text}
          onChange={(e) => commit(e.target.value, unit)}
          aria-invalid={!parsed.ok}
          className="flex-1"
          data-testid="input-wait-delay-amount"
        />
        <Select value={unit} onValueChange={(value) => commit(text, value as DelayUnit)}>
          <SelectTrigger className="w-32" data-testid="select-wait-delay-unit">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="seconds">Seconds</SelectItem>
            <SelectItem value="minutes">Minutes</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {parsed.ok ? (
        <p className="text-xs text-muted-foreground">Then the workflow continues. Events don't end the wait early.</p>
      ) : (
        <p className="text-xs text-destructive" data-testid="text-wait-delay-error">
          {parsed.message}
        </p>
      )}
    </div>
  );
}

function EventWaitFields({
  wait,
  onChange,
  availableVariables,
}: {
  wait: EventWaitConfig;
  onChange: (wait: WaitConfig) => void;
  availableVariables: VariableOption[];
}) {
  const isAggregation = wait.type === "aggregation";

  return (
    <>
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
            placeholder={DEFAULT_WAIT_TIMEOUT}
            data-testid="input-wait-timeout"
          />
        </div>
        <div className="space-y-2">
          <Label>On timeout</Label>
          <Select
            value={wait.onTimeout ?? DEFAULT_ON_TIMEOUT}
            onValueChange={(value) => onChange({ ...wait, onTimeout: value as EventWaitConfig["onTimeout"] })}
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
        <p className="col-span-2 text-xs text-muted-foreground" data-testid="text-wait-timeout-summary">
          {describeWaitTimeout(wait)}.
        </p>
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
    </>
  );
}
