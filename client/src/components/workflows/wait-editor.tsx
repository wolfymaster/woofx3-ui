import type { AggregationConfig } from "@woofx3/api";
import { useEffect, useId, useMemo, useState } from "react";
import { VariableAwareInput } from "@/components/common/variable-aware-input";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { CatalogTriggerRow } from "@/hooks/use-workflow-catalog";
import {
  DEFAULT_AGGREGATION,
  DEFAULT_ON_TIMEOUT,
  DELAY_BOUNDS,
  type DurationBounds,
  type DurationUnit,
  describeWaitTimeout,
  durationAmount,
  type EventWaitConfig,
  formatGoDuration,
  parseAggregationField,
  parseDurationInput,
  parseGoDuration,
  pickDurationUnit,
  setWaitTimeoutEnabled,
  switchWaitType,
  TIMEOUT_BOUNDS,
  type WaitConfig,
  type WaitType,
  waitConditionProblem,
} from "@/lib/wait-config";
import { type VariableOption, waitEventVariables } from "@/lib/workflow-variables";
import { ConditionEditor } from "./condition-editor";

interface WaitEditorProps {
  wait: WaitConfig;
  onChange: (wait: WaitConfig) => void;
  /** Suggested as events to wait for, and describe the fields those events carry. */
  catalogTriggers?: CatalogTriggerRow[];
}

export function WaitEditor({ wait, onChange, catalogTriggers = [] }: WaitEditorProps) {
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
        <div className="space-y-2">
          <Label htmlFor="wait-delay">Wait for</Label>
          <DurationInput
            id="wait-delay"
            valueMs={wait.durationMs}
            units={DELAY_UNITS}
            bounds={DELAY_BOUNDS}
            onChange={(durationMs) => onChange({ type: "delay", durationMs })}
            hint="Then the workflow continues. Events don't end the wait early."
          />
        </div>
      ) : (
        <EventWaitFields wait={wait} onChange={onChange} catalogTriggers={catalogTriggers} />
      )}
    </div>
  );
}

const DELAY_UNITS: readonly DurationUnit[] = ["seconds", "minutes"];
const TIMEOUT_UNITS: readonly DurationUnit[] = ["seconds", "minutes", "hours"];
const UNIT_LABELS: Record<DurationUnit, string> = { seconds: "Seconds", minutes: "Minutes", hours: "Hours" };

/**
 * An amount plus a unit picker. Keeps the typed text as a draft so an out-of-range or
 * half-typed entry can show its error without being saved; only a valid duration reaches
 * `onChange`. `valueMs` is null when the stored value is not a duration the editor can read.
 */
function DurationInput({
  id,
  valueMs,
  units,
  bounds,
  onChange,
  hint,
}: {
  id: string;
  valueMs: number | null;
  units: readonly DurationUnit[];
  bounds: DurationBounds;
  onChange: (durationMs: number) => void;
  hint?: string;
}) {
  const [unit, setUnit] = useState<DurationUnit>(() =>
    valueMs === null ? units[0] : pickDurationUnit(valueMs, units)
  );
  const [text, setText] = useState(() => (valueMs === null ? "" : String(durationAmount(valueMs, unit))));
  const parsed = parseDurationInput(text, unit, bounds);

  // biome-ignore lint/correctness/useExhaustiveDependencies: only an outside change of the stored duration resets the draft; typing must not
  useEffect(() => {
    if (valueMs === null) {
      return;
    }
    const current = parseDurationInput(text, unit, bounds);
    if (!current.ok || current.durationMs !== valueMs) {
      const nextUnit = pickDurationUnit(valueMs, units);
      setUnit(nextUnit);
      setText(String(durationAmount(valueMs, nextUnit)));
    }
  }, [valueMs]);

  const commit = (nextText: string, nextUnit: DurationUnit) => {
    setText(nextText);
    setUnit(nextUnit);
    const result = parseDurationInput(nextText, nextUnit, bounds);
    if (result.ok && result.durationMs !== valueMs) {
      onChange(result.durationMs);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input
          id={id}
          type="number"
          inputMode="decimal"
          min={0}
          step="any"
          value={text}
          onChange={(e) => commit(e.target.value, unit)}
          aria-invalid={!parsed.ok}
          className="flex-1"
          data-testid={`input-${id}`}
        />
        <Select value={unit} onValueChange={(value) => commit(text, value as DurationUnit)}>
          <SelectTrigger className="w-32" data-testid={`select-${id}-unit`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {units.map((u) => (
              <SelectItem key={u} value={u}>
                {UNIT_LABELS[u]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {parsed.ok ? (
        hint && <p className="text-xs text-muted-foreground">{hint}</p>
      ) : (
        <p className="text-xs text-destructive" data-testid={`text-${id}-error`}>
          {parsed.message}
        </p>
      )}
    </div>
  );
}

/** Each event a catalog trigger listens for, once, as a suggestion for the wait's event. */
function catalogEventSuggestions(catalogTriggers: CatalogTriggerRow[]): { event: string; name: string }[] {
  const byEvent = new Map<string, string>();
  for (const row of catalogTriggers) {
    if (row.event && !byEvent.has(row.event)) {
      byEvent.set(row.event, row.name);
    }
  }
  return Array.from(byEvent, ([event, name]) => ({ event, name }));
}

function EventWaitFields({
  wait,
  onChange,
  catalogTriggers,
}: {
  wait: EventWaitConfig;
  onChange: (wait: WaitConfig) => void;
  catalogTriggers: CatalogTriggerRow[];
}) {
  const isAggregation = wait.type === "aggregation";
  const strategy = wait.aggregation?.strategy ?? DEFAULT_AGGREGATION.strategy;
  const eventListId = useId();
  const eventSuggestions = useMemo(() => catalogEventSuggestions(catalogTriggers), [catalogTriggers]);
  const eventVariables = useMemo(() => waitEventVariables(wait.event, catalogTriggers), [wait.event, catalogTriggers]);

  return (
    <>
      <div className="space-y-2">
        <Label htmlFor="wait-event">Event</Label>
        <Input
          id="wait-event"
          list={eventListId}
          value={wait.event}
          onChange={(e) => onChange({ ...wait, event: e.target.value })}
          placeholder="chat.command.hug"
          className="font-mono text-xs"
          data-testid="input-wait-event"
        />
        <datalist id={eventListId}>
          {eventSuggestions.map(({ event, name }) => (
            <option key={event} value={event}>
              {name}
            </option>
          ))}
        </datalist>
        <p className="text-xs text-muted-foreground">
          {isAggregation ? "Event stream to aggregate over." : "NATS event subject to wait for."}
        </p>
      </div>

      {isAggregation && (
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label>Strategy</Label>
            <Select
              value={strategy}
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
          {strategy !== "count" && (
            <AggregationFieldInput
              label={strategy === "sum" ? "Field to sum" : "Field to compare"}
              field={wait.aggregation?.field}
              numericFields={eventVariables.filter((v) => v.type === "number")}
              onChange={(field) => {
                const { field: _previous, ...aggregation } = wait.aggregation ?? DEFAULT_AGGREGATION;
                onChange({ ...wait, aggregation: field === undefined ? aggregation : { ...aggregation, field } });
              }}
            />
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

      <TimeoutFields wait={wait} onChange={onChange} />

      <div className="space-y-2">
        <Label>Match conditions (optional)</Label>
        <p className="text-xs text-muted-foreground">
          Only resume when the event's payload also matches these. They check the event this step waits for, not the
          trigger or earlier steps.
        </p>
        <ConditionEditor
          conditions={wait.conditions ?? []}
          onChange={(conditions) => onChange({ ...wait, conditions: conditions.length > 0 ? conditions : undefined })}
          addLabel="Add match condition"
          availableVariables={eventVariables}
          rowProblem={waitConditionProblem}
        />
      </div>
    </>
  );
}

/**
 * The path an aggregation reads its number from. Keeps the typed text as a draft so a
 * path the engine could not follow shows its error without being saved, as DurationInput
 * does. A field picked from the variable menu arrives as a reference and is shown as the
 * plain path it is saved as.
 */
function AggregationFieldInput({
  label,
  field,
  numericFields,
  onChange,
}: {
  label: string;
  field: string | undefined;
  numericFields: VariableOption[];
  onChange: (field: string | undefined) => void;
}) {
  const [text, setText] = useState(field ?? "");
  const parsed = parseAggregationField(text);

  const commit = (nextText: string) => {
    const result = parseAggregationField(nextText);
    setText(result.ok && result.field !== undefined ? result.field : nextText);
    if (result.ok && result.field !== field) {
      onChange(result.field);
    }
  };

  return (
    <div className="space-y-2 col-span-2">
      <Label htmlFor="wait-aggregation-field">{label}</Label>
      <VariableAwareInput
        id="wait-aggregation-field"
        value={text}
        onChange={commit}
        placeholder="data.amount"
        className="font-mono text-xs"
        availableVariables={numericFields}
        data-testid="input-wait-aggregation-field"
      />
      {parsed.ok ? (
        <p className="text-xs text-muted-foreground">
          A path into the event, like data.amount. Left empty, the event's amount or value is used.
        </p>
      ) : (
        <p className="text-xs text-destructive" data-testid="text-wait-aggregation-field-error">
          {parsed.message}
        </p>
      )}
    </div>
  );
}

function TimeoutFields({ wait, onChange }: { wait: EventWaitConfig; onChange: (wait: WaitConfig) => void }) {
  const hasTimeout = Boolean(wait.timeout);

  return (
    <div className="space-y-2">
      <Label>Timeout</Label>
      <Select
        value={hasTimeout ? "after" : "none"}
        onValueChange={(value) => onChange(setWaitTimeoutEnabled(wait, value === "after"))}
      >
        <SelectTrigger data-testid="select-wait-timeout-mode">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">No timeout</SelectItem>
          <SelectItem value="after">Give up after a set time</SelectItem>
        </SelectContent>
      </Select>
      {hasTimeout && (
        <div className="grid grid-cols-2 gap-3">
          <DurationInput
            id="wait-timeout"
            valueMs={parseGoDuration(String(wait.timeout))}
            units={TIMEOUT_UNITS}
            bounds={TIMEOUT_BOUNDS}
            onChange={(durationMs) => onChange({ ...wait, timeout: formatGoDuration(durationMs) })}
          />
          <Select
            value={wait.onTimeout ?? DEFAULT_ON_TIMEOUT}
            onValueChange={(value) => onChange({ ...wait, onTimeout: value as EventWaitConfig["onTimeout"] })}
          >
            <SelectTrigger aria-label="On timeout" data-testid="select-wait-on-timeout">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="fail">Then fail the workflow</SelectItem>
              <SelectItem value="continue">Then continue anyway</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}
      <p className="text-xs text-muted-foreground" data-testid="text-wait-timeout-summary">
        {describeWaitTimeout(wait)}.
      </p>
    </div>
  );
}
