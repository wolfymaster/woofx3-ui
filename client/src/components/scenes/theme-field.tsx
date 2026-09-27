import { api } from "@convex/_generated/api";
import type { WidgetThemeOption } from "@convex/lib/widgetThemes";
import { useAction, useQuery } from "convex/react";
import { AlertTriangle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { CustomFieldRenderer } from "@/components/common/configuration-form";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useInstance } from "@/hooks/use-instance";
import {
  themeMismatchNotice,
  themePickerOptions,
  themePickerValue,
  themeSelection,
  themeSettingValue,
} from "@/lib/widget-theme-picker";

type ThemeList = { status: "loading" } | { status: "loaded"; themes: WidgetThemeOption[] } | { status: "error" };

/**
 * Picks one of the installed themes made for a widget, or its default look.
 *
 * The list lives on the engine and changes only when a module is installed or
 * removed, so it is fetched once and again whenever the instance's installed
 * module set changes, rather than polled.
 */
function ThemeField({ field, value, onChange }: Parameters<CustomFieldRenderer>[0]) {
  const { instance } = useInstance();
  const instanceId = instance?._id;
  const widgetCanonicalId = typeof field.widgetCanonicalId === "string" ? field.widgetCanonicalId : undefined;
  const listWidgetThemes = useAction(api.sceneActions.listWidgetThemes);
  const revision = useQuery(api.moduleRepository.installedRevision, instanceId ? { instanceId } : "skip");
  const [list, setList] = useState<ThemeList>({ status: "loading" });

  useEffect(() => {
    if (!instanceId || !widgetCanonicalId || revision === undefined) {
      return;
    }
    let cancelled = false;
    listWidgetThemes({ instanceId, widgetCanonicalId })
      .then((result) => {
        if (!cancelled) {
          setList({ status: "loaded", themes: result.themes });
        }
      })
      .catch((err: unknown) => {
        console.error("listWidgetThemes failed:", err);
        if (!cancelled) {
          setList({ status: "error" });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [instanceId, widgetCanonicalId, revision, listWidgetThemes]);

  const themes = list.status === "loaded" ? list.themes : [];
  const selection = useMemo(() => themeSelection(value, themes), [value, themes]);
  const options = useMemo(() => themePickerOptions(themes), [themes]);
  const notice = list.status === "loaded" ? themeMismatchNotice(selection) : null;

  return (
    <div className="space-y-2">
      <Label htmlFor={field.id}>{field.label}</Label>
      <Select
        value={list.status === "loaded" ? themePickerValue(selection) : ""}
        onValueChange={(next) => onChange(themeSettingValue(next))}
        disabled={list.status !== "loaded"}
      >
        <SelectTrigger id={field.id} data-testid={`select-${field.id}`}>
          <SelectValue
            placeholder={
              list.status === "loading"
                ? "Loading themes..."
                : list.status === "error"
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
