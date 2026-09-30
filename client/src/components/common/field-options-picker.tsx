import type { InternalConfigFieldSource } from "@woofx3/api/ui-schema";
import { Check, ChevronsUpDown, RefreshCw } from "lucide-react";
import { useId, useState } from "react";
import { ConfigFieldDescription, ConfigFieldLabel } from "@/components/common/config-field-label";
import { VariableAwareInput } from "@/components/common/variable-aware-input";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { type FieldOptionsState, useFieldOptions } from "@/hooks/use-field-options";
import { useInstance } from "@/hooks/use-instance";
import {
  fieldOptionMismatch,
  groupFieldOptions,
  optionValueOfItem,
  selectedItemValue,
  selectItemValue,
} from "@/lib/field-options";
import { cn } from "@/lib/utils";
import type { VariableOption } from "@/lib/workflow-variables";

/** The slice of ConfigurationForm's FieldDescriptor these pickers read. */
interface PickerField {
  id: string;
  label: string;
  required?: boolean;
  placeholder?: string;
  hint?: string;
  description?: string;
  examplePayload?: string;
}

interface PickerProps {
  field: PickerField;
  value: unknown;
  onChange: (value: unknown) => void;
  source: InternalConfigFieldSource;
}

/** Why there is nothing to pick, or null while there is something (or it is still coming). */
function emptyReason(state: FieldOptionsState): string | null {
  if (state.loading) {
    return null;
  }
  if (state.error !== null) {
    return `Could not load options: ${state.error}`;
  }
  if (state.empty) {
    return "No options available.";
  }
  return null;
}

function RefreshButton({ field, state }: { field: PickerField; state: FieldOptionsState }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={`Reload ${field.label.toLowerCase()} options`}
          disabled={state.loading}
          onClick={state.refresh}
          className="shrink-0"
          data-testid={`button-refresh-${field.id}`}
        >
          <RefreshCw className={cn("h-4 w-4", state.loading && "animate-spin")} />
        </Button>
      </TooltipTrigger>
      <TooltipContent>Reload options</TooltipContent>
    </Tooltip>
  );
}

/**
 * A `select` whose options a worker lists: only a listed option can be saved.
 * Options carrying a `group` are listed under its heading.
 */
export function InternalSelectField({ field, value, onChange, source }: PickerProps) {
  const { instance } = useInstance();
  const state = useFieldOptions(instance?._id, source);
  const reason = emptyReason(state);
  const groups = groupFieldOptions(state.options);

  let placeholder: string;
  if (state.loading) {
    placeholder = "Loading options...";
  } else if (state.empty) {
    placeholder = "No options available";
  } else {
    placeholder = field.placeholder ?? `Select ${field.label.toLowerCase()}...`;
  }

  return (
    <div className="space-y-2">
      <ConfigFieldLabel
        label={field.label}
        required={field.required}
        hint={field.hint}
        examplePayload={field.examplePayload}
      />
      <div className="flex items-center gap-2">
        <Select
          value={selectedItemValue(value, groups)}
          onValueChange={(itemValue) => {
            const picked = optionValueOfItem(itemValue, groups);
            if (picked !== undefined) {
              onChange(picked);
            }
          }}
          disabled={state.loading || state.empty}
        >
          <SelectTrigger data-testid={`select-${field.id}`}>
            <SelectValue placeholder={placeholder} />
          </SelectTrigger>
          <SelectContent>
            {groups.map((group) => (
              <SelectGroup key={group.heading ?? ""}>
                {group.heading !== null && <SelectLabel>{group.heading}</SelectLabel>}
                {group.options.map((opt) => (
                  <SelectItem key={opt.value} value={selectItemValue(group.heading, opt.value)}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>
        <RefreshButton field={field} state={state} />
      </div>
      {reason !== null && (
        <p className="text-xs text-muted-foreground" data-testid={`status-${field.id}`}>
          {reason}
        </p>
      )}
      <ConfigFieldDescription description={field.description} />
    </div>
  );
}

/**
 * Items carry a value unique to their heading (the same name can be listed
 * under several, and cmdk treats equal values as one item), so search matches
 * the option's label and value, passed as its keywords, rather than that value.
 */
function filterByKeywords(_value: string, search: string, keywords?: string[]): number {
  const needle = search.toLowerCase();
  return (keywords ?? []).some((keyword) => keyword.toLowerCase().includes(needle)) ? 1 : 0;
}

/**
 * A `text` field whose options a worker lists, offered as suggestions. Typing
 * stays open, so a variable, or a value the worker cannot list right now (it is
 * offline, or the thing is not made yet), can be saved; a typed value that is
 * not listed is flagged rather than refused.
 */
export function InternalSuggestField({
  field,
  value,
  onChange,
  source,
  availableVariables,
}: PickerProps & { availableVariables: VariableOption[] }) {
  const { instance } = useInstance();
  const state = useFieldOptions(instance?._id, source);
  const [open, setOpen] = useState(false);
  const listId = useId();
  const noticeId = useId();

  const text = typeof value === "string" ? value : "";
  const groups = groupFieldOptions(state.options);
  const warning = state.loading ? null : fieldOptionMismatch(text, state.options);
  const reason = emptyReason(state);

  return (
    <div className="space-y-2">
      <ConfigFieldLabel
        htmlFor={field.id}
        label={field.label}
        required={field.required}
        hint={field.hint}
        examplePayload={field.examplePayload}
      />
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <VariableAwareInput
            id={field.id}
            value={text}
            onChange={onChange}
            placeholder={field.placeholder}
            availableVariables={availableVariables}
            aria-describedby={noticeId}
            data-testid={`input-${field.id}`}
          />
        </div>
        <Popover open={open} onOpenChange={setOpen}>
          <Tooltip>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  role="combobox"
                  aria-expanded={open}
                  aria-haspopup="listbox"
                  aria-controls={listId}
                  aria-label={`Pick ${field.label.toLowerCase()}`}
                  disabled={!instance}
                  className="shrink-0"
                  data-testid={`button-pick-${field.id}`}
                >
                  <ChevronsUpDown className="h-4 w-4 opacity-50" />
                </Button>
              </PopoverTrigger>
            </TooltipTrigger>
            <TooltipContent>Pick from the list</TooltipContent>
          </Tooltip>
          <PopoverContent align="end" className="w-72 p-0">
            <Command filter={filterByKeywords}>
              <CommandInput placeholder="Search..." />
              <CommandList id={listId}>
                <CommandEmpty>
                  {state.loading ? "Loading options..." : state.empty ? (reason ?? "Nothing to pick.") : "No matches."}
                </CommandEmpty>
                {groups.map((group) => (
                  <CommandGroup key={group.heading ?? ""} heading={group.heading ?? undefined}>
                    {group.options.map((option) => (
                      <CommandItem
                        key={option.value}
                        value={selectItemValue(group.heading, option.value)}
                        keywords={[option.label, option.value]}
                        onSelect={() => {
                          onChange(option.value);
                          setOpen(false);
                        }}
                      >
                        <Check className={cn("h-4 w-4", option.value === text ? "opacity-100" : "opacity-0")} />
                        {option.label}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                ))}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
        <RefreshButton field={field} state={state} />
      </div>
      <output id={noticeId} className="block space-y-1">
        {warning !== null && (
          <p className="text-xs text-amber-600 dark:text-amber-300" data-testid={`warning-${field.id}`}>
            {warning}
          </p>
        )}
        {reason !== null && (
          <p className="text-xs text-muted-foreground" data-testid={`status-${field.id}`}>
            {reason} The value can still be typed.
          </p>
        )}
      </output>
      <ConfigFieldDescription description={field.description} />
    </div>
  );
}
