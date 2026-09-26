import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { useTheme } from "@/hooks/use-theme";
import { contrastRatio } from "@/lib/theme/color";
import { getPalette, type ThemeColorKey, themePalettes } from "@/lib/theme/palettes";
import { hasCustomOverrides } from "@/lib/theme/resolve";
import { ColorField } from "./color-field";

interface ColorRole {
  key: ThemeColorKey;
  label: string;
  description: string;
}

const COLOR_GROUPS: { title: string; roles: ColorRole[] }[] = [
  {
    title: "Surfaces",
    roles: [
      { key: "background", label: "Background", description: "The page canvas behind everything." },
      { key: "card", label: "Card", description: "Panels, cards and menus." },
      { key: "sidebar", label: "Sidebar", description: "Navigation rail." },
      { key: "muted", label: "Muted", description: "Secondary buttons, tracks and placeholders." },
      { key: "accent", label: "Hover", description: "Highlighted and hovered items." },
      { key: "border", label: "Border", description: "Dividers and outlines. Inputs use a stronger shade." },
    ],
  },
  {
    title: "Text",
    roles: [
      { key: "foreground", label: "Text", description: "Body text and headings." },
      { key: "mutedForeground", label: "Secondary text", description: "Descriptions, hints and timestamps." },
    ],
  },
  {
    title: "Brand",
    roles: [
      {
        key: "primary",
        label: "Primary",
        description: "Buttons, focus rings and selection. Text on it adjusts to stay readable.",
      },
      { key: "destructive", label: "Destructive", description: "Delete actions and errors." },
    ],
  },
  {
    title: "Charts",
    roles: [
      { key: "chart1", label: "Series 1", description: "First chart series." },
      { key: "chart2", label: "Series 2", description: "Second chart series." },
      { key: "chart3", label: "Series 3", description: "Third chart series." },
      { key: "chart4", label: "Series 4", description: "Fourth chart series." },
      { key: "chart5", label: "Series 5", description: "Fifth chart series." },
    ],
  },
];

/** WCAG AA minimums: 4.5 for body text, 3 for the larger or secondary text it's used for. */
const MINIMUM_CONTRAST: Partial<Record<ThemeColorKey, number>> = {
  foreground: 4.5,
  mutedForeground: 3,
};

/**
 * Edits the custom palette for the mode on screen. Every change lands in the
 * theme store, which re-themes the page as the picker moves.
 */
export function CustomThemeEditor() {
  const { mode, colors, customTheme, setCustomBase, setCustomColor, resetCustomColor, resetCustomTheme } = useTheme();
  const base = getPalette(customTheme.baseId);
  const overrides = customTheme[mode];

  const contrastWarning = (key: ThemeColorKey): string | undefined => {
    const minimum = MINIMUM_CONTRAST[key];
    if (minimum === undefined) {
      return undefined;
    }
    const ratio = contrastRatio(colors[key], colors.background);
    if (ratio >= minimum) {
      return undefined;
    }
    return `Contrast with the background is ${ratio.toFixed(1)}:1; aim for at least ${minimum}:1.`;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-2">
          <Label htmlFor="custom-theme-base">Based on</Label>
          <Select value={customTheme.baseId} onValueChange={setCustomBase}>
            <SelectTrigger id="custom-theme-base" className="w-full sm:w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {themePalettes.map((palette) => (
                <SelectItem key={palette.id} value={palette.id}>
                  {palette.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button variant="outline" onClick={resetCustomTheme} disabled={!hasCustomOverrides(customTheme)}>
          Reset to {base.name}
        </Button>
      </div>

      <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
        Editing <span className="font-medium text-foreground">{mode}</span> mode colors. Switch the mode above to edit
        the {mode === "dark" ? "light" : "dark"} set; each keeps its own changes.
      </p>

      {COLOR_GROUPS.map((group) => (
        <section key={group.title}>
          <h3 className="text-sm font-semibold">{group.title}</h3>
          <div className="divide-y">
            {group.roles.map((role) => (
              <ColorField
                key={role.key}
                label={role.label}
                description={role.description}
                value={colors[role.key]}
                modified={overrides[role.key] !== undefined}
                warning={contrastWarning(role.key)}
                onChange={(hex) => setCustomColor(mode, role.key, hex)}
                onReset={() => resetCustomColor(mode, role.key)}
              />
            ))}
          </div>
          <Separator className="mt-2" />
        </section>
      ))}
    </div>
  );
}
