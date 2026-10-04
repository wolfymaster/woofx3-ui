import type { ConfigField } from "@woofx3/api/ui-schema";
import {
  ConfigurationForm,
  type CustomFieldRenderer,
  type FieldDescriptor,
} from "@/components/common/configuration-form";
import { fieldOptionsOwnerFromCanonicalId, withFieldOptionsOwner } from "@/lib/field-options-reference";
import { withWidgetCanonicalId } from "@/lib/parse-config-fields";
import type { VariableOption } from "@/lib/workflow-variables";
import type { Widget } from "@/types";

interface WidgetSettingsPanelProps {
  widget: Widget;
  fields: ConfigField[];
  renderers: Record<string, CustomFieldRenderer>;
  availableVariables?: VariableOption[];
  onChangeSetting: (key: string, value: unknown) => void;
}

/** Right-side settings pane for the currently-selected canvas widget. */
export function WidgetSettingsPanel({
  widget,
  fields,
  renderers,
  availableVariables,
  onChangeSetting,
}: WidgetSettingsPanelProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 overflow-y-auto p-4">
        {fields.length === 0 ? (
          <p className="text-xs text-muted-foreground">This widget has no configurable settings.</p>
        ) : (
          <ConfigurationForm
            // A widget's settings are ConfigFields, exactly like a trigger's
            // config, so they render through the same form rather than a
            // parallel one that supported a narrower set of types. That is
            // what gives a widget `resource_ref` pickers, `required`,
            // `description` and hints for free.
            fields={
              withFieldOptionsOwner(
                withWidgetCanonicalId(fields, widget.widgetCanonicalId),
                fieldOptionsOwnerFromCanonicalId(widget.widgetCanonicalId)
              ) as unknown as FieldDescriptor[]
            }
            values={widget.settings}
            onChange={(next) => {
              for (const field of fields) {
                if (next[field.id] !== widget.settings[field.id]) {
                  onChangeSetting(field.id, next[field.id]);
                }
              }
            }}
            customRenderers={renderers}
            availableVariables={availableVariables}
          />
        )}
      </div>
    </div>
  );
}
