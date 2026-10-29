import { AlertTriangle } from "lucide-react";
import { useMemo } from "react";
import type { CustomFieldRenderer } from "@/components/common/configuration-form";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useWidgetThemes } from "@/engine/hooks/use-scenes";
import type { WidgetThemesRead } from "@/engine/types";
import {
  themeMismatchNotice,
  themePickerOptions,
  themePickerValue,
  themeSelection,
  themeSettingValue,
} from "@/lib/widget-theme-picker";

/**
 * Picks one of the installed themes made for a widget, or its default look.
 * The list comes from the engine and is read again when modules change.
 */
function ThemeField({ field, value, onChange }: Parameters<CustomFieldRenderer>[0]) {
  const widgetCanonicalId = typeof field.widgetCanonicalId === "string" ? field.widgetCanonicalId : undefined;
  return widgetCanonicalId ? (
    <WidgetThemeField widgetCanonicalId={widgetCanonicalId} field={field} value={value} onChange={onChange} />
  ) : (
    <ThemeSelect field={field} value={value} onChange={onChange} list={undefined} />
  );
}

type ThemeFieldProps = Pick<Parameters<CustomFieldRenderer>[0], "field" | "value" | "onChange">;

function WidgetThemeField({ widgetCanonicalId, ...props }: ThemeFieldProps & { widgetCanonicalId: string }) {
  const list = useWidgetThemes(widgetCanonicalId);
  return <ThemeSelect {...props} list={list} />;
}

/** `list` is undefined while the themes load, and for a field that names no widget. */
function ThemeSelect({ field, value, onChange, list }: ThemeFieldProps & { list: WidgetThemesRead | undefined }) {
  const themes = list?.status === "loaded" ? list.themes : [];
  const selection = useMemo(() => themeSelection(value, themes), [value, themes]);
  const options = useMemo(() => themePickerOptions(themes), [themes]);
  const notice = list?.status === "loaded" ? themeMismatchNotice(selection) : null;

  return (
    <div className="space-y-2">
      <Label htmlFor={field.id}>{field.label}</Label>
      <Select
        value={list?.status === "loaded" ? themePickerValue(selection) : ""}
        onValueChange={(next) => onChange(themeSettingValue(next))}
        disabled={list?.status !== "loaded"}
      >
        <SelectTrigger id={field.id} data-testid={`select-${field.id}`}>
          <SelectValue
            placeholder={
              list === undefined
                ? "Loading themes..."
                : list.status === "unavailable"
                  ? "Could not load themes"
                  : "Select a theme"
            }
          />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {notice && (
        <p className="flex items-start gap-1.5 text-xs text-destructive" data-testid={`notice-${field.id}`}>
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <span>{notice}</span>
        </p>
      )}
      {selection.kind === "selected" && selection.theme.description && (
        <p className="text-xs text-muted-foreground">{selection.theme.description}</p>
      )}
      {selection.kind === "default" && typeof field.description === "string" && (
        <p className="text-xs text-muted-foreground">{field.description}</p>
      )}
    </div>
  );
}

export const ThemeFieldRenderer: CustomFieldRenderer = (props) => <ThemeField {...props} />;
