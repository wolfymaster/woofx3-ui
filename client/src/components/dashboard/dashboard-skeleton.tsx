import { Loader2 } from "lucide-react";
import { columnWeight, getDashboardLayout, rowWeight } from "@/lib/dashboard-layouts";

// Kept apart from dashboard-canvas.tsx because the onboarding guard renders it
// from the eagerly loaded shell, and the canvas pulls in every dashboard widget.
/**
 * Zone outlines for a layout, drawn while the dashboard's panels load. Without
 * a known layout it falls back to a spinner rather than guessing a shape.
 */
export function DashboardSkeleton({ layoutId }: { layoutId: string | null }) {
  const layout = layoutId ? getDashboardLayout(layoutId) : undefined;

  if (!layout) {
    return (
      <div className="h-full flex items-center justify-center" data-testid="dashboard-loading">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="h-full p-4 flex flex-col gap-4" data-testid="dashboard-loading">
      {layout.rows.map((row, rowIndex) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: rows are a static, never-reordered layout definition
        <div key={`row-${rowIndex}`} className="flex gap-4 min-h-0" style={{ flexGrow: rowWeight(row), flexBasis: 0 }}>
          {Array.from({ length: row.columns }).map((_, columnIndex) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: columns are a static, never-reordered layout definition
              key={`col-${columnIndex}`}
              className="rounded-lg border border-border bg-card animate-pulse"
              style={{ flexGrow: columnWeight(row, columnIndex), flexBasis: 0 }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
