import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  type DurationBounds,
  type DurationUnit,
  durationAmount,
  parseDurationInput,
  pickDurationUnit,
} from "@/lib/wait-config";

const UNIT_LABELS: Record<DurationUnit, string> = { seconds: "Seconds", minutes: "Minutes", hours: "Hours" };

/**
 * An amount plus a unit picker. Keeps the typed text as a draft so an out-of-range or
 * half-typed entry can show its error without being saved; only a valid duration reaches
 * `onChange`. `valueMs` is null when the stored value is not a duration the editor can read.
 */
export function DurationInput({
  id,
  valueMs,
  units,
  bounds,
  onChange,
  hint,
  label,
  compact = false,
}: {
  id: string;
  valueMs: number | null;
  units: readonly DurationUnit[];
  bounds: DurationBounds;
  onChange: (durationMs: number) => void;
  hint?: string;
  /** Names the amount for a screen reader when no visible label points at `id`. */
  label?: string;
  /** Sized to sit inside a sentence rather than fill its column. */
  compact?: boolean;
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
    <div className={compact ? "inline-flex flex-col gap-1 align-middle" : "space-y-2"}>
      <div className={compact ? "inline-flex gap-1.5" : "flex gap-2"}>
        <Input
          id={id}
          type="number"
          inputMode="decimal"
          min={0}
          step="any"
          value={text}
          onChange={(e) => commit(e.target.value, unit)}
          aria-invalid={!parsed.ok}
          aria-label={label}
          className={compact ? "h-9 w-20" : "flex-1"}
          data-testid={`input-${id}`}
        />
        <Select value={unit} onValueChange={(value) => commit(text, value as DurationUnit)}>
          <SelectTrigger
            className={compact ? "h-9 w-28" : "w-32"}
            aria-label={label ? `${label}, unit` : undefined}
            data-testid={`select-${id}-unit`}
          >
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
