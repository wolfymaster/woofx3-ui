import { ChevronLeft, ChevronRight } from "lucide-react";
import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// The storefront's section furniture: a heading with an optional "view all",
// and the horizontally scrolling rail the trending section uses.
//
// The layout is the UI's: each section is one catalog query, and the page
// decides what goes in it. Nothing here knows what a listing is.

interface SectionHeadProps {
  title: string;
  /** One line under the title: what this section is selecting for. */
  subtitle?: string;
  viewAllLabel?: string;
  onViewAll?: () => void;
}

export function SectionHead({ title, subtitle, viewAllLabel = "View all", onViewAll }: SectionHeadProps) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
      {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
      {onViewAll && (
        <button
          type="button"
          onClick={onViewAll}
          className="ml-auto whitespace-nowrap text-sm font-semibold text-primary hover:underline"
        >
          {viewAllLabel} →
        </button>
      )}
    </div>
  );
}

/**
 * A row of cards that scrolls sideways.
 *
 * The arrows are buttons rather than a drag affordance because the rail holds
 * more than fits at any width, and a trackpad user and a mouse user should not
 * need different gestures to reach the end of it. They are hidden on touch
 * widths, where swiping is the gesture.
 */
export function CardRail({ children, className }: { children: React.ReactNode; className?: string }) {
  const rail = useRef<HTMLDivElement>(null);

  const scrollBy = (direction: -1 | 1) => {
    const node = rail.current;
    if (!node) {
      return;
    }
    // Most of a viewport at a time, so a press moves the row without losing
    // the card the eye was on.
    node.scrollBy({ left: direction * Math.max(280, node.clientWidth * 0.8), behavior: "smooth" });
  };

  return (
    <div className={cn("relative", className)}>
      <div
        ref={rail}
        className="flex snap-x snap-mandatory gap-4 overflow-x-auto px-1 pb-3 pt-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {children}
      </div>
      <RailButton side="left" onClick={() => scrollBy(-1)} />
      <RailButton side="right" onClick={() => scrollBy(1)} />
    </div>
  );
}

/**
 * The wrapper carries the position, not the button.
 *
 * Every `Button` here also carries `hover-elevate`, whose rule is specific
 * enough to beat a `position` utility class on the same element -- so an
 * `absolute` button is laid out `relative` and lands in the flow under the
 * rail. Positioning a plain element around it is what keeps the arrows on the
 * rail's edges.
 */
function RailButton({ side, onClick }: { side: "left" | "right"; onClick: () => void }) {
  return (
    <div
      className={cn("absolute top-1/2 z-10 hidden -translate-y-1/2 md:block", side === "left" ? "-left-3" : "-right-3")}
    >
      <Button
        variant="outline"
        size="icon"
        aria-label={side === "left" ? "Scroll left" : "Scroll right"}
        onClick={onClick}
        className="h-10 w-10 rounded-full bg-background shadow-lg hover:border-primary"
      >
        {side === "left" ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
      </Button>
    </div>
  );
}
