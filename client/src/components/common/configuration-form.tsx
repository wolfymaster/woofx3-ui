import { api } from "@convex/_generated/api";
import type { InternalConfigFieldSource } from "@woofx3/api/ui-schema";
import { useQuery } from "convex/react";
import { Braces } from "lucide-react";
import { type ReactNode, useCallback, useMemo, useState } from "react";
import { ConfigFieldDescription, ConfigFieldLabel } from "@/components/common/config-field-label";
import { VariableAwareInput } from "@/components/common/variable-aware-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useFieldOptions } from "@/hooks/use-field-options";
import { useInstance } from "@/hooks/use-instance";
import { commandNameToSubjectSegment } from "@/lib/command-slug";
import { cn } from "@/lib/utils";
import type { VariableOption } from "@/lib/workflow-variables";

// ---------------------------------------------------------------------------
// Field descriptor — intentionally a superset of workflow-presets ConfigField
// so the component can be used with or without that module.
// ---------------------------------------------------------------------------

export interface FieldDescriptor {
  id: string;
  label: string;
  type: string; // "text" | "number" | "range" | "select" | "toggle" | "textarea" | custom
  required?: boolean;
  placeholder?: string;
  unit?: string;
  options?: { value: string; label: string }[];
  min?: number;
  max?: number;
  defaultValue?: unknown;
  /** Hint rendered below the field. */
  hint?: string;
  description?: string;
  examplePayload?: string;
  /** Media subtype hint for media-type fields. */
  mediaType?: "image" | "audio" | "video";
  /** Allow arbitrary extra properties for custom field renderers. */
  [key: string]: unknown;
}

export type FieldValues = Record<string, unknown>;

export interface RangeValue {
  type: "single" | "range";
  value?: number;
  min?: number;
  max?: number;
}

// ---------------------------------------------------------------------------
// Individual field renderers
// ---------------------------------------------------------------------------

interface FieldRendererProps {
  field: FieldDescriptor;
  value: unknown;
  onChange: (value: unknown) => void;
}

function NumberFieldRenderer({ field, value, onChange }: FieldRendererProps) {
  return (
    <div className="space-y-2">
      <Label htmlFor={field.id}>
        {field.label}
        {field.required && <span className="text-destructive ml-0.5">*</span>}
      </Label>
      <div className="flex items-center gap-2">
        <Input
          id={field.id}
          type="number"
          min={field.min}
          max={field.max}
          value={(value as number | string) ?? ""}
          onChange={(e) => onChange(e.target.value ? Number(e.target.value) : "")}
          placeholder={field.placeholder}
          className="flex-1"
          data-testid={`input-${field.id}`}
        />
        {field.unit && <span className="text-sm text-muted-foreground whitespace-nowrap">{field.unit}</span>}
      </div>
      {field.hint && <p className="text-xs text-muted-foreground">{field.hint}</p>}
    </div>
  );
}

function RangeFieldRenderer({ field, value, onChange }: FieldRendererProps) {
  const configValue = (value as RangeValue) || { type: "single", value: field.min ?? 1 };
  const isRange = configValue.type === "range";

  const handleModeChange = (useRange: boolean) => {
    if (useRange) {
      onChange({
        type: "range",
        min: configValue.value ?? field.min ?? 1,
        max: (configValue.value ?? field.min ?? 1) + 10,
      });
    } else {
      onChange({
        type: "single",
        value: configValue.min ?? configValue.value ?? field.min ?? 1,
      });
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label>
          {field.label}
          {field.required && <span className="text-destructive ml-0.5">*</span>}
        </Label>
        <div className="flex items-center gap-2">
          <span className={cn("text-xs", !isRange && "text-foreground", isRange && "text-muted-foreground")}>
            Exact
          </span>
          <Switch checked={isRange} onCheckedChange={handleModeChange} data-testid={`switch-range-${field.id}`} />
          <span className={cn("text-xs", isRange && "text-foreground", !isRange && "text-muted-foreground")}>
            Range
          </span>
        </div>
      </div>

      {isRange ? (
        <div className="flex items-center gap-2">
          <div className="flex-1">
            <Input
              type="number"
              min={field.min}
              max={field.max}
              value={configValue.min ?? ""}
              onChange={(e) => onChange({ ...configValue, min: e.target.value ? Number(e.target.value) : field.min })}
              placeholder="Min"
              data-testid={`input-${field.id}-min`}
            />
          </div>
          <span className="text-muted-foreground">to</span>
          <div className="flex-1">
            <Input
              type="number"
              min={field.min}
              max={field.max}
              value={configValue.max ?? ""}
              onChange={(e) => onChange({ ...configValue, max: e.target.value ? Number(e.target.value) : field.max })}
              placeholder="Max"
              data-testid={`input-${field.id}-max`}
            />
          </div>
          {field.unit && <span className="text-sm text-muted-foreground whitespace-nowrap">{field.unit}</span>}
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <Input
            type="number"
            min={field.min}
            max={field.max}
            value={configValue.value ?? ""}
            onChange={(e) => onChange({ ...configValue, value: e.target.value ? Number(e.target.value) : field.min })}
            placeholder={field.placeholder}
            className="flex-1"
            data-testid={`input-${field.id}`}
          />
          {field.unit && <span className="text-sm text-muted-foreground whitespace-nowrap">{field.unit}</span>}
        </div>
      )}
      {field.hint && <p className="text-xs text-muted-foreground">{field.hint}</p>}
    </div>
  );
}

function SelectFieldRenderer({ field, value, onChange }: FieldRendererProps) {
  return (
    <div className="space-y-2">
      <Label>
        {field.label}
        {field.required && <span className="text-destructive ml-0.5">*</span>}
      </Label>
      <Select value={(value as string) ?? ""} onValueChange={onChange}>
        <SelectTrigger data-testid={`select-${field.id}`}>
          <SelectValue placeholder={field.placeholder ?? `Select ${field.label.toLowerCase()}...`} />
        </SelectTrigger>
        <SelectContent>
          {field.options?.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {field.hint && <p className="text-xs text-muted-foreground">{field.hint}</p>}
    </div>
  );
}

// Dynamic-source select: populated from the current instance's chatCommands
// table. The saved value is a NATS subject slug (not the raw "!command"
// string) so downstream code can assemble `chat.command.${value}` verbatim.
function CommandsSelectFieldRenderer({ field, value, onChange }: FieldRendererProps) {
  const { instance } = useInstance();
  const instanceId = instance?._id;
  const commands = useQuery(api.chatCommands.list, instanceId ? { instanceId } : "skip");

  const options = useMemo(() => {
    if (!commands) {
      return [];
    }
    const out: { value: string; label: string }[] = [];
    for (const cmd of commands) {
      // Guard against malformed names so a single bad row does not break
      // the whole dropdown; the helper throws on NATS-reserved chars.
      try {
        out.push({ value: commandNameToSubjectSegment(cmd.command), label: cmd.command });
      } catch {}
    }
    return out;
  }, [commands]);

  if (!instanceId) {
    // eslint-disable-next-line no-console
    console.warn(`[ConfigurationForm] field "${field.id}" uses source.kind=commands but no instance is selected`);
  }

  const loading = !!instanceId && commands === undefined;
  const empty = !loading && options.length === 0;
  const disabled = !instanceId || loading || empty;

  let placeholder: string;
  if (!instanceId) {
    placeholder = "No instance selected";
  } else if (loading) {
    placeholder = "Loading commands...";
  } else if (empty) {
    placeholder = "No commands yet — create one in the Commands page";
  } else {
    placeholder = field.placeholder ?? `Select ${field.label.toLowerCase()}...`;
  }

  return (
    <div className="space-y-2">
      <Label>
        {field.label}
        {field.required && <span className="text-destructive ml-0.5">*</span>}
      </Label>
      <Select value={(value as string) ?? ""} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger data-testid={`select-${field.id}`}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {field.hint && <p className="text-xs text-muted-foreground">{field.hint}</p>}
    </div>
  );
}

function InternalSelectFieldRenderer({
  field,
  value,
  onChange,
  source,
}: FieldRendererProps & { source: InternalConfigFieldSource }) {
  const { instance } = useInstance();
  const { options, loading, empty } = useFieldOptions(instance?._id, source);

  const disabled = loading || empty;
  let placeholder: string;
  if (loading) {
    placeholder = "Loading options...";
  } else if (empty) {
    placeholder = "No options available";
  } else {
    placeholder = field.placeholder ?? `Select ${field.label.toLowerCase()}...`;
  }

  return (
    <div className="space-y-2">
      <ConfigFieldLabel
        label={field.label}
        required={field.required}
        hint={field.hint as string | undefined}
        examplePayload={field.examplePayload as string | undefined}
      />
      <Select value={(value as string) ?? ""} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger data-testid={`select-${field.id}`}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <ConfigFieldDescription description={field.description as string | undefined} />
    </div>
  );
}

function ColorFieldRenderer({ field, value, onChange }: FieldRendererProps) {
  return (
    <div className="space-y-2">
      <ConfigFieldLabel
        htmlFor={field.id}
        label={field.label}
        required={field.required}
        hint={field.hint as string | undefined}
        examplePayload={field.examplePayload as string | undefined}
      />
      <Input
        id={field.id}
        type="color"
        value={(value as string) || "#000000"}
        onChange={(e) => onChange(e.target.value)}
        className="h-10 w-20"
        data-testid={`input-${field.id}`}
      />
      <ConfigFieldDescription description={field.description as string | undefined} />
    </div>
  );
}

function ToggleFieldRenderer({ field, value, onChange }: FieldRendererProps) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <Label htmlFor={field.id}>{field.label}</Label>
        <Switch
          id={field.id}
          checked={(value as boolean) ?? false}
          onCheckedChange={onChange}
          data-testid={`switch-${field.id}`}
        />
      </div>
      {field.hint && <p className="text-xs text-muted-foreground">{field.hint}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Built-in renderer registry
// ---------------------------------------------------------------------------

const builtinRenderers: Record<string, React.ComponentType<FieldRendererProps>> = {
  number: NumberFieldRenderer,
  range: RangeFieldRenderer,
  select: SelectFieldRenderer,
  toggle: ToggleFieldRenderer,
  color: ColorFieldRenderer,
};

// ---------------------------------------------------------------------------
// Variable references (${stepId.field}) — every field type can be pointed at a
// previous step's output instead of holding a fixed value. text/textarea handle this
// inline (VariableAwareInput lets literal text and ${} references mix freely); every
// other type gets a toggle that swaps its normal typed control for a raw ${} input.
// ---------------------------------------------------------------------------

/** What a field reverts to when toggled out of variable mode — mirrors workflow-presets.ts's
 * getDefaultConfigValues, kept separate since this component has no workflow-specific import. */
function defaultValueForField(field: FieldDescriptor): unknown {
  if (field.defaultValue !== undefined) {
    return field.defaultValue;
  }
  if (field.type === "range") {
    return { type: "single", value: field.min ?? 1 };
  }
  if (field.type === "number") {
    return field.min ?? 0;
  }
  if (field.type === "toggle") {
    return false;
  }
  return "";
}

function isVariableReference(value: unknown): value is string {
  return typeof value === "string" && value.trim().startsWith("${");
}

function VariableToggleWrapper({
  field,
  value,
  onChange,
  availableVariables,
  children,
}: FieldRendererProps & { availableVariables: VariableOption[]; children: ReactNode }) {
  const variableMode = isVariableReference(value);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => onChange(variableMode ? defaultValueForField(field) : "")}
        className="absolute right-0 top-0 text-muted-foreground hover:text-foreground"
        title={variableMode ? "Use a fixed value" : "Reference a variable instead"}
        data-testid={`button-toggle-variable-${field.id}`}
      >
        <Braces className="h-3.5 w-3.5" />
      </button>
      {variableMode ? (
        <div className="space-y-2 pr-6">
          <Label>
            {field.label}
            {field.required && <span className="text-destructive ml-0.5">*</span>}
          </Label>
          <VariableAwareInput
            value={value as string}
            onChange={onChange}
            availableVariables={availableVariables}
            placeholder="${stepId.field}"
            className="font-mono text-xs"
            data-testid={`input-variable-${field.id}`}
          />
          {field.hint && <p className="text-xs text-muted-foreground">{field.hint}</p>}
        </div>
      ) : (
        <div className="pr-6">{children}</div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validateRequired(fields: FieldDescriptor[], values: FieldValues): string[] {
  const missing: string[] = [];
  for (const field of fields) {
    if (!field.required) {
      continue;
    }
    const v = values[field.id];
    if (v === undefined || v === null || v === "") {
      missing.push(field.label);
    }
  }
  return missing;
}

// ---------------------------------------------------------------------------
// ConfigurationForm
// ---------------------------------------------------------------------------

export type CustomFieldRenderer = (props: {
  field: FieldDescriptor;
  value: unknown;
  onChange: (value: unknown) => void;
}) => ReactNode;

export interface ConfigurationFormProps {
  /** Ordered list of field descriptors. */
  fields: FieldDescriptor[];
  /** Current values keyed by field.id. */
  values: FieldValues;
  /** Called on every individual field change. */
  onChange: (values: FieldValues) => void;
  /**
   * If provided, renders a submit button and validates required fields before calling.
   * Omit for controlled-only usage (no submit button).
   */
  onSubmit?: (values: FieldValues) => void;
  /** Label for the submit button. Defaults to "Save". */
  submitLabel?: string;
  /** Map of field type → custom renderer for types not handled by builtins (e.g. "media"). */
  customRenderers?: Record<string, CustomFieldRenderer>;
  /** Variables offered for ${stepId.field} references — see computeAvailableVariables.
   * Omit outside a workflow-builder context (e.g. module settings); the ${} affordances
   * still work without it, they just won't have anything to suggest. */
  availableVariables?: VariableOption[];
  className?: string;
}

export function ConfigurationForm({
  fields,
  values,
  onChange,
  onSubmit,
  submitLabel = "Save",
  customRenderers,
  availableVariables = [],
  className,
}: ConfigurationFormProps) {
  const [validationError, setValidationError] = useState<string | null>(null);

  const handleFieldChange = useCallback(
    (fieldId: string, value: unknown) => {
      setValidationError(null);
      onChange({ ...values, [fieldId]: value });
    },
    [values, onChange]
  );

  const handleSubmit = useCallback(() => {
    if (!onSubmit) {
      return;
    }
    const missing = validateRequired(fields, values);
    if (missing.length > 0) {
      setValidationError(`Required: ${missing.join(", ")}`);
      return;
    }
    setValidationError(null);
    onSubmit(values);
  }, [fields, values, onSubmit]);

  return (
    <div className={cn("space-y-4", className)}>
      {validationError && (
        <div className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-md px-3 py-2">
          {validationError}
        </div>
      )}

      {fields.map((field) => {
        const fieldValue = values[field.id];
        const changeHandler = (v: unknown) => handleFieldChange(field.id, v);

        // text/textarea mix literal text and ${} references freely in one string, so they
        // never need the toggle below — VariableAwareInput handles both at once.
        if (field.type === "text" || field.type === "textarea") {
          return (
            <div key={field.id} className="space-y-2">
              <Label htmlFor={field.id}>
                {field.label}
                {field.required && <span className="text-destructive ml-0.5">*</span>}
              </Label>
              <VariableAwareInput
                id={field.id}
                value={(fieldValue as string) ?? ""}
                onChange={changeHandler}
                placeholder={field.placeholder}
                multiline={field.type === "textarea"}
                availableVariables={availableVariables}
                data-testid={`input-${field.id}`}
              />
              {field.hint && <p className="text-xs text-muted-foreground">{field.hint}</p>}
            </div>
          );
        }

        // Dynamic-source fields (e.g. chat commands) short-circuit the type
        // lookup: the source dictates the renderer regardless of `type`.
        const source = (field as { source?: { kind?: unknown } }).source;
        if (source && source.kind === "commands") {
          return (
            <VariableToggleWrapper
              key={field.id}
              field={field}
              value={fieldValue}
              onChange={changeHandler}
              availableVariables={availableVariables}
            >
              <CommandsSelectFieldRenderer field={field} value={fieldValue} onChange={changeHandler} />
            </VariableToggleWrapper>
          );
        }
        if (source && source.kind === "internal") {
          return (
            <VariableToggleWrapper
              key={field.id}
              field={field}
              value={fieldValue}
              onChange={changeHandler}
              availableVariables={availableVariables}
            >
              <InternalSelectFieldRenderer
                field={field}
                value={fieldValue}
                onChange={changeHandler}
                source={source as InternalConfigFieldSource}
              />
            </VariableToggleWrapper>
          );
        }

        const rendererType = field.type === "asset" ? "media" : field.type;
        if (customRenderers?.[rendererType]) {
          return (
            <VariableToggleWrapper
              key={field.id}
              field={field}
              value={fieldValue}
              onChange={changeHandler}
              availableVariables={availableVariables}
            >
              {customRenderers[rendererType]({ field, value: fieldValue, onChange: changeHandler })}
            </VariableToggleWrapper>
          );
        }

        const BuiltinRenderer =
          builtinRenderers[field.type] ?? (field.type === "asset" ? builtinRenderers.media : undefined);
        if (BuiltinRenderer) {
          return (
            <VariableToggleWrapper
              key={field.id}
              field={field}
              value={fieldValue}
              onChange={changeHandler}
              availableVariables={availableVariables}
            >
              <BuiltinRenderer field={field} value={fieldValue} onChange={changeHandler} />
            </VariableToggleWrapper>
          );
        }

        // Unknown field type
        return (
          <div key={field.id} className="text-sm text-muted-foreground">
            Unknown field type: {field.type}
          </div>
        );
      })}

      {onSubmit && (
        <Button onClick={handleSubmit} className="w-full" data-testid="button-config-submit">
          {submitLabel}
        </Button>
      )}
    </div>
  );
}
