import type { ConfigField } from "@woofx3/api/ui-schema";
import { ChevronDown, Loader2 } from "lucide-react";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { TriggerConfigForm } from "@/components/workflows/trigger-config-form";
import type { FieldOption } from "@/hooks/use-field-options";
import type { SentencePart } from "@/lib/condition-sentence";
import { cn } from "@/lib/utils";
import type { TriggerConfigValues } from "@/lib/workflow-presets";
import { ANY_CONDITION } from "@/lib/workflow-presets-json";

/** Options for a field whose list loads at runtime, as the page loaded them. */
export interface LoadedFieldOptions {
  options: FieldOption[];
  loading: boolean;
  error: string | null;
}

/** Past this many options a row of pills stops being scannable, and the picker searches instead. */
const PILL_LIMIT = 6;

interface ConditionSentenceProps {
  parts: SentencePart[];
  fields: ConfigField[];
  values: TriggerConfigValues;
  loadedOptions: ReadonlyMap<string, LoadedFieldOptions>;
  /** The field whose picker is open; the sentence is the only place a condition is edited. */
  openFieldId: string | null;
  onOpenFieldChange: (fieldId: string | null) => void;
  onChangeValue: (fieldId: string, value: unknown) => void;
}

/**
 * A trigger's condition sentence, where each value is a button that opens a picker for
 * it. This is where conditions are edited, so the sentence both states what the
 * trigger waits for and is the control that changes it.
 */
export function ConditionSentence({
  parts,
  fields,
  values,
  loadedOptions,
  openFieldId,
  onOpenFieldChange,
  onChangeValue,
}: ConditionSentenceProps) {
  return (
    <span className="text-base font-medium leading-snug">
      {parts.map((part, index) => {
        const key = `${index}-${part.kind === "field" ? part.fieldId : part.text}`;
        if (part.kind === "text") {
          return <span key={key}>{part.text}</span>;
        }
        const field = fields.find((candidate) => candidate.id === part.fieldId);
        if (!field) {
          return <span key={key}>{part.text}</span>;
        }
        return (
          <Popover
            key={key}
            open={openFieldId === field.id}
            onOpenChange={(open) => onOpenFieldChange(open ? field.id : null)}
          >
            <PopoverTrigger asChild>
              <button
                type="button"
                className={cn(
                  "relative z-10 -mx-1 inline-flex items-baseline gap-0.5 rounded-md px-1 hover:bg-accent",
                  part.state === "missing" ? "text-amber-600 dark:text-amber-300" : "text-primary-text"
                )}
                aria-label={`${field.label}: ${part.text}. Change`}
                data-testid={`condition-value-${field.id}`}
              >
                {part.text}
                <ChevronDown className="h-3.5 w-3.5 self-center opacity-70" aria-hidden="true" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-80 p-0">
              <ConditionValueEditor
                field={field}
                value={values[field.id]}
                loaded={loadedOptions.get(field.id)}
                onChange={(value) => onChangeValue(field.id, value)}
                onChosen={() => onOpenFieldChange(null)}
              />
            </PopoverContent>
          </Popover>
        );
      })}
    </span>
  );
}

interface ConditionValueEditorProps {
  field: ConfigField;
  value: unknown;
  loaded: LoadedFieldOptions | undefined;
  onChange: (value: unknown) => void;
  /** Called once a choice settles the field, so the picker can close. */
  onChosen: () => void;
}

/**
 * Choice fields get a picker of their own: pills while the list is short, a search past
 * PILL_LIMIT, with Any alongside the options. Every other field type reuses the form's
 * control for it, which already knows numbers, ranges and toggles and has its own Any.
 */
function ConditionValueEditor({ field, value, loaded, onChange, onChosen }: ConditionValueEditorProps) {
  if (field.type !== "select") {
    return (
      <div className="p-4">
        <TriggerConfigForm
          fields={[field]}
          values={{ [field.id]: value as TriggerConfigValues[string] }}
          onChange={(next) => onChange(next[field.id])}
          allowAny
        />
      </div>
    );
  }

  const options = field.options ?? loaded?.options ?? [];
  const anyLabel = `Any ${field.label.toLowerCase()}`;
  const choose = (next: unknown) => {
    onChange(next);
    onChosen();
  };

  if (!field.options && loaded?.loading) {
    return (
      <p className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading {field.label.toLowerCase()} options…
      </p>
    );
  }
  if (!field.options && loaded?.error) {
    return <p className="p-4 text-sm text-destructive">{loaded.error}</p>;
  }

  if (options.length > PILL_LIMIT) {
    return (
      <Command>
        <CommandInput placeholder={`Search ${field.label.toLowerCase()}`} />
        <CommandList className="max-h-64">
          <CommandEmpty>Nothing matches.</CommandEmpty>
          {options.map((option) => (
            <CommandItem
              key={option.value}
              value={`${option.label} ${option.value}`}
              onSelect={() => choose(option.value)}
              aria-selected={value === option.value}
            >
              <span className={cn("truncate", value === option.value && "font-medium text-primary-text")}>
                {option.label}
              </span>
            </CommandItem>
          ))}
          <CommandItem value={anyLabel} onSelect={() => choose(ANY_CONDITION)}>
            <span className={cn(value === ANY_CONDITION && "font-medium text-primary-text")}>{anyLabel}</span>
          </CommandItem>
        </CommandList>
      </Command>
    );
  }

  return (
    <div className="space-y-2 p-3">
      <p className="px-1 text-xs text-muted-foreground">{field.label}</p>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <Pill key={option.value} isPressed={value === option.value} onClick={() => choose(option.value)}>
            {option.label}
          </Pill>
        ))}
        <Pill isPressed={value === ANY_CONDITION} onClick={() => choose(ANY_CONDITION)}>
          {anyLabel}
        </Pill>
      </div>
      {options.length === 0 && <p className="px-1 text-xs text-muted-foreground">There are no options to pick yet.</p>}
    </div>
  );
}

function Pill({ isPressed, onClick, children }: { isPressed: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      aria-pressed={isPressed}
      onClick={onClick}
      className={cn(
        "min-h-9 rounded-full border px-3 text-sm",
        isPressed ? "border-primary bg-primary text-primary-foreground" : "hover:border-foreground/30 hover:bg-accent"
      )}
    >
      {children}
    </button>
  );
}
