import { useStore } from "@nanostores/react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { Link } from "wouter";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { $sidebarCollapsed } from "@/lib/stores";
import { cn } from "@/lib/utils";
import { isNavItemActive, type NavItem } from "./nav-config";
import { SIDEBAR_RAIL } from "./sidebar-rail";

interface SectionSidebarProps {
  title: string;
  items: NavItem[];
  location: string;
}

export function SectionSidebar({ title, items, location }: SectionSidebarProps) {
  const collapsed = useStore($sidebarCollapsed);

  return (
    <nav className={cn(SIDEBAR_RAIL, collapsed && "w-14")} aria-label={`${title} navigation`}>
      <div className="flex-1 overflow-y-auto">
        {!collapsed && (
          <div className="px-4 py-3 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
            {title}
          </div>
        )}

        <div className={cn("px-2 pb-2 space-y-0.5", collapsed && "pt-3")}>
          {items.map((item) => {
            const isActive = isNavItemActive(item, location);
            const row = (
              <span
                className={cn(
                  "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[15px] cursor-pointer hover:bg-accent",
                  collapsed && "justify-center px-0",
                  isActive && "bg-accent font-medium"
                )}
                aria-current={isActive ? "page" : undefined}
                data-testid={`subnav-${item.id}`}
              >
                <item.icon className="h-5 w-5 shrink-0 text-muted-foreground" />
                {!collapsed && <span className="truncate">{item.label}</span>}
              </span>
            );

            return (
              <Link key={item.id} href={item.href} className="block">
                {collapsed ? (
                  <Tooltip>
                    <TooltipTrigger asChild>{row}</TooltipTrigger>
                    <TooltipContent side="right">{item.label}</TooltipContent>
                  </Tooltip>
                ) : (
                  row
                )}
              </Link>
            );
          })}
        </div>
      </div>

      <div className="border-t border-border p-2">
        <button
          type="button"
          onClick={() => $sidebarCollapsed.set(!collapsed)}
          className={cn(
            "w-full flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-muted-foreground",
            "cursor-pointer hover:bg-accent hover:text-foreground",
            collapsed && "justify-center px-0"
          )}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!collapsed}
          data-testid="button-toggle-section-sidebar"
        >
          {collapsed ? <PanelLeftOpen className="h-5 w-5" /> : <PanelLeftClose className="h-5 w-5" />}
          {!collapsed && <span>Collapse</span>}
        </button>
      </div>
    </nav>
  );
}
