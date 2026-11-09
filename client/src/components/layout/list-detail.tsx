import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "wouter";
import { cn } from "@/lib/utils";

interface ListDetailProps {
  /** Whether the route names an item, so a phone shows its detail instead of the list. */
  hasSelection: boolean;
  /** The page's list rail, styled with `LIST_RAIL`. */
  list: ReactNode;
  /** What sits beside the list from tablet width up. */
  detail: ReactNode;
  /** Where a phone's back link goes from the detail, and what it calls that place: "Back to {label}". */
  back: { href: string; label: string };
  /**
   * Whether a phone also shows the detail under the list when nothing is selected. For a page
   * whose unselected detail is an overview worth reaching (a dashboard, a storefront) rather
   * than a prompt to pick something from the list.
   */
  overviewBelowList?: boolean;
}

/**
 * A page's list rail beside its detail from tablet width up. A phone has no room for both,
 * so it shows one at a time: the list until the route selects an item, then the detail with
 * a link back to the list. Showing the list, the whole page scrolls as one, rather than a
 * capped list scrolling on its own above content that scrolls too.
 *
 * The wrappers are `display: contents` wherever they would otherwise get in the way of the
 * frame's flex layout, so the list and the detail keep sizing themselves as they do beside
 * each other.
 */
export function ListDetail({ hasSelection, list, detail, back, overviewBelowList = false }: ListDetailProps) {
  const showsDetail = hasSelection || overviewBelowList;

  return (
    <div
      className={cn(
        "h-full w-full md:flex md:flex-row md:overflow-hidden",
        hasSelection ? "flex flex-col overflow-hidden" : "overflow-y-auto"
      )}
    >
      <div className={cn("md:contents", hasSelection && "hidden")}>{list}</div>
      {hasSelection && (
        <Link
          href={back.href}
          className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-3 text-sm text-muted-foreground hover:text-foreground md:hidden"
          data-testid="list-detail-back"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to {back.label}
        </Link>
      )}
      <div className={cn(hasSelection ? "contents" : "md:contents", !showsDetail && "hidden")}>{detail}</div>
    </div>
  );
}
