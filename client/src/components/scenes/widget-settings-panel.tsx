import type { ConfigField } from "@woofx3/api/ui-schema";
import { Trash2 } from "lucide-react";
import { ConfigurationForm, type FieldDescriptor } from "@/components/common/configuration-form";
import { Button } from "@/components/ui/button";
import { configFieldRenderers } from "@/components/workflows/trigger-config-form";
import type { Widget } from "@/types";

interface WidgetSettingsPanelProps {
  widget: Widget;
  fields: ConfigField[];
  onChangeSetting: (key: string, value: unknown) => void;
  onDelete: () => void;
}

/** Right-side settings pane for the currently-selected canvas widget — replaces the old
 * gear-icon popover so configuring a widget doesn't require hunting for a tiny trigger. */
export function WidgetSettingsPanel({ widget, fields, onChangeSetting, onDelete }: WidgetSettingsPanelProps) {
  return (
    <div className="w-80 shrink-0 border-l bg-background flex flex-col">
      <div className="p-4 border-b flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium truncate">{widget.name}</p>
          <p className="text-[11px] text-muted-foreground font-mono break-all">{widget.widgetCanonicalId}</p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-destructive hover:text-destructive shrink-0"
          onClick={onDelete}
          data-testid="button-delete-widget"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
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
            fields={fields as unknown as FieldDescriptor[]}
            values={widget.settings}
            onChange={(next) => {
              for (const field of fields) {
                if (next[field.id] !== widget.settings[field.id]) {
                  onChangeSetting(field.id, next[field.id]);
                }
              }
            }}
            customRenderers={configFieldRenderers}
          />
        )}
      </div>
    </div>
  );
}
