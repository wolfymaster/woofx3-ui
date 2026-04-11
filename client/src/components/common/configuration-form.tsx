import { type ReactNode, useCallback, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

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
              onChange={(e) =>
                onChange({ ...configValue, min: e.target.value ? Number(e.target.value) : field.min })
              }
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
              onChange={(e) =>
                onChange({ ...configValue, max: e.target.value ? Number(e.target.value) : field.max })
              }
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
            onChange={(e) =>
              onChange({ ...configValue, value: e.target.value ? Number(e.target.value) : field.min })
            }
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

function TextFieldRenderer({ field, value, onChange }: FieldRendererProps) {
  return (
    <div className="space-y-2">
      <Label htmlFor={field.id}>
        {field.label}
        {field.required && <span className="text-destructive ml-0.5">*</span>}
      </Label>
      <Input
        id={field.id}
        value={(value as string) ?? ""}
        onChange={(e) => onChange(e.target.value)}
        placeholder={field.placeholder}
        data-testid={`input-${field.id}`}
      />
      {field.hint && <p className="text-xs text-muted-foreground">{field.hint}</p>}
    </div>
  );
}

function TextareaFieldRenderer({ field, value, onChange }: FieldRendererProps) {
  return (
    <div className="space-y-2">
      <Label htmlFor={field.id}>
        {field.label}
        {field.required && <span className="text-destructive ml-0.5">*</span>}
      </Label>
      <Textarea
        id={field.id}
        value={(value as string) ?? ""}
        onChange={(e) => onChange(e.target.value)}
        placeholder={field.placeholder}
        rows={3}
        data-testid={`textarea-${field.id}`}
      />
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
  text: TextFieldRenderer,
  textarea: TextareaFieldRenderer,
  select: SelectFieldRenderer,
  toggle: ToggleFieldRenderer,
};

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
  className?: string;
}

export function ConfigurationForm({
  fields,
  values,
  onChange,
  onSubmit,
  submitLabel = "Save",
  customRenderers,
  className,
}: ConfigurationFormProps) {
  const [validationError, setValidationError] = useState<string | null>(null);

  const handleFieldChange = useCallback(
    (fieldId: string, value: unknown) => {
      setValidationError(null);
      onChange({ ...values, [fieldId]: value });
    },
    [values, onChange],
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

        // Check custom renderers first
        if (customRenderers?.[field.type]) {
          return (
            <div key={field.id}>{customRenderers[field.type]({ field, value: fieldValue, onChange: changeHandler })}</div>
          );
        }

        // Fallback to builtins
        const BuiltinRenderer = builtinRenderers[field.type];
        if (BuiltinRenderer) {
          return <BuiltinRenderer key={field.id} field={field} value={fieldValue} onChange={changeHandler} />;
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
