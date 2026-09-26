import type { ThemeColors } from "@/lib/theme/palettes";
import { cn } from "@/lib/utils";

/**
 * A thumbnail of the app shell drawn in a palette's own colors, independent of
 * the theme currently applied, so every palette can be compared side by side.
 */
export function PalettePreview({ colors, className }: { colors: ThemeColors; className?: string }) {
  const charts = [colors.chart1, colors.chart2, colors.chart3, colors.chart4, colors.chart5];

  return (
    <div
      aria-hidden
      className={cn("flex h-20 overflow-hidden rounded-md border", className)}
      style={{ backgroundColor: colors.background, borderColor: colors.border }}
    >
      <div className="w-1/5 space-y-1.5 p-2" style={{ backgroundColor: colors.sidebar }}>
        <div className="h-1.5 w-full rounded-full" style={{ backgroundColor: colors.primary }} />
        <div className="h-1.5 w-3/4 rounded-full" style={{ backgroundColor: colors.mutedForeground, opacity: 0.5 }} />
        <div className="h-1.5 w-3/4 rounded-full" style={{ backgroundColor: colors.mutedForeground, opacity: 0.5 }} />
      </div>
      <div className="flex-1 p-2">
        <div
          className="flex h-full flex-col justify-between rounded border p-2"
          style={{ backgroundColor: colors.card, borderColor: colors.border }}
        >
          <div className="space-y-1">
            <div className="h-1.5 w-2/3 rounded-full" style={{ backgroundColor: colors.foreground }} />
            <div className="h-1.5 w-1/2 rounded-full" style={{ backgroundColor: colors.mutedForeground }} />
          </div>
          <div className="flex items-center justify-between gap-2">
            <div className="flex gap-1">
              {charts.map((chart, index) => (
                // Chart slots are positional, so the index is the identity.
                // biome-ignore lint/suspicious/noArrayIndexKey: fixed five-slot list
                <div key={index} className="h-2 w-2 rounded-full" style={{ backgroundColor: chart }} />
              ))}
            </div>
            <div className="h-3 w-8 rounded-sm" style={{ backgroundColor: colors.primary }} />
          </div>
        </div>
      </div>
    </div>
  );
}
