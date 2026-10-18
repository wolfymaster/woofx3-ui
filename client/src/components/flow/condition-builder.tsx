import type { ConditionConfig, ConditionOperator } from "@woofx3/api";
import { ChevronDown, Code2, ListChecks, Plus, Search, Wand2, X } from "lucide-react";
import { type KeyboardEvent, useId, useMemo, useState } from "react";
import { VariableAwareInput } from "@/components/common/variable-aware-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  type ConditionField,
  type ConditionFieldKind,
  type ConditionSources,
  comparesNumberAsText,
  conditionForField,
  findConditionField,
  fitsBuilder,
  fixNumbersAsText,
  isListOperator,
  isValuelessOperator,
  numberFromText,
  operatorChoices,
  patternProblem,
  selectedOperator,
  testPattern,
  VIEWER_GROUP,
  withOperator,
} from "@/lib/condition-builder";
import {
  conditionFieldType,
  conditionValueProblem,
  conditionValueText,
  parseConditionValue,
} from "@/lib/condition-value";
import { cn } from "@/lib/utils";
import type { ViewerFactsState } from "@/lib/viewer-facts";
import type { ConditionNode } from "@/lib/workflow-tree";
import type { VariableOption } from "@/lib/workflow-variables";

const KIND_LABELS: Record<ConditionFieldKind, string> = {
  number: "Number",
  text: "Text",
  choice: "Choice",
  boolean: "Yes or no",
  collection: "List",
};

/** Every operator, for a condition typed by hand; the field's kind is unknown there. */
const ALL_OPERATORS: { operator: ConditionOperator; label: string }[] = [
  { operator: "eq", label: "is" },
  { operator: "ne", label: "is not" },
  { operator: "gt", label: "is more than" },
  { operator: "gte", label: "is at least" },
  { operator: "lt", label: "is less than" },
  { operator: "lte", label: "is at most" },
  { operator: "between", label: "is between" },
  { operator: "contains", label: "contains" },
  { operator: "starts_with", label: "starts with" },
  { operator: "ends_with", label: "ends with" },
  { operator: "regex", label: "matches the pattern" },
  { operator: "in", label: "is one of" },
  { operator: "not_in", label: "is not one of" },
  { operator: "exists", label: "has a value" },
  { operator: "not_exists", label: "is missing" },
];

export interface ConditionBuilderProps {
  conditions: ConditionConfig[];
  logic: "and" | "or" | undefined;
  onChange: (conditions: ConditionConfig[], logic: "and" | "or") => void;
  /** What a row's field picker offers; see conditionFields. */
  fields: ConditionField[];
  /** Whether the trigger names a viewer, so that facts about them can be offered. */
  namesViewer: boolean;
  viewerFacts: ViewerFactsState;
  /** Whether the engine resolves a `${...}` inside a list value. */
  listReferences: boolean;
  /** For a condition typed by hand; see computeAvailableVariables. */
  availableVariables: VariableOption[];
}

/**
 * A condition step's rows, edited in place. Each row's field is picked from what the
 * step can read, its comparisons follow the field's kind, and its value control follows
 * the comparison. A row the pickers cannot express, or one the streamer switches to
 * "Type it", is edited as the text it stores.
 */
export function ConditionBuilder({
  conditions,
  logic,
  onChange,
  fields,
  namesViewer,
  viewerFacts,
  listReferences,
  availableVariables,
}: ConditionBuilderProps) {
  const [pickerFor, setPickerFor] = useState<number | null>(null);
  const [typedRows, setTypedRows] = useState<ReadonlySet<number>>(new Set());
  const combine = logic === "or" ? "or" : "and";

  const setRow = (index: number, next: ConditionConfig) => {
    onChange(
      conditions.map((c, i) => (i === index ? next : c)),
      combine
    );
  };

  const removeRow = (index: number) => {
    onChange(
      conditions.filter((_, i) => i !== index),
      combine
    );
    setPickerFor(null);
    setTypedRows((rows) => new Set(Array.from(rows, (i) => (i > index ? i - 1 : i)).filter((i) => i !== index)));
  };

  const addRow = () => {
    onChange([...conditions, { field: "", operator: "eq", value: "" }], combine);
    setPickerFor(conditions.length);
  };

  const setTyped = (index: number, typed: boolean) => {
    setTypedRows((rows) => {
      const next = new Set(rows);
      if (typed) {
        next.add(index);
      } else {
        next.delete(index);
      }
      return next;
    });
    setPickerFor(null);
  };

  return (
    <div className="space-y-3" data-testid="condition-builder">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">Continue into Then when</span>
        <fieldset className="inline-flex rounded-md bg-muted p-0.5" aria-label="How the conditions combine">
          {(["and", "or"] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={combine === option}
              onClick={() => onChange(conditions, option)}
              className={cn(
                "rounded px-2.5 py-1 text-sm font-medium transition-colors",
                combine === option ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"
              )}
              data-testid={`button-condition-logic-${option}`}
            >
              {option === "and" ? "all of these are true" : "any of these is true"}
            </button>
          ))}
        </fieldset>
      </div>

      {conditions.length === 0 && <p className="text-sm text-muted-foreground">No conditions yet. Add one below.</p>}

      {conditions.map((condition, index) => {
        const field = findConditionField(fields, condition.field);
        const typed = typedRows.has(index) || (condition.field !== "" && !fitsBuilder(condition, field));
        return (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: rows have no stable identity; list is append/remove-only, not reordered
            key={index}
            className="space-y-2 rounded-md border bg-background p-3"
            data-testid={`condition-row-${index}`}
          >
            {typed ? (
              <TypedRow
                index={index}
                condition={condition}
                availableVariables={availableVariables}
                listReferences={listReferences}
                onChange={(next) => setRow(index, next)}
                onRemove={() => removeRow(index)}
                canUsePickers={fitsBuilder(condition, field)}
                onUsePickers={() => setTyped(index, false)}
              />
            ) : (
              <PickedRow
                index={index}
                condition={condition}
                field={field}
                fields={fields}
                namesViewer={namesViewer}
                viewerFacts={viewerFacts}
                pickerOpen={pickerFor === index}
                onTogglePicker={() => setPickerFor(pickerFor === index ? null : index)}
                onPick={(picked) => {
                  setRow(index, conditionForField(picked));
                  setPickerFor(null);
                }}
                onChange={(next) => setRow(index, next)}
                onRemove={() => removeRow(index)}
                onType={() => setTyped(index, true)}
              />
            )}
          </div>
        );
      })}

      <Button
        type="button"
        variant="outline"
        size="sm"
        className="gap-1.5"
        onClick={addRow}
        data-testid="button-add-condition"
      >
        <Plus className="h-3.5 w-3.5" />
        Add a condition
      </Button>
    </div>
  );
}

interface PickedRowProps {
  index: number;
  condition: ConditionConfig;
  field: ConditionField | undefined;
  fields: ConditionField[];
  namesViewer: boolean;
  viewerFacts: ViewerFactsState;
  pickerOpen: boolean;
  onTogglePicker: () => void;
  onPick: (field: ConditionField) => void;
  onChange: (condition: ConditionConfig) => void;
  onRemove: () => void;
  onType: () => void;
}

function PickedRow({
  index,
  condition,
  field,
  fields,
  namesViewer,
  viewerFacts,
  pickerOpen,
  onTogglePicker,
  onPick,
  onChange,
  onRemove,
  onType,
}: PickedRowProps) {
  const pickerId = useId();
  const operator = field ? selectedOperator(field.kind, condition) : undefined;

  return (
    <>
      <div className="flex flex-wrap items-start gap-2">
        <button
          type="button"
          onClick={onTogglePicker}
          aria-expanded={pickerOpen}
          aria-controls={pickerId}
          className="flex min-h-9 min-w-[12rem] flex-1 items-center gap-2 rounded-md border px-3 text-left text-sm hover:border-primary/50"
          data-testid={`button-condition-field-${index}`}
        >
          {field ? (
            <>
              <span className="truncate font-medium">{field.label}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{KIND_LABELS[field.kind]}</span>
            </>
          ) : (
            <span className="text-muted-foreground">Pick a value to check</span>
          )}
          <ChevronDown className="ml-auto h-4 w-4 shrink-0 text-muted-foreground" />
        </button>
        {field && operator && (
          <Select
            value={operator.id}
            onValueChange={(id) => {
              const next = operatorChoices(field.kind).find((choice) => choice.id === id);
              if (next) {
                onChange(withOperator(condition, field, next));
              }
            }}
          >
            <SelectTrigger className="w-[11rem] shrink-0" data-testid={`select-condition-operator-${index}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {operatorChoices(field.kind).map((choice) => (
                <SelectItem key={choice.id} value={choice.id}>
                  {choice.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <div className="ml-auto flex shrink-0 items-center">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-9 gap-1 px-2 text-xs text-muted-foreground"
            onClick={onType}
            data-testid={`button-condition-type-${index}`}
          >
            <Code2 className="h-3.5 w-3.5" />
            Type it
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-9 w-9 text-muted-foreground hover:text-destructive"
            onClick={onRemove}
            aria-label="Remove this condition"
            data-testid={`button-remove-condition-${index}`}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {pickerOpen && (
        <FieldPicker
          id={pickerId}
          index={index}
          fields={fields}
          namesViewer={namesViewer}
          viewerFacts={viewerFacts}
          onPick={onPick}
        />
      )}

      {field && operator && operator.fixedValue === undefined && !isValuelessOperator(condition.operator) && (
        <ValueControl index={index} condition={condition} field={field} onChange={onChange} />
      )}

      {field && comparesNumberAsText(condition, field) && (
        <div
          className="flex flex-wrap items-center gap-2 rounded-md bg-amber-500/10 px-3 py-2 text-sm"
          data-testid={`text-condition-number-as-text-${index}`}
        >
          <span>This compares a number as text, so 9 would count as more than 100.</span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 gap-1"
            onClick={() => onChange(fixNumbersAsText(condition, field))}
            data-testid={`button-condition-fix-number-${index}`}
          >
            <Wand2 className="h-3.5 w-3.5" />
            Fix it
          </Button>
        </div>
      )}

      {field?.group === VIEWER_GROUP && (
        <p className="text-xs text-muted-foreground">
          Facts about the viewer come from what WoofX3 has seen of them on your channel. A viewer it hasn't seen yet has
          no value.
        </p>
      )}
    </>
  );
}

/** The field list, shown inside the row rather than over it, with a search box for long lists. */
function FieldPicker({
  id,
  index,
  fields,
  namesViewer,
  viewerFacts,
  onPick,
}: {
  id: string;
  index: number;
  fields: ConditionField[];
  namesViewer: boolean;
  viewerFacts: ViewerFactsState;
  onPick: (field: ConditionField) => void;
}) {
  const [query, setQuery] = useState("");
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const byGroup = new Map<string, ConditionField[]>();
    for (const field of fields) {
      if (q !== "" && !field.label.toLowerCase().includes(q)) {
        continue;
      }
      byGroup.set(field.group, [...(byGroup.get(field.group) ?? []), field]);
    }
    return Array.from(byGroup.entries());
  }, [fields, query]);
  const viewerNote = namesViewer ? viewerFactsNote(viewerFacts) : null;

  return (
    <div
      id={id}
      className="space-y-2 rounded-md border bg-muted/30 p-2"
      data-testid={`condition-field-picker-${index}`}
    >
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Find a value to check"
          className="pl-8"
          aria-label="Find a value to check"
          data-testid={`input-condition-field-search-${index}`}
        />
      </div>
      <div className="max-h-72 space-y-3 overflow-y-auto">
        {groups.length === 0 && !viewerNote && (
          <p className="px-2 py-1 text-sm text-muted-foreground">
            {fields.length === 0 ? "Nothing to check yet. Pick a trigger first." : "Nothing matches that."}
          </p>
        )}
        {groups.map(([group, items]) => (
          <div key={group}>
            <p className="px-2 pb-1 text-xs font-medium text-muted-foreground">{group}</p>
            {items.map((field) => (
              <button
                key={field.ref}
                type="button"
                onClick={() => onPick(field)}
                title={field.description}
                className="flex min-h-9 w-full items-center justify-between gap-3 rounded-md px-2 text-left text-sm hover:bg-muted"
                data-testid={`option-condition-field-${field.ref}`}
              >
                <span className="truncate">{field.label}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{KIND_LABELS[field.kind]}</span>
              </button>
            ))}
          </div>
        ))}
        {viewerNote && <p className="px-2 text-xs text-muted-foreground">{viewerNote}</p>}
      </div>
    </div>
  );
}

function viewerFactsNote(state: ViewerFactsState): string | null {
  switch (state.status) {
    case "loading":
      return "Loading facts about the viewer…";
    case "ready":
      return null;
    case "unavailable":
      return state.reason === "unsupported"
        ? "Update WoofX3 to check facts about the viewer."
        : "Facts about the viewer couldn't be loaded.";
  }
}

function ValueControl({
  index,
  condition,
  field,
  onChange,
}: {
  index: number;
  condition: ConditionConfig;
  field: ConditionField;
  onChange: (condition: ConditionConfig) => void;
}) {
  const setValue = (value: unknown) => onChange({ ...condition, value });
  const { operator, value } = condition;

  if (field.kind === "choice" && field.choices) {
    const many = isListOperator(operator);
    const selected = many ? (Array.isArray(value) ? value : []) : [value];
    return (
      <fieldset className="flex flex-wrap gap-1.5" aria-label="Values">
        {field.choices.map((choice) => {
          const on = selected.some((item) => String(item) === String(choice.value));
          return (
            <button
              key={String(choice.value)}
              type="button"
              aria-pressed={on}
              onClick={() => {
                if (!many) {
                  setValue(choice.value);
                  return;
                }
                const rest = selected.filter((item) => String(item) !== String(choice.value));
                setValue(on ? rest : [...rest, choice.value]);
              }}
              className={cn(
                "min-h-8 rounded-full border px-3 text-sm font-medium transition-colors",
                on ? "border-primary/50 bg-primary/10 text-primary" : "hover:bg-muted"
              )}
              data-testid={`button-condition-choice-${index}-${String(choice.value)}`}
            >
              {choice.label}
            </button>
          );
        })}
      </fieldset>
    );
  }

  if (operator === "between") {
    const [min, max] = Array.isArray(value) && value.length === 2 ? value : ["", ""];
    return (
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <NumberInput
          value={min}
          onChange={(next) => setValue([next, max])}
          label="From"
          testId={`input-condition-min-${index}`}
        />
        <span className="text-muted-foreground">and</span>
        <NumberInput
          value={max}
          onChange={(next) => setValue([min, next])}
          label="To"
          testId={`input-condition-max-${index}`}
        />
      </div>
    );
  }

  if (isListOperator(operator)) {
    return (
      <ListInput
        index={index}
        items={Array.isArray(value) ? value : []}
        numeric={field.kind === "number"}
        onChange={setValue}
      />
    );
  }

  if (operator === "regex") {
    return <PatternInput index={index} pattern={typeof value === "string" ? value : ""} onChange={setValue} />;
  }

  if (field.kind === "number") {
    return <NumberInput value={value} onChange={setValue} label="Value" testId={`input-condition-value-${index}`} />;
  }

  return (
    <Input
      value={typeof value === "string" ? value : conditionValueText(value)}
      onChange={(event) => setValue(event.target.value)}
      placeholder="Text to compare"
      aria-label="Value"
      data-testid={`input-condition-value-${index}`}
    />
  );
}

/**
 * A number typed as text. The text is kept as typed while it still reads as the stored
 * value, so "1." mid-way through "1.5" is not reset; a number stores as a number, which
 * the engine compares numerically.
 */
function NumberInput({
  value,
  onChange,
  label,
  testId,
}: {
  value: unknown;
  onChange: (value: number | string) => void;
  label: string;
  testId: string;
}) {
  const stored = value === undefined || value === null ? "" : String(value);
  const [draft, setDraft] = useState(stored);
  const draftValue = draft.trim() === "" ? "" : numberFromText(draft);
  const text = draftValue !== undefined && String(draftValue) === stored ? draft : stored;
  const invalid = text.trim() !== "" && numberFromText(text) === undefined;
  return (
    <div className="space-y-1">
      <Input
        value={text}
        inputMode="decimal"
        onChange={(event) => {
          const raw = event.target.value;
          setDraft(raw);
          const n = raw.trim() === "" ? "" : numberFromText(raw);
          if (n !== undefined) {
            onChange(n);
          }
        }}
        aria-label={label}
        aria-invalid={invalid}
        placeholder={label === "Value" ? "A number" : label}
        className="w-36"
        data-testid={testId}
      />
      {invalid && <p className="text-xs text-destructive">Enter a number.</p>}
    </div>
  );
}

/** The values of "is one of": each added with Enter or a comma, each removable on its own. */
function ListInput({
  index,
  items,
  numeric,
  onChange,
}: {
  index: number;
  items: unknown[];
  numeric: boolean;
  onChange: (items: unknown[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  const commit = () => {
    const text = draft.trim();
    if (text === "") {
      return;
    }
    const item = numeric ? numberFromText(text) : text;
    if (item === undefined) {
      setProblem("Enter a number.");
      return;
    }
    setProblem(null);
    setDraft("");
    if (!items.some((existing) => existing === item)) {
      onChange([...items, item]);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      commit();
    } else if (event.key === "Backspace" && draft === "" && items.length > 0) {
      onChange(items.slice(0, -1));
    }
  };

  return (
    <div className="space-y-1">
      <div className="flex min-h-9 flex-wrap items-center gap-1.5 rounded-md border px-2 py-1">
        {items.map((item, i) => (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: items may repeat in a hand-written list
            key={i}
            className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-sm"
          >
            {String(item)}
            <button
              type="button"
              aria-label={`Remove ${String(item)}`}
              onClick={() => onChange(items.filter((_, at) => at !== i))}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          onBlur={commit}
          inputMode={numeric ? "decimal" : undefined}
          placeholder={items.length === 0 ? "Add a value, then press Enter" : "Add another"}
          aria-label="Add a value"
          className="min-w-[8rem] flex-1 bg-transparent text-sm outline-none"
          data-testid={`input-condition-list-${index}`}
        />
      </div>
      {problem && <p className="text-xs text-destructive">{problem}</p>}
    </div>
  );
}

/** A pattern with a sample to try it on, so the streamer sees what it matches before saving. */
function PatternInput({
  index,
  pattern,
  onChange,
}: {
  index: number;
  pattern: string;
  onChange: (pattern: string) => void;
}) {
  const [sample, setSample] = useState("");
  const problem = pattern === "" ? null : patternProblem(pattern);
  const result = pattern === "" || sample === "" ? null : testPattern(pattern, sample);
  return (
    <div className="space-y-2">
      <Input
        value={pattern}
        onChange={(event) => onChange(event.target.value)}
        placeholder="A pattern, like spotify\.com|youtu"
        aria-label="Pattern"
        className="font-mono text-sm"
        data-testid={`input-condition-pattern-${index}`}
      />
      {problem && <p className="text-xs text-destructive">{problem}</p>}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">Try it with</span>
        <Input
          value={sample}
          onChange={(event) => setSample(event.target.value)}
          placeholder="Some text to test"
          aria-label="Text to test the pattern on"
          className="min-w-[12rem] flex-1"
          data-testid={`input-condition-sample-${index}`}
        />
        {result !== null && (
          <span
            className={cn("font-medium", result ? "text-green-700 dark:text-green-400" : "text-destructive")}
            data-testid={`text-condition-sample-result-${index}`}
          >
            {result ? "Matches" : "Does not match"}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * A condition edited as the text it stores: any `${...}` field, any operator, a typed
 * value. For what the pickers cannot express, like comparing two variables.
 */
function TypedRow({
  index,
  condition,
  availableVariables,
  listReferences,
  onChange,
  onRemove,
  canUsePickers,
  onUsePickers,
}: {
  index: number;
  condition: ConditionConfig;
  availableVariables: VariableOption[];
  listReferences: boolean;
  onChange: (condition: ConditionConfig) => void;
  onRemove: () => void;
  canUsePickers: boolean;
  onUsePickers: () => void;
}) {
  const fieldType = conditionFieldType(condition.field, availableVariables);
  const [draft, setDraft] = useState(() => conditionValueText(condition.value));
  const draftIsCurrent =
    JSON.stringify(parseConditionValue(condition.operator, draft, fieldType)) === JSON.stringify(condition.value);
  const text = draftIsCurrent ? draft : conditionValueText(condition.value);
  const problem = conditionValueProblem(condition.operator, text, listReferences);

  const retype = (field: string, operator: ConditionOperator) => {
    const type = conditionFieldType(field, availableVariables);
    onChange({ field, operator, value: parseConditionValue(operator, text, type) });
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-[12rem] flex-[1.2]">
          <VariableAwareInput
            value={condition.field}
            onChange={(field) => retype(field, condition.operator)}
            placeholder="{variable}"
            className="font-mono text-xs"
            availableVariables={availableVariables}
            data-testid={`input-condition-field-${index}`}
          />
        </div>
        <Select value={condition.operator} onValueChange={(op) => retype(condition.field, op as ConditionOperator)}>
          <SelectTrigger className="w-[11rem] shrink-0" data-testid={`select-condition-operator-${index}`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ALL_OPERATORS.map(({ operator, label }) => (
              <SelectItem key={operator} value={operator}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {!isValuelessOperator(condition.operator) && (
          <div className="min-w-[10rem] flex-1">
            <VariableAwareInput
              value={text}
              onChange={(raw) => {
                setDraft(raw);
                onChange({ ...condition, value: parseConditionValue(condition.operator, raw, fieldType) });
              }}
              placeholder={
                condition.operator === "between" ? "min, max" : isListOperator(condition.operator) ? "a, b, c" : "value"
              }
              availableVariables={availableVariables}
              data-testid={`input-condition-value-${index}`}
            />
          </div>
        )}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-9 w-9 shrink-0 text-muted-foreground hover:text-destructive"
          onClick={onRemove}
          aria-label="Remove this condition"
          data-testid={`button-remove-condition-${index}`}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
      {problem && (
        <p className="text-xs text-destructive" data-testid={`text-condition-value-error-${index}`}>
          {problem}
        </p>
      )}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 gap-1 px-2 text-xs text-muted-foreground"
        onClick={onUsePickers}
        disabled={!canUsePickers}
        title={canUsePickers ? undefined : "Pick a value from the list to use the pickers."}
        data-testid={`button-condition-pickers-${index}`}
      >
        <ListChecks className="h-3.5 w-3.5" />
        {canUsePickers ? "Use the pickers" : "Uses a variable or a value the pickers can't show"}
      </Button>
    </div>
  );
}

/**
 * A condition step's editor. A step may also hold one condition in `condition`, which
 * the engine evaluates before `conditions`; the builder shows it as the first row and
 * moves it into `conditions` on the first edit, which evaluates the same.
 */
export function ConditionStepEditor({
  step,
  sources,
  availableVariables,
  onChange,
}: {
  step: ConditionNode;
  sources: ConditionSources;
  availableVariables: VariableOption[];
  onChange: (step: ConditionNode) => void;
}) {
  const rows = step.condition ? [step.condition, ...step.conditions] : step.conditions;
  // A typed row can reference the viewer's facts too, which computeAvailableVariables
  // does not list since they come from the engine rather than the workflow.
  const typedVariables = useMemo(
    () => [
      ...availableVariables,
      ...sources.fields
        .filter((field) => field.group === VIEWER_GROUP)
        .map((field) => ({
          value: field.ref,
          label: field.label,
          group: VIEWER_GROUP,
          type: field.kind === "number" ? "number" : "string",
          ...(field.description ? { description: field.description } : {}),
        })),
    ],
    [availableVariables, sources.fields]
  );
  return (
    <ConditionBuilder
      conditions={rows}
      logic={step.conditionLogic}
      onChange={(conditions, logic) => {
        const { condition: _folded, conditionLogic: _logic, ...rest } = step;
        // "and" is the engine's default, so a step that never named one keeps not naming it.
        const keepsDefault = logic === "and" && step.conditionLogic === undefined;
        onChange({ ...rest, conditions, ...(keepsDefault ? {} : { conditionLogic: logic }) });
      }}
      fields={sources.fields}
      namesViewer={sources.namesViewer}
      viewerFacts={sources.support.viewerFacts}
      listReferences={sources.support.listReferences}
      availableVariables={typedVariables}
    />
  );
}
