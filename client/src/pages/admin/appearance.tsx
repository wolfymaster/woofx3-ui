import { Check, Monitor, Moon, Sun } from "lucide-react";
import type { ReactNode } from "react";
import { CustomThemeEditor } from "@/components/appearance/custom-theme-editor";
import { PalettePreview } from "@/components/appearance/palette-preview";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useTheme } from "@/hooks/use-theme";
import { getPalette, type ThemeColors, themePalettes } from "@/lib/theme/palettes";
import {
  CUSTOM_PALETTE_ID,
  hasCustomOverrides,
  resolveThemeColors,
  type ThemeModePreference,
} from "@/lib/theme/resolve";
import { cn } from "@/lib/utils";

const MODE_OPTIONS: { value: ThemeModePreference; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];

function SelectableTile({
  selected,
  onSelect,
  children,
  testId,
}: {
  selected: boolean;
  onSelect: () => void;
  children: ReactNode;
  testId: string;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      data-testid={testId}
      className={cn(
        "relative w-full rounded-lg border-2 p-3 text-left hover-elevate",
        selected ? "border-primary" : "border-border"
      )}
    >
      {selected && <Check className="absolute right-2 top-2 h-4 w-4 text-primary" />}
      {children}
    </button>
  );
}

function PaletteTile({
  id,
  name,
  colors,
  selected,
  onSelect,
}: {
  id: string;
  name: string;
  colors: ThemeColors;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <SelectableTile selected={selected} onSelect={() => onSelect(id)} testId={`button-palette-${id}`}>
      <PalettePreview colors={colors} />
      <p className="mt-2 text-sm font-medium">{name}</p>
    </SelectableTile>
  );
}

export default function AdminAppearance() {
  const { modePreference, mode, setMode, paletteId, selectPalette, customTheme } = useTheme();
  const isCustom = paletteId === CUSTOM_PALETTE_ID;

  return (
    <div className="container mx-auto p-4 sm:p-6">
      <PageHeader title="Appearance" description="Theme mode and colors for this dashboard, saved in this browser." />

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Mode</CardTitle>
            <CardDescription>
              Every palette has a light and a dark version. System follows your device
              {modePreference === "system" ? ` (currently ${mode})` : ""}.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-3">
              {MODE_OPTIONS.map(({ value, label, icon: Icon }) => (
                <SelectableTile
                  key={value}
                  selected={modePreference === value}
                  onSelect={() => setMode(value)}
                  testId={`button-theme-${value}`}
                >
                  <div className="flex flex-col items-center gap-2 py-2">
                    <Icon className="h-6 w-6" />
                    <span className="text-sm font-medium">{label}</span>
                  </div>
                </SelectableTile>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Palette</CardTitle>
            <CardDescription>Previews show each palette's {mode} version.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {themePalettes.map((palette) => (
                <PaletteTile
                  key={palette.id}
                  id={palette.id}
                  name={palette.name}
                  colors={palette[mode]}
                  selected={paletteId === palette.id}
                  onSelect={selectPalette}
                />
              ))}
              <PaletteTile
                id={CUSTOM_PALETTE_ID}
                name="Custom"
                colors={resolveThemeColors(CUSTOM_PALETTE_ID, customTheme, mode)}
                selected={isCustom}
                onSelect={selectPalette}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Custom colors</CardTitle>
            <CardDescription>
              Start from a palette and change any color. The dashboard updates as you pick.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isCustom ? (
              <CustomThemeEditor />
            ) : (
              <Button onClick={() => selectPalette(CUSTOM_PALETTE_ID)} data-testid="button-customize-palette">
                {hasCustomOverrides(customTheme)
                  ? "Edit your custom palette"
                  : `Customize ${getPalette(paletteId).name}`}
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
