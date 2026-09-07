import { Trash2, Upload, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { AssetLibraryModal, type SelectedAsset } from "@/components/workflows/asset-library-modal";
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

/** Value shape persisted for an asset-valued setting. Matches the workflow
 *  MediaFieldRenderer so a widget and a trigger store an asset identically. */
interface AssetSettingValue {
  id: string;
  name: string;
  url: string;
  type: string;
}

/**
 * Asset-valued widget setting. Mirrors the `field.type === "asset"` → "media"
 * convention already used by configuration-form.tsx for workflow config, and
 * opens the same picker, so a scene widget and a trigger behave the same way.
 */
function AssetSettingField({
  field,
  value,
  onChange,
}: {
  field: WidgetSettingField;
  value: AssetSettingValue | null;
  onChange: (value: unknown) => void;
}) {
  const [open, setOpen] = useState(false);
  const mediaType = field.fieldType.toLowerCase().replace(/^(asset|media)[:_-]?/, "");
  const filterTypes = ["image", "video", "audio"].includes(mediaType) ? [mediaType] : undefined;

  const handleSelect = (asset: SelectedAsset) => {
    onChange({ id: asset.id, name: asset.name, url: asset.url, type: asset.type });
  };

  return (
    <div className="space-y-1">
      <Label className="text-xs">{field.label}</Label>
      {value ? (
        <Card className="p-2 flex items-center justify-between gap-2">
          <span className="text-xs truncate" title={value.name}>
            {value.name}
          </span>
          <div className="flex items-center gap-1 shrink-0">
            <Button variant="ghost" size="sm" onClick={() => setOpen(true)} data-testid={`setting-change-${field.key}`}>
              Change
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => onChange(null)}
              aria-label={`Clear ${field.label}`}
              data-testid={`setting-clear-${field.key}`}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </Card>
      ) : (
        <Button
          variant="outline"
          size="sm"
          className="w-full justify-start gap-2"
          onClick={() => setOpen(true)}
          data-testid={`setting-${field.key}`}
        >
          <Upload className="h-3.5 w-3.5" />
          Browse library
        </Button>
      )}
      <AssetLibraryModal
        open={open}
        onOpenChange={setOpen}
        onSelect={handleSelect}
        filterTypes={filterTypes}
        title={`Select ${field.label}`}
        description="Choose a file from your library or upload a new one."
      />
    </div>
  );
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

        // The engine sends the field type as a free string, so accept the
        // shapes a module might reasonably declare rather than one literal.
        if (type === "asset" || type === "media" || type.startsWith("asset") || type.startsWith("media")) {
          return (
            <AssetSettingField
              key={field.key}
              field={field}
              value={(current as AssetSettingValue | null) ?? null}
              onChange={(value) => onChange(field.key, value)}
            />
          );
        }

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
