import { Check, Monitor, Moon, Sun } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useTheme } from "@/hooks/use-theme";
import { cn } from "@/lib/utils";

export default function AdminAppearance() {
  const { theme, setTheme, preset, presets, setPreset } = useTheme();

  return (
    <div className="container mx-auto p-6">
      <PageHeader title="Appearance" description="Theme mode and color preset for this dashboard." />

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Theme Mode</CardTitle>
            <CardDescription>Choose between light and dark mode.</CardDescription>
          </CardHeader>
          <CardContent>
            <RadioGroup
              value={theme}
              onValueChange={(v) => setTheme(v as "light" | "dark")}
              className="grid grid-cols-3 gap-4"
            >
              <div>
                <RadioGroupItem value="light" id="theme-light" className="peer sr-only" />
                <Label
                  htmlFor="theme-light"
                  className="flex flex-col items-center justify-between rounded-md border-2 border-muted bg-popover p-4 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary cursor-pointer"
                  data-testid="button-theme-light"
                >
                  <Sun className="mb-3 h-6 w-6" />
                  Light
                </Label>
              </div>
              <div>
                <RadioGroupItem value="dark" id="theme-dark" className="peer sr-only" />
                <Label
                  htmlFor="theme-dark"
                  className="flex flex-col items-center justify-between rounded-md border-2 border-muted bg-popover p-4 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary cursor-pointer"
                  data-testid="button-theme-dark"
                >
                  <Moon className="mb-3 h-6 w-6" />
                  Dark
                </Label>
              </div>
              <div>
                <RadioGroupItem value="system" id="theme-system" className="peer sr-only" disabled />
                <Label
                  htmlFor="theme-system"
                  className="flex flex-col items-center justify-between rounded-md border-2 border-muted bg-popover p-4 opacity-50 cursor-not-allowed"
                >
                  <Monitor className="mb-3 h-6 w-6" />
                  System
                </Label>
              </div>
            </RadioGroup>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Color Theme</CardTitle>
            <CardDescription>Select a color preset for your interface.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4">
              {presets.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPreset(p.id)}
                  className={cn(
                    "relative w-full text-left rounded-lg border-2 p-4 cursor-pointer hover-elevate",
                    preset.id === p.id ? "border-primary" : "border-muted"
                  )}
                  data-testid={`button-preset-${p.id}`}
                >
                  {preset.id === p.id && (
                    <div className="absolute top-2 right-2">
                      <Check className="h-4 w-4 text-primary" />
                    </div>
                  )}
                  <div className="flex items-center gap-2 mb-3">
                    <div className="h-4 w-4 rounded-full" style={{ backgroundColor: `hsl(${p.colors.primary})` }} />
                    <span className="font-medium">{p.name}</span>
                  </div>
                  <div className="flex gap-1">
                    <div className="h-6 w-6 rounded" style={{ backgroundColor: `hsl(${p.colors.background})` }} />
                    <div className="h-6 w-6 rounded" style={{ backgroundColor: `hsl(${p.colors.sidebar})` }} />
                    <div className="h-6 w-6 rounded" style={{ backgroundColor: `hsl(${p.colors.card})` }} />
                    <div className="h-6 w-6 rounded" style={{ backgroundColor: `hsl(${p.colors.accent})` }} />
                  </div>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>{" "}
      </div>
    </div>
  );
}
