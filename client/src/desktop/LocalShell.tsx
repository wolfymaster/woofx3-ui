import { Activity, Monitor } from "lucide-react";
import type { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { Uptime } from "@/components/common/uptime";
import { isSectionActive, MAIN_NAV_SECTIONS, type NavSection, navItemsServed } from "@/components/layout/nav-config";
import { SectionSidebar } from "@/components/layout/section-sidebar";
import { StatusBarCenterMount, StatusBarSlotProvider } from "@/components/layout/status-bar-slot";
import { Button } from "@/components/ui/button";
import { useEngineHealth } from "@/engine/hooks/use-engine-health";
import { useEngineVersion } from "@/engine/hooks/use-engine-version";
import { useLiveConnection } from "@/engine/hooks/use-live-connection";
import { useLiveState } from "@/engine/hooks/use-live-state";
import { formatEngineVersion } from "@/lib/engine-version";
import { cn } from "@/lib/utils";
import { servesLocally } from "./local-routes";

/** The app's sections, cut down to the pages local mode serves. */
const LOCAL_SECTIONS: NavSection[] = navItemsServed(MAIN_NAV_SECTIONS, servesLocally);

function LocalHeader({ location }: { location: string }) {
  return (
    <header className="h-14 bg-card border-b border-border flex items-center px-4 gap-3 shrink-0">
      <nav className="flex items-center gap-1 flex-1 min-w-0 overflow-x-auto">
        {LOCAL_SECTIONS.map((section) => {
          const isActive = isSectionActive(section, location);
          return (
            <Link key={section.id} href={section.href}>
              <Button
                variant={isActive ? "secondary" : "ghost"}
                size="sm"
                className={cn("gap-2 h-8 shrink-0", isActive && "bg-background shadow-sm")}
                data-testid={`nav-${section.id}`}
              >
                <section.icon className="h-4 w-4" />
                <span className="hidden sm:inline">{section.label}</span>
              </Button>
            </Link>
          );
        })}
      </nav>
      <div className="flex items-center gap-2 text-xs text-muted-foreground shrink-0" data-testid="local-mode-badge">
        <Monitor className="h-4 w-4" />
        <span>On this computer</span>
      </div>
    </header>
  );
}

function LocalStatusBar() {
  const { connected } = useEngineHealth();
  const engineVersion = useEngineVersion(connected);
  const liveState = useLiveState();
  const isLive = liveState?.isLive ?? false;
  const startedAt = isLive ? liveState?.startedAt : undefined;

  return (
    <div className="h-7 bg-card border-t border-border flex items-center px-4 text-xs shrink-0">
      <div className="flex-1 flex items-center gap-2 min-w-0">
        <span className={cn("h-1.5 w-1.5 rounded-full", connected ? "bg-green-500" : "bg-amber-500")} />
        <span
          className={cn("font-semibold uppercase tracking-wider", connected ? "text-green-500" : "text-amber-500")}
          data-testid="status-engine-connection"
        >
          {connected ? "Engine connected" : "Connecting to engine"}
        </span>
        <span className="text-muted-foreground font-mono truncate" data-testid="status-engine-version">
          {formatEngineVersion(engineVersion)}
        </span>
      </div>

      <StatusBarCenterMount className="flex items-center justify-center shrink-0" />

      <div className="flex-1 flex items-center justify-end gap-3 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className={cn("h-1.5 w-1.5 rounded-full", isLive ? "bg-red-500" : "bg-muted-foreground")} />
          <span
            className={cn("font-semibold uppercase tracking-wider", isLive ? "text-red-500" : "text-muted-foreground")}
          >
            {isLive ? "Live" : "Offline"}
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-muted-foreground font-system-mono">
          <Activity className="h-3 w-3" />
          {startedAt ? <Uptime startedAt={startedAt} /> : <span>00:00:00</span>}
        </div>
      </div>
    </div>
  );
}

/**
 * The frame around local mode's pages: the sections it serves, the active
 * section's sidebar, and the engine's status, with the status bar's center
 * slot a page such as the dashboard fills. It has no account, instance or
 * notification controls, since local mode has none of them.
 */
export function LocalShell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  useLiveConnection();
  const activeSection = LOCAL_SECTIONS.find((section) => isSectionActive(section, location));

  return (
    <StatusBarSlotProvider>
      <div className="flex flex-col h-screen w-full overflow-hidden bg-background">
        <LocalHeader location={location} />
        <div className="flex-1 flex min-h-0 overflow-hidden">
          {activeSection?.children && (
            <SectionSidebar title={activeSection.label} items={activeSection.children} location={location} />
          )}
          <main className="flex-1 overflow-auto">{children}</main>
        </div>
        <LocalStatusBar />
      </div>
    </StatusBarSlotProvider>
  );
}
