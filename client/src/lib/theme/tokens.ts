import { hexToHslTriple, mixHex, mostReadable } from "./color";
import type { ThemeColors } from "./palettes";

/**
 * Expands a palette's seed colors into every color variable the stylesheet
 * reads, keyed by CSS custom property name. Must cover each color variable
 * `index.css` declares, or the stylesheet default for the missing one shows
 * through under every palette.
 *
 * Text on a filled color (primary buttons, destructive badges) is whichever of
 * the palette's own background or foreground reads better on that fill, so a
 * custom primary stays legible without a separate knob.
 */
export function resolveThemeTokens(colors: ThemeColors): Record<string, string> {
  const onFill = (fill: string) => mostReadable(fill, [colors.background, colors.foreground]);
  // Popovers float over cards, so they need to separate from them without a
  // palette-specific shade: nudged toward the text color, which darkens a light
  // theme and lightens a dark one.
  const popover = mixHex(colors.card, colors.foreground, 0.04);
  // Form fields need a stronger outline than decorative borders to read as
  // interactive.
  const input = mixHex(colors.border, colors.mutedForeground, 0.3);
  const primaryForeground = onFill(colors.primary);

  const hex: Record<string, string> = {
    "--background": colors.background,
    "--foreground": colors.foreground,
    "--border": colors.border,
    "--card": colors.card,
    "--card-foreground": colors.foreground,
    "--card-border": colors.border,
    "--sidebar": colors.sidebar,
    "--sidebar-foreground": colors.foreground,
    "--sidebar-border": colors.border,
    "--sidebar-primary": colors.primary,
    "--sidebar-primary-foreground": primaryForeground,
    "--sidebar-accent": colors.accent,
    "--sidebar-accent-foreground": colors.foreground,
    "--sidebar-ring": colors.primary,
    "--popover": popover,
    "--popover-foreground": colors.foreground,
    "--popover-border": colors.border,
    "--primary": colors.primary,
    "--primary-foreground": primaryForeground,
    "--secondary": colors.muted,
    "--secondary-foreground": colors.foreground,
    "--muted": colors.muted,
    "--muted-foreground": colors.mutedForeground,
    "--accent": colors.accent,
    "--accent-foreground": colors.foreground,
    "--destructive": colors.destructive,
    "--destructive-foreground": onFill(colors.destructive),
    "--input": input,
    "--ring": colors.primary,
    "--chart-1": colors.chart1,
    "--chart-2": colors.chart2,
    "--chart-3": colors.chart3,
    "--chart-4": colors.chart4,
    "--chart-5": colors.chart5,
  };

  const tokens: Record<string, string> = {};
  for (const [name, value] of Object.entries(hex)) {
    tokens[name] = hexToHslTriple(value);
  }
  return tokens;
}
