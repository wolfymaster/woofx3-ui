import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { getDashboardWidget } from "@/lib/dashboard-widgets/registry";
import { cn } from "@/lib/utils";

// Widgets docked to the rail rather than placed on the canvas. They're
// ordinary registry entries — the same definition drives both surfaces, so a
// user who'd rather give one a permanent slot can still add it from a zone's
// Add Widget menu.
const RAIL_WIDGET_TYPES = ["notes", "stream-stats"] as const;

/**
 * Right-edge dock of icon buttons, one per rail widget, each opening a
 * floating "peek" flyout over a dimming scrim. Only one flyout is open at a
 * time; the icon, the flyout's ✕, the scrim, and Escape all close it.
 *
 * The rail is a column of the dashboard page rather than a `position: fixed`
 * overlay: fixed would sit on top of the app shell's sidebar and header,
 * which this epic is explicitly not allowed to touch.
 */
export function WidgetRail() {
  const [openType, setOpenType] = useState<string | null>(null);

  useEffect(() => {
    if (!openType) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenType(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [openType]);

  const openWidget = openType ? getDashboardWidget(openType) : undefined;
  const OpenComponent = openWidget?.component;

  return (
    <>
      <div
        className="shrink-0 w-[52px] h-full flex flex-col items-center gap-1 py-4 border-l border-border"
        data-testid="dashboard-widget-rail"
      >
        {RAIL_WIDGET_TYPES.map((type) => {
          const widget = getDashboardWidget(type);
          if (!widget) {
            return null;
          }
          const Icon = widget.icon;
          const isOpen = openType === type;
          return (
            <button
              key={type}
              type="button"
              title={widget.label}
              aria-label={widget.label}
              aria-pressed={isOpen}
              className={cn(
                "h-9 w-9 rounded-lg flex items-center justify-center transition-colors",
                isOpen ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-muted"
              )}
              onClick={() => setOpenType((prev) => (prev === type ? null : type))}
              data-testid={`button-rail-${type}`}
            >
              <Icon className="h-4 w-4" />
            </button>
          );
        })}
      </div>

      {openWidget && OpenComponent && (
        <>
          {/* Scrim: dims the canvas and closes the flyout on click. */}
          <button
            type="button"
            aria-label="Close panel"
            className="fixed inset-0 z-40 bg-black/50"
            onClick={() => setOpenType(null)}
            data-testid="scrim-widget-rail"
          />
          <Card
            className="fixed right-[64px] top-24 bottom-8 z-50 w-[340px] flex flex-col overflow-hidden shadow-2xl ring-1 ring-primary/15"
            data-testid={`flyout-rail-${openWidget.type}`}
          >
            <div className="shrink-0 flex items-center justify-between px-3 py-2 border-b border-border">
              <span className="text-xs font-semibold">{openWidget.label}</span>
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground"
                onClick={() => setOpenType(null)}
                aria-label={`Close ${openWidget.label}`}
                data-testid="button-close-rail-flyout"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="flex-1 min-h-0 overflow-hidden">
              <OpenComponent />
            </div>
          </Card>
        </>
      )}
    </>
  );
}
