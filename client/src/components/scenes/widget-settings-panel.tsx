import type { ConfigField } from "@woofx3/api/ui-schema";
import {
  ConfigurationForm,
  type CustomFieldRenderer,
  type FieldDescriptor,
} from "@/components/common/configuration-form";
import { fieldOptionsOwnerFromCanonicalId, withFieldOptionsOwner } from "@/lib/field-options-reference";
import { withWidgetCanonicalId } from "@/lib/parse-config-fields";
import type { VariableOption } from "@/lib/workflow-variables";

interface WidgetSettingsFormProps {
  /** The widget's canonical id, `{moduleId}:widget:{manifestId}`. */
  widgetCanonicalId: string;
  settings: Record<string, unknown>;
  fields: ConfigField[];
  renderers: Record<string, CustomFieldRenderer>;
  availableVariables?: VariableOption[];
  onChangeSetting: (key: string, value: unknown) => void;
}

/**
 * A widget's settings, drawn from its schema. The scene editor and the alert editor both
 * use it, so a widget shows the same fields wherever it is placed. It is the Settings
 * pane of the inspector; transitions and effects are separate panes beside it.
 */
export function WidgetSettingsForm({
  widgetCanonicalId,
  settings,
  fields,
  renderers,
  availableVariables,
  onChangeSetting,
}: WidgetSettingsFormProps) {
  if (fields.length === 0) {
    return <p className="text-xs text-muted-foreground">This widget has no configurable settings.</p>;
  }
  return (
    <ConfigurationForm
      // A widget's settings are ConfigFields, exactly like a trigger's
      // config, so they render through the same form rather than a
      // parallel one that supported a narrower set of types. That is
      // what gives a widget `resource_ref` pickers, `required`,
      // `description` and hints for free.
      fields={
        withFieldOptionsOwner(
          withWidgetCanonicalId(fields, widgetCanonicalId),
          fieldOptionsOwnerFromCanonicalId(widgetCanonicalId)
        ) as unknown as FieldDescriptor[]
      }
      values={settings}
      onChange={(next) => {
        for (const field of fields) {
          if (next[field.id] !== settings[field.id]) {
            onChangeSetting(field.id, next[field.id]);
          }
        }
      }}
      customRenderers={renderers}
      availableVariables={availableVariables}
    />
  );
}
