import { Link } from "wouter";
import { SIDEBAR_RAIL } from "@/components/layout/sidebar-rail";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { AlertGroup } from "@/lib/alert-groups";
import { cn } from "@/lib/utils";

interface AlertGroupRailProps {
  groups: AlertGroup[];
  /** Configured alert count per group key. */
  counts: Map<string, number>;
  /** Key of the selected group, or null for "All alerts". */
  selectedKey: string | null;
  basePath: string;
}

/**
 * The submenu under Alerts: one entry per kind of thing that can fire one.
 *
 * Every registered trigger appears, whether or not an alert exists for it yet, so the
 * rail doubles as the answer to "what can I make an alert for?" — which is why picking
 * a group and then creating is one step rather than a separate trigger hunt.
 */
export function AlertGroupRail({ groups, counts, selectedKey, basePath }: AlertGroupRailProps) {
  const total = Array.from(counts.values()).reduce((sum, n) => sum + n, 0);

  return (
    <nav className={SIDEBAR_RAIL} aria-label="Alert groups">
      <ScrollArea className="flex-1">
        <div className="p-2 space-y-0.5">
          <RailLink href={basePath} label="All alerts" count={total} isActive={selectedKey === null} />

          <div className="px-2 pt-3 pb-1 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
            Types
          </div>

          {groups.map((group) => (
            <RailLink
              key={group.key}
              href={`${basePath}/${group.key}`}
              label={group.label}
              count={counts.get(group.key) ?? 0}
              isActive={selectedKey === group.key}
            />
          ))}
        </div>
      </ScrollArea>
    </nav>
  );
}

interface RailLinkProps {
  href: string;
  label: string;
  count: number;
  isActive: boolean;
}

function RailLink({ href, label, count, isActive }: RailLinkProps) {
  return (
    <Link href={href} className="block">
      <span
        className={cn(
          "flex items-center justify-between gap-2 rounded-md px-2.5 py-2 text-[15px] cursor-pointer hover:bg-accent",
          isActive && "bg-accent font-medium"
        )}
        aria-current={isActive ? "page" : undefined}
        data-testid={`alert-group-${label}`}
      >
        <span className="truncate">{label}</span>
        {count > 0 && <span className="text-[11px] text-muted-foreground shrink-0">{count}</span>}
      </span>
    </Link>
  );
}
