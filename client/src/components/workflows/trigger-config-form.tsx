import {
  ConfigurationForm,
  type CustomFieldRenderer,
  type FieldDescriptor,
} from "@/components/common/configuration-form";
import { configFieldRenderers } from "@/components/common/field-renderers";
import type { ConfigField, TriggerConfigValues } from "@/lib/workflow-presets";
import type { VariableOption } from "@/lib/workflow-variables";

// ---------------------------------------------------------------------------
// TriggerConfigForm — thin wrapper around ConfigurationForm
// ---------------------------------------------------------------------------

interface TriggerConfigFormProps {
  fields: ConfigField[];
  values: TriggerConfigValues;
  onChange: (values: TriggerConfigValues) => void;
  /** Variables offered for {variable} references — see computeAvailableVariables. */
  availableVariables?: VariableOption[];
  /** For trigger conditions — see ConfigurationForm's `allowAny`. */
  allowAny?: boolean;
  /**
   * Replaces the shared renderer for a key, for a surface that shows a field its own way:
   * the triggers page shows an alert's layout as a preview that links to the alert editor.
   */
  rendererOverrides?: Record<string, CustomFieldRenderer>;
  className?: string;
}

export function TriggerConfigForm({
  fields,
  values,
  onChange,
  availableVariables,
  allowAny,
  rendererOverrides,
  className,
}: TriggerConfigFormProps) {
  return (
    <ConfigurationForm
      // ConfigField has a narrower, intentional shape (see workflow-presets);
      // FieldDescriptor is ConfigurationForm's structural superset. The cast
      // is a runtime no-op — every ConfigField already satisfies the renderer
      // requirements.
      fields={fields as unknown as FieldDescriptor[]}
      values={values as Record<string, unknown>}
      onChange={(v) => onChange(v as TriggerConfigValues)}
      customRenderers={rendererOverrides ? { ...configFieldRenderers, ...rendererOverrides } : configFieldRenderers}
      availableVariables={availableVariables}
      allowAny={allowAny}
      className={className}
    />
  );
}
