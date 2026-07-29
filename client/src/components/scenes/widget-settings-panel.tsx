import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { Widget } from "@/types";

interface WidgetSettingField {
  key: string;
  fieldType: string;
  label: string;
  defaultValue: unknown;
  options?: Array<{ label: string; value: string }>;
}

interface WidgetSettingsFormProps {
  fields: WidgetSettingField[];
  settings: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
}

function WidgetSettingsForm({ fields, settings, onChange }: WidgetSettingsFormProps) {
  if (fields.length === 0) {
    return <p className="text-xs text-muted-foreground">This widget has no configurable settings.</p>;
  }

  return (
    <div className="space-y-4">
      {fields.map((field) => {
        const current = settings[field.key] ?? field.defaultValue;
        const type = field.fieldType.toLowerCase();

        if (type === "boolean" || type === "toggle") {
          return (
            <div key={field.key} className="flex items-center justify-between">
              <Label className="text-xs">{field.label}</Label>
              <Switch
                checked={Boolean(current)}
                onCheckedChange={(v) => onChange(field.key, v)}
                data-testid={`setting-${field.key}`}
              />
            </div>
          );
        }

        if (type === "select" && field.options) {
          return (
            <div key={field.key} className="space-y-1">
              <Label className="text-xs">{field.label}</Label>
              <Select value={String(current ?? "")} onValueChange={(v) => onChange(field.key, v)}>
                <SelectTrigger data-testid={`setting-${field.key}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {field.options.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          );
        }

        if (type === "color") {
          return (
            <div key={field.key} className="space-y-1">
              <Label className="text-xs">{field.label}</Label>
              <Input
                type="color"
                value={String(current ?? "#000000")}
                onChange={(e) => onChange(field.key, e.target.value)}
                className="h-9 w-full p-1"
                data-testid={`setting-${field.key}`}
              />
            </div>
          );
        }

        if (type === "number") {
          return (
            <div key={field.key} className="space-y-1">
              <Label className="text-xs">{field.label}</Label>
              <Input
                type="number"
                value={current === undefined || current === null ? "" : Number(current)}
                onChange={(e) => onChange(field.key, e.target.value === "" ? null : Number(e.target.value))}
                data-testid={`setting-${field.key}`}
              />
            </div>
          );
        }

        if (type === "textarea") {
          return (
            <div key={field.key} className="space-y-1">
              <Label className="text-xs">{field.label}</Label>
              <Textarea
                value={String(current ?? "")}
                onChange={(e) => onChange(field.key, e.target.value)}
                data-testid={`setting-${field.key}`}
              />
            </div>
          );
        }

        return (
          <div key={field.key} className="space-y-1">
            <Label className="text-xs">{field.label}</Label>
            <Input
              value={String(current ?? "")}
              onChange={(e) => onChange(field.key, e.target.value)}
              data-testid={`setting-${field.key}`}
            />
          </div>
        );
      })}
    </div>
  );
}

interface WidgetSettingsPanelProps {
  widget: Widget;
  fields: WidgetSettingField[];
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
        <WidgetSettingsForm fields={fields} settings={widget.settings} onChange={onChangeSetting} />
      </div>
    </div>
  );
}
