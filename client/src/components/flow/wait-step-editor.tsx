import type { ConditionConfig } from "@woofx3/api";
import type { ConfigField, DataShapeField } from "@woofx3/api/ui-schema";
import { ChevronDown, ChevronLeft, Plus, X } from "lucide-react";
import { type ReactNode, useCallback, useId, useMemo, useState } from "react";
import { DurationInput } from "@/components/flow/duration-input";
import { ConditionValueEditor, type LoadedFieldOptions } from "@/components/triggers/condition-sentence";
import { FieldOptionsLoader } from "@/components/triggers/field-options-loader";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useEngineScope } from "@/engine/context";
import { useResourceInstances } from "@/engine/hooks/use-module-resources";
import type { CatalogTriggerRow } from "@/hooks/use-workflow-catalog";
import { type OptionLabels, type SentencePart, sentenceParts } from "@/lib/condition-sentence";
import { isInternalSource } from "@/lib/parse-config-fields";
import { cn } from "@/lib/utils";
import {
  DEFAULT_ON_TIMEOUT,
  DELAY_BOUNDS,
  type DurationUnit,
  type EventWaitConfig,
  formatGoDuration,
  parseGoDuration,
  setWaitTimeoutEnabled,
  switchWaitType,
  TIMEOUT_BOUNDS,
  type WaitConfig,
} from "@/lib/wait-config";
import {
  aggregationFieldFor,
  checkOperators,
  checkTakesValue,
  joinWaitConditions,
  newWaitCheck,
  numericPayloadFields,
  payloadFieldLabel,
  type ResolvedWaitEvent,
  readWaitCheck,
  resolveWaitEvent,
  resourceFieldLabels,
  searchWaitEvents,
  sentenceAfterWaitUntil,
  setWaitHowMany,
  splitWaitConditions,
  thresholdProblem,
  type WaitEventChoice,
  type WaitEventGroup,
  type WaitHowMany,
  waitCheckText,
  waitEventGroups,
  waitEventName,
  waitHowMany,
  writeWaitCheck,
} from "@/lib/wait-event";
import type { TriggerConfigValues } from "@/lib/workflow-presets";
import { incompleteConditionFields } from "@/lib/workflow-presets-json";
import type { WaitNode } from "@/lib/workflow-tree";
import { waitExportVariables } from "@/lib/workflow-variables";

export interface WaitStepEditorProps {
  step: WaitNode;
  catalogTriggers: CatalogTriggerRow[];
  onChange: (wait: WaitConfig) => void;
}

const PAUSE_UNITS: readonly DurationUnit[] = ["seconds", "minutes", "hours"];
const LIMIT_UNITS: readonly DurationUnit[] = ["seconds", "minutes", "hours"];
const DEFAULT_WINDOW = "5m";

/** The window's shortest length; the engine takes any, but under a second nothing could arrive in it. */
const WINDOW_BOUNDS = { minMs: 1000, minMessage: "Must be at least 1 second." };

/**
 * A wait step's settings, inside its row: either a pause for a set time, or a wait for
 * an event from the trigger catalog, read as a sentence the streamer fills in.
 */
export function WaitStepEditor({ step, catalogTriggers, onChange }: WaitStepEditorProps) {
  const wait = step.wait;
  const isPause = wait.type === "delay";
  return (
    <div className="flex flex-col gap-5" data-testid="wait-step-editor">
      <fieldset className="inline-flex w-fit rounded-lg bg-muted p-1">
        <legend className="sr-only">Kind of wait</legend>
        <ModeButton pressed={!isPause} onClick={() => onChange(switchWaitType(wait, "event"))} testId="event">
          Wait for something to happen
        </ModeButton>
        <ModeButton pressed={isPause} onClick={() => onChange(switchWaitType(wait, "delay"))} testId="pause">
          Pause for a set time
        </ModeButton>
      </fieldset>
      {wait.type === "delay" ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span>Pause for</span>
          <DurationInput
            id={`wait-pause-${step.id}`}
            valueMs={wait.durationMs}
            units={PAUSE_UNITS}
            bounds={DELAY_BOUNDS}
            onChange={(durationMs) => onChange({ type: "delay", durationMs })}
            label="Pause length"
            compact
          />
          <p className="w-full text-xs text-muted-foreground">
            Then the next step runs. A pause can be up to 24 hours.
          </p>
        </div>
      ) : (
        <EventWaitEditor step={step} wait={wait} catalogTriggers={catalogTriggers} onChange={onChange} />
      )}
    </div>
  );
}

function ModeButton({
  pressed,
  onClick,
  testId,
  children,
}: {
  pressed: boolean;
  onClick: () => void;
  testId: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        "min-h-8 rounded-md px-3 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        pressed ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
      )}
      data-testid={`button-wait-mode-${testId}`}
    >
      {children}
    </button>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5">
      <h4 className="text-[13px] font-semibold text-muted-foreground">{title}</h4>
      {children}
    </section>
  );
}

function EventWaitEditor({
  step,
  wait,
  catalogTriggers,
  onChange,
}: {
  step: WaitNode;
  wait: EventWaitConfig;
  catalogTriggers: CatalogTriggerRow[];
  onChange: (wait: WaitConfig) => void;
}) {
  const groups = useMemo(() => waitEventGroups(catalogTriggers), [catalogTriggers]);
  const resolved = useMemo(() => resolveWaitEvent(wait.event, catalogTriggers), [wait.event, catalogTriggers]);
  const [browsing, setBrowsing] = useState(wait.event.trim() === "");

  const pickEvent = (choice: WaitEventChoice) => {
    // Settings and checks read the old event's fields, so they go, and so does the field
    // a total read; a total or "one big enough" stays only if the new event has a number.
    const { conditions: _conditions, aggregation, ...rest } = wait;
    const numeric = numericPayloadFields(choice.emits);
    const how = waitHowMany(wait);
    const base: EventWaitConfig = { ...rest, event: waitEventName(choice, "") };
    if (aggregation) {
      const { field: _field, ...kept } = aggregation;
      base.aggregation = kept;
    }
    const keepsHow = how === "first" || how === "count" || numeric.length > 0;
    onChange(setWaitHowMany(base, keepsHow ? how : "first", numeric));
    setBrowsing(false);
  };

  return (
    <>
      <Section title="What to wait for">
        <EventChoiceButton
          wait={wait}
          resolved={resolved}
          groups={groups}
          browsing={browsing}
          onToggle={() => setBrowsing(!browsing)}
        />
        {browsing && <EventCatalog groups={groups} onPick={pickEvent} onClose={() => setBrowsing(false)} />}
        {!browsing && resolved && (
          <EventSettings
            key={resolved.choice.row.id}
            stepId={step.id}
            wait={wait}
            resolved={resolved}
            onChange={(conditions) => onChange({ ...wait, conditions })}
            onEventChange={(event) => onChange({ ...wait, event })}
          />
        )}
        {!browsing && !resolved && wait.event.trim() !== "" && (
          <p className="text-xs text-muted-foreground">
            None of your installed modules describe <code>{wait.event}</code>, so its details can't be picked here. The
            wait still listens for it.
          </p>
        )}
      </Section>

      {!browsing && wait.event.trim() !== "" && (
        <>
          <ChecksEditor
            wait={wait}
            resolved={resolved}
            onChange={(checks) => {
              const fields = resolved?.choice.fields ?? [];
              const { values } = splitWaitConditions(fields, wait.conditions ?? []);
              onChange({ ...wait, conditions: joinWaitConditions(fields, values, checks) });
            }}
          />
          <HowManyEditor stepId={step.id} wait={wait} emits={resolved?.choice.emits ?? []} onChange={onChange} />
          <TimeLimitEditor stepId={step.id} wait={wait} onChange={onChange} />
          <OutputsNote step={step} catalogTriggers={catalogTriggers} />
        </>
      )}
    </>
  );
}

function EventChoiceButton({
  wait,
  resolved,
  groups,
  browsing,
  onToggle,
}: {
  wait: EventWaitConfig;
  resolved: ResolvedWaitEvent | null;
  groups: readonly WaitEventGroup[];
  browsing: boolean;
  onToggle: () => void;
}) {
  const group = resolved
    ? groups.find((candidate) => candidate.choices.some((c) => c.row === resolved.choice.row))
    : undefined;
  const name = resolved?.choice.row.name ?? (wait.event.trim() === "" ? "Pick an event" : wait.event);
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={browsing}
      className="flex min-h-9 w-fit items-center gap-2 rounded-lg border bg-background px-3 text-sm font-semibold hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      data-testid="button-wait-event"
    >
      <span>{name}</span>
      {group && <span className="text-xs font-normal text-muted-foreground">{group.label}</span>}
      <ChevronDown className="h-3.5 w-3.5 opacity-70" aria-hidden="true" />
    </button>
  );
}

/**
 * The catalog's events, first by what they are about (Twitch, Counters, …) and then by
 * name, with a search across all of them. Opens in place under the event button.
 */
function EventCatalog({
  groups,
  onPick,
  onClose,
}: {
  groups: readonly WaitEventGroup[];
  onPick: (choice: WaitEventChoice) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [groupKey, setGroupKey] = useState<string | null>(groups.length === 1 ? groups[0].key : null);
  const searchId = useId();
  const hits = searchWaitEvents(groups, query);
  const group = groups.find((candidate) => candidate.key === groupKey);

  const eventButton = (choice: WaitEventChoice) => (
    <li key={choice.row.id}>
      <button
        type="button"
        onClick={() => onPick(choice)}
        className="flex min-h-10 w-full flex-col items-start rounded-md px-2.5 py-1.5 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        data-testid={`button-wait-event-${choice.row.id}`}
      >
        <span className="text-sm font-medium">{choice.row.name}</span>
        {choice.row.description && (
          <span className="line-clamp-1 text-xs text-muted-foreground">{choice.row.description}</span>
        )}
      </button>
    </li>
  );

  return (
    <fieldset
      className="flex min-w-0 flex-col gap-3 rounded-xl border border-primary/30 bg-card p-3"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
        }
      }}
      data-testid="wait-event-catalog"
    >
      <legend className="sr-only">Events to wait for</legend>
      <div className="flex items-center gap-2">
        {group && query === "" && (
          <Button type="button" variant="ghost" size="sm" className="gap-1 px-2" onClick={() => setGroupKey(null)}>
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            Back
          </Button>
        )}
        <label htmlFor={searchId} className="sr-only">
          Find an event
        </label>
        <Input
          id={searchId}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Find an event"
          className="h-9"
          autoFocus
          data-testid="input-wait-event-search"
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0 text-muted-foreground"
          onClick={onClose}
          aria-label="Close the event list"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
      {groups.length === 0 && (
        <p className="text-sm text-muted-foreground">No modules with events are installed yet.</p>
      )}
      {query !== "" ? (
        hits.length === 0 ? (
          <p className="text-sm text-muted-foreground" aria-live="polite">
            Nothing matches.
          </p>
        ) : (
          <ul className="flex flex-col" aria-label="Matching events">
            {hits.map(eventButton)}
          </ul>
        )
      ) : group ? (
        <ul className="flex flex-col" aria-label={group.label}>
          {group.choices.map(eventButton)}
        </ul>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-1.5">
          {groups.map((candidate) => (
            <button
              key={candidate.key}
              type="button"
              onClick={() => setGroupKey(candidate.key)}
              className="flex min-h-12 flex-col items-start justify-center rounded-lg px-2.5 py-1.5 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              data-testid={`button-wait-event-group-${candidate.key}`}
            >
              <span className="text-sm font-semibold">{candidate.label}</span>
              <span className="text-xs text-muted-foreground">
                {candidate.choices.length === 1 ? "1 event" : `${candidate.choices.length} events`}
              </span>
            </button>
          ))}
        </div>
      )}
    </fieldset>
  );
}

/**
 * The waited event's own settings as its trigger sentence, each setting a slot that
 * opens its picker in place below the sentence. A wildcard event first asks which one.
 */
function EventSettings({
  stepId,
  wait,
  resolved,
  onChange,
  onEventChange,
}: {
  stepId: string;
  wait: EventWaitConfig;
  resolved: ResolvedWaitEvent;
  onChange: (conditions: ConditionConfig[] | undefined) => void;
  onEventChange: (event: string) => void;
}) {
  const { choice } = resolved;
  const fields = choice.fields;
  const split = useMemo(() => splitWaitConditions(fields, wait.conditions ?? []), [fields, wait.conditions]);
  // A setting being filled in (a comparison with no number yet) has no condition to save,
  // so it is held here until finished; saving it would quietly turn it into Any.
  const [unfinished, setUnfinished] = useState<TriggerConfigValues | null>(null);
  const [openFieldId, setOpenFieldId] = useState<string | null>(null);
  const [loadedOptions, setLoadedOptions] = useState<ReadonlyMap<string, LoadedFieldOptions>>(new Map());
  const values = unfinished ?? split.values;
  const resourceLabels = useResourceLabels();

  const handleLoaded = useCallback((fieldId: string, entry: LoadedFieldOptions) => {
    setLoadedOptions((current) => new Map(current).set(fieldId, entry));
  }, []);

  const optionLabels = useMemo<OptionLabels>(() => {
    const labels = resourceFieldLabels(fields, resourceLabels);
    for (const [fieldId, entry] of Array.from(loadedOptions.entries())) {
      labels.set(fieldId, new Map(entry.options.map((option) => [option.value, option.label])));
    }
    return labels;
  }, [fields, resourceLabels, loadedOptions]);

  const setValue = (fieldId: string, value: unknown) => {
    const next = { ...values, [fieldId]: value as TriggerConfigValues[string] };
    if (incompleteConditionFields(fields, next).length > 0) {
      setUnfinished(next);
      return;
    }
    setUnfinished(null);
    onChange(joinWaitConditions(fields, next, split.checks));
  };

  const parts = fields.length > 0 ? sentenceParts(choice.row.sentence, fields, values, optionLabels) : [];
  const openField = fields.find((field) => field.id === openFieldId);

  return (
    <div className="flex flex-col gap-3">
      {fields.filter(isInternalSource).map((field) => (
        <FieldOptionsLoader key={field.id} field={field} onLoaded={handleLoaded} />
      ))}
      {choice.wildcardField !== undefined || (choice.row.event ?? "").includes("*") ? (
        <WildcardInput stepId={stepId} resolved={resolved} onEventChange={onEventChange} />
      ) : null}
      {parts.length > 0 && (
        <p className="text-[15px] leading-relaxed" data-testid="text-wait-sentence">
          <span>Wait until </span>
          <SentenceSlots
            parts={sentenceAfterWaitUntil(parts)}
            fields={fields}
            openFieldId={openFieldId}
            onToggle={(fieldId) => setOpenFieldId(openFieldId === fieldId ? null : fieldId)}
          />
        </p>
      )}
      {openField && (
        <div className="rounded-lg border bg-muted/30" data-testid={`wait-setting-${openField.id}`}>
          <ConditionValueEditor
            field={openField}
            value={values[openField.id]}
            loaded={loadedOptions.get(openField.id)}
            onChange={(value) => setValue(openField.id, value)}
            onChosen={() => setOpenFieldId(null)}
          />
        </div>
      )}
    </div>
  );
}

function SentenceSlots({
  parts,
  fields,
  openFieldId,
  onToggle,
}: {
  parts: SentencePart[];
  fields: readonly ConfigField[];
  openFieldId: string | null;
  onToggle: (fieldId: string) => void;
}) {
  return (
    <>
      {parts.map((part, index) => {
        const key = `${index}-${part.kind === "field" ? part.fieldId : part.text}`;
        if (part.kind === "text") {
          return <span key={key}>{part.text}</span>;
        }
        const field = fields.find((candidate) => candidate.id === part.fieldId);
        return (
          <button
            key={key}
            type="button"
            onClick={() => onToggle(part.fieldId)}
            aria-expanded={openFieldId === part.fieldId}
            aria-label={`${field?.label ?? part.fieldId}: ${part.text}. Change`}
            className={cn(
              "mx-0.5 inline-flex min-h-8 items-center gap-1 rounded-md border border-dashed px-2 font-semibold hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              part.state === "missing"
                ? "border-amber-500 text-amber-700 dark:text-amber-300"
                : "border-primary/50 text-primary-text"
            )}
            data-testid={`button-wait-slot-${part.fieldId}`}
          >
            {part.text}
            <ChevronDown className="h-3.5 w-3.5 opacity-70" aria-hidden="true" />
          </button>
        );
      })}
    </>
  );
}

function WildcardInput({
  stepId,
  resolved,
  onEventChange,
}: {
  stepId: string;
  resolved: ResolvedWaitEvent;
  onEventChange: (event: string) => void;
}) {
  const { choice } = resolved;
  const [text, setText] = useState(resolved.wildcardValue);
  const id = `wait-wildcard-${stepId}`;
  const label = choice.wildcardField?.label ?? "Which one";
  const valid = /^[^\s.*]+$/.test(text.trim());
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[13px] font-medium">
        {label}
      </label>
      <Input
        id={id}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          const name = event.target.value.trim();
          if (name === "" || /^[^\s.*]+$/.test(name)) {
            onEventChange(waitEventName(choice, name));
          }
        }}
        placeholder={choice.wildcardField?.placeholder ?? undefined}
        className="h-9 max-w-xs"
        aria-invalid={text.trim() !== "" && !valid}
        data-testid="input-wait-wildcard"
      />
      {text.trim() === "" ? (
        <p className="text-xs text-amber-700 dark:text-amber-300">
          Name which one to wait for. Without it, nothing ends this wait.
        </p>
      ) : (
        !valid && <p className="text-xs text-destructive">Use one word, without spaces or dots.</p>
      )}
    </div>
  );
}

/**
 * Extra checks on the waited event's details. Only its own payload fields are offered,
 * since the engine checks a wait's conditions against the event alone. A saved check
 * the rows can't show (another source, a compound expression) stays as written.
 */
function ChecksEditor({
  wait,
  resolved,
  onChange,
}: {
  wait: EventWaitConfig;
  resolved: ResolvedWaitEvent | null;
  onChange: (checks: ConditionConfig[]) => void;
}) {
  const fields = resolved?.choice.fields ?? [];
  const emits = resolved?.choice.emits ?? [];
  const { checks } = splitWaitConditions(fields, wait.conditions ?? []);
  const eventName = resolved ? resolved.choice.row.name.toLowerCase() : "event";
  const replace = (index: number, check: ConditionConfig | null) => {
    const next = [...checks];
    if (check) {
      next[index] = check;
    } else {
      next.splice(index, 1);
    }
    onChange(next);
  };

  if (checks.length === 0 && emits.length === 0) {
    return null;
  }
  return (
    <Section title="Also check its details">
      {checks.map((condition, index) => {
        const check = readWaitCheck(condition, emits);
        const key = `${index}-${condition.field}`;
        if (!check) {
          return (
            <div key={key} className="flex items-center gap-2 text-sm" data-testid={`wait-check-kept-${index}`}>
              <span className="min-w-0 flex-1 truncate font-mono text-xs">{waitCheckText(condition, emits)}</span>
              <span className="shrink-0 text-xs text-muted-foreground">Kept as written</span>
              <RemoveCheckButton onClick={() => replace(index, null)} />
            </div>
          );
        }
        return (
          <CheckRow
            key={key}
            index={index}
            check={check}
            emits={emits}
            onChange={(next) => replace(index, next)}
            onRemove={() => replace(index, null)}
          />
        );
      })}
      {emits.length > 0 && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="w-fit gap-1.5 px-2"
          onClick={() => onChange([...checks, newWaitCheck(emits[0])])}
          data-testid="button-wait-add-check"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          Add a check
        </Button>
      )}
      <p className="text-xs text-muted-foreground">
        Checks here look at the {eventName} itself. To compare with earlier steps, add a condition after this wait.
      </p>
    </Section>
  );
}

function CheckRow({
  index,
  check,
  emits,
  onChange,
  onRemove,
}: {
  index: number;
  check: NonNullable<ReturnType<typeof readWaitCheck>>;
  emits: readonly DataShapeField[];
  onChange: (condition: ConditionConfig) => void;
  onRemove: () => void;
}) {
  const operators = checkOperators(check.field.type);
  const [text, setText] = useState(check.value);
  const shown = writeWaitCheck({ ...check, value: text }).value === writeWaitCheck(check).value ? text : check.value;
  const numberProblem =
    check.field.type === "number" &&
    checkTakesValue(check.choice) &&
    shown.trim() !== "" &&
    !Number.isFinite(Number(shown));
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid={`wait-check-${index}`}>
      <Select
        value={check.field.path}
        onValueChange={(path) => {
          const field = emits.find((candidate) => candidate.path === path);
          if (field) {
            setText("");
            onChange(newWaitCheck(field));
          }
        }}
      >
        <SelectTrigger className="h-9 w-44" aria-label="Detail" data-testid={`select-wait-check-field-${index}`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {emits.map((field) => (
            <SelectItem key={field.path} value={field.path}>
              {payloadFieldLabel(field.path)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={check.choice.id}
        onValueChange={(id) => {
          const choice = operators.find((candidate) => candidate.id === id);
          if (choice) {
            onChange(writeWaitCheck({ ...check, choice, value: shown }));
          }
        }}
      >
        <SelectTrigger className="h-9 w-48" aria-label="Comparison" data-testid={`select-wait-check-operator-${index}`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {operators.map((choice) => (
            <SelectItem key={choice.id} value={choice.id}>
              {choice.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {checkTakesValue(check.choice) && (
        <Input
          value={shown}
          onChange={(event) => {
            setText(event.target.value);
            onChange(writeWaitCheck({ ...check, value: event.target.value }));
          }}
          inputMode={check.field.type === "number" ? "decimal" : undefined}
          aria-label="Value"
          aria-invalid={numberProblem}
          className="h-9 w-40"
          data-testid={`input-wait-check-value-${index}`}
        />
      )}
      <RemoveCheckButton onClick={onRemove} />
      {numberProblem && <p className="w-full text-xs text-destructive">Enter a number.</p>}
    </div>
  );
}

function RemoveCheckButton({ onClick }: { onClick: () => void }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="h-8 w-8 shrink-0 text-muted-foreground"
      onClick={onClick}
      aria-label="Remove this check"
    >
      <X className="h-4 w-4" aria-hidden="true" />
    </Button>
  );
}

const HOW_MANY_LABELS: Record<WaitHowMany, string> = {
  first: "The first one",
  count: "A number of them",
  sum: "Until they add up",
  threshold: "One big enough",
};

function HowManyEditor({
  stepId,
  wait,
  emits,
  onChange,
}: {
  stepId: string;
  wait: EventWaitConfig;
  emits: readonly DataShapeField[];
  onChange: (wait: WaitConfig) => void;
}) {
  const how = waitHowMany(wait);
  const numeric = numericPayloadFields(emits);
  const hasNumber = numeric.length > 0 || Boolean(wait.aggregation?.field) || emits.length === 0;
  const offered = (Object.keys(HOW_MANY_LABELS) as WaitHowMany[]).filter(
    (option) => option === how || option === "first" || option === "count" || hasNumber
  );
  const aggregation = wait.aggregation;

  return (
    <Section title="How many">
      <fieldset className="flex w-fit flex-wrap rounded-lg bg-muted p-1">
        <legend className="sr-only">How many</legend>
        {offered.map((option) => (
          <ModeButton
            key={option}
            pressed={how === option}
            onClick={() => onChange(setWaitHowMany(wait, option, numeric))}
            testId={`how-${option}`}
          >
            {HOW_MANY_LABELS[option]}
          </ModeButton>
        ))}
      </fieldset>
      {aggregation && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {how === "count" && (
            <>
              <span>Continue once</span>
              <ThresholdInput how={how} wait={wait} onChange={onChange} label="How many" />
              <span>of them have happened</span>
            </>
          )}
          {how === "sum" && (
            <>
              <span>Continue once their</span>
              <AggregationFieldSelect wait={wait} numeric={numeric} onChange={onChange} />
              <span>adds up to</span>
              <ThresholdInput how={how} wait={wait} onChange={onChange} label="Total" />
            </>
          )}
          {how === "threshold" && (
            <>
              <span>Continue on the first one whose</span>
              <AggregationFieldSelect wait={wait} numeric={numeric} onChange={onChange} />
              <span>is at least</span>
              <ThresholdInput how={how} wait={wait} onChange={onChange} label="Amount" />
            </>
          )}
        </div>
      )}
      {aggregation && <WindowEditor stepId={stepId} wait={wait} onChange={onChange} />}
      {!hasNumber && (
        <p className="text-xs text-muted-foreground">
          This event has no numbers to add up or compare, so only “The first one” and “A number of them” apply.
        </p>
      )}
    </Section>
  );
}

function ThresholdInput({
  how,
  wait,
  onChange,
  label,
}: {
  how: WaitHowMany;
  wait: EventWaitConfig;
  onChange: (wait: WaitConfig) => void;
  label: string;
}) {
  const aggregation = wait.aggregation;
  const stored = aggregation?.threshold ?? 1;
  const [text, setText] = useState(String(stored));
  const shown = Number(text) === stored ? text : String(stored);
  const problem = text.trim() === "" ? "Enter a number." : thresholdProblem(how, Number(text));
  return (
    <span className="inline-flex flex-col gap-1">
      <Input
        type="number"
        inputMode="decimal"
        value={problem ? text : shown}
        onChange={(event) => {
          setText(event.target.value);
          const value = Number(event.target.value);
          if (aggregation && event.target.value.trim() !== "" && thresholdProblem(how, value) === null) {
            onChange({ ...wait, aggregation: { ...aggregation, threshold: value } });
          }
        }}
        aria-label={label}
        aria-invalid={problem !== null}
        className="h-9 w-24"
        data-testid="input-wait-threshold"
      />
      {problem && <span className="text-xs text-destructive">{problem}</span>}
    </span>
  );
}

/** Marks an aggregation reading no field, which the engine then takes from the payload's amount or value. */
const DEFAULT_FIELD = "__default";

function AggregationFieldSelect({
  wait,
  numeric,
  onChange,
}: {
  wait: EventWaitConfig;
  numeric: readonly DataShapeField[];
  onChange: (wait: WaitConfig) => void;
}) {
  const aggregation = wait.aggregation;
  if (!aggregation) {
    return null;
  }
  const options = numeric.map((field) => ({
    value: aggregationFieldFor(field.path),
    label: payloadFieldLabel(field.path).toLowerCase(),
  }));
  const current = aggregation.field ?? DEFAULT_FIELD;
  if (!options.some((option) => option.value === current)) {
    options.unshift({
      value: current,
      label: current === DEFAULT_FIELD ? "amount" : payloadFieldLabel(current.replace(/^data\./, "")).toLowerCase(),
    });
  }
  return (
    <Select
      value={current}
      onValueChange={(value) => {
        const { field: _field, ...rest } = aggregation;
        onChange({ ...wait, aggregation: value === DEFAULT_FIELD ? rest : { ...rest, field: value } });
      }}
    >
      <SelectTrigger className="h-9 w-40" aria-label="Detail to read" data-testid="select-wait-aggregation-field">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function WindowEditor({
  stepId,
  wait,
  onChange,
}: {
  stepId: string;
  wait: EventWaitConfig;
  onChange: (wait: WaitConfig) => void;
}) {
  const aggregation = wait.aggregation;
  if (!aggregation) {
    return null;
  }
  const windowOn = aggregation.timeWindow !== undefined && String(aggregation.timeWindow) !== "";
  const checkboxId = `wait-window-on-${stepId}`;
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <Checkbox
        id={checkboxId}
        checked={windowOn}
        onCheckedChange={(checked) => {
          const { timeWindow: _timeWindow, ...rest } = aggregation;
          onChange({ ...wait, aggregation: checked === true ? { ...rest, timeWindow: DEFAULT_WINDOW } : rest });
        }}
        data-testid="checkbox-wait-window"
      />
      <label htmlFor={checkboxId}>
        {windowOn ? "Only count what happens in the first" : "Only count what happens within a set time"}
      </label>
      {windowOn && (
        <>
          <DurationInput
            id={`wait-window-${stepId}`}
            valueMs={parseGoDuration(String(aggregation.timeWindow))}
            units={LIMIT_UNITS}
            bounds={WINDOW_BOUNDS}
            onChange={(durationMs) =>
              onChange({ ...wait, aggregation: { ...aggregation, timeWindow: formatGoDuration(durationMs) } })
            }
            label="Window length"
            compact
          />
          <span>of waiting</span>
        </>
      )}
    </div>
  );
}

function TimeLimitEditor({
  stepId,
  wait,
  onChange,
}: {
  stepId: string;
  wait: EventWaitConfig;
  onChange: (wait: WaitConfig) => void;
}) {
  const limitOn = Boolean(wait.timeout);
  const checkboxId = `wait-limit-on-${stepId}`;
  return (
    <Section title="If it doesn't happen">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Checkbox
          id={checkboxId}
          checked={limitOn}
          onCheckedChange={(checked) => onChange(setWaitTimeoutEnabled(wait, checked === true))}
          data-testid="checkbox-wait-limit"
        />
        <label htmlFor={checkboxId}>Give up after</label>
        {limitOn && (
          <>
            <DurationInput
              id={`wait-limit-${stepId}`}
              valueMs={parseGoDuration(String(wait.timeout))}
              units={LIMIT_UNITS}
              bounds={TIMEOUT_BOUNDS}
              onChange={(durationMs) => onChange({ ...wait, timeout: formatGoDuration(durationMs) })}
              label="Time limit"
              compact
            />
            <span>and</span>
            <Select
              value={wait.onTimeout ?? DEFAULT_ON_TIMEOUT}
              onValueChange={(value) => onChange({ ...wait, onTimeout: value as EventWaitConfig["onTimeout"] })}
            >
              <SelectTrigger className="h-9 w-56" aria-label="Then" data-testid="select-wait-on-timeout">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="continue">carry on with the next step</SelectItem>
                <SelectItem value="fail">stop the workflow here</SelectItem>
              </SelectContent>
            </Select>
          </>
        )}
      </div>
      {!limitOn && (
        <p className="text-xs text-muted-foreground">
          Without a limit, the workflow waits until it happens, however long that takes.
        </p>
      )}
    </Section>
  );
}

/** What later steps can read from this wait, in the words the variable menu offers them. */
function OutputsNote({ step, catalogTriggers }: { step: WaitNode; catalogTriggers: CatalogTriggerRow[] }) {
  const labels = waitExportVariables(step, catalogTriggers).map((option) => option.label.toLowerCase());
  if (labels.length === 0) {
    return null;
  }
  return (
    <p className="text-xs text-muted-foreground" data-testid="text-wait-outputs">
      Later steps can use {labels.join(", ")}. Type <code>{"{"}</code> in one of their fields.
    </p>
  );
}

/** The streamer's counters, timers and queues by canonical id, so a sentence names them. */
function useResourceLabels(): ReadonlyMap<string, string> | undefined {
  const { instanceId } = useEngineScope();
  const rows = useResourceInstances(instanceId);
  return useMemo(() => (rows ? new Map(rows.map((row) => [row.canonicalId, row.displayName])) : undefined), [rows]);
}
