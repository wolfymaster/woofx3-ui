import { useStore } from "@nanostores/react";
import { Activity, Command, Search } from "lucide-react";
import { useCallback, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { CommandPalette } from "@/components/command-palette/command-palette";
import { Uptime } from "@/components/common/uptime";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { useEngineHealth } from "@/engine/hooks/use-engine-health";
import { useEngineVersion } from "@/engine/hooks/use-engine-version";
import { useLiveConnection } from "@/engine/hooks/use-live-connection";
import { useLiveState } from "@/engine/hooks/use-live-state";
import { useAuthActions, useConvexUser } from "@/hooks/use-convex-auth";
import { useDefaultEngineOnSignIn } from "@/hooks/use-default-engine";
import { useEngineUpgrading, useReconnectAfterUpgrade } from "@/hooks/use-engine-upgrading";
import { useInstance } from "@/hooks/use-instance";
import { useIsInstanceAdmin } from "@/hooks/use-instance-role";
import { useResourceKindNavItems } from "@/hooks/use-resource-kind-nav-items";
import { useWorkflowHealthResyncOnReconnect } from "@/hooks/use-workflow-health";
import { formatEngineVersion } from "@/lib/engine-version";
import { $relayLimitation } from "@/lib/relay-limitation";
import { $commandPaletteOpen } from "@/lib/stores";
import { cn } from "@/lib/utils";
import { ConnectionStatusBar } from "./connection-status";
import { EngineMenuSection } from "./engine-menu";
import { EngineUpgradingBanner } from "./engine-upgrading-banner";
import {
  findActiveSection,
  isSectionActive,
  MAIN_NAV_SECTIONS,
  navItemsFor,
  sectionsFor,
  UTILITY_SECTIONS,
  withAlertsChildren,
} from "./nav-config";
import { NotificationsMenu } from "./notifications-menu";
import { SectionSidebar } from "./section-sidebar";
import { SetupInstallBanner } from "./setup-install-banner";
import { StatusBarCenterMount, StatusBarSlotProvider } from "./status-bar-slot";
import { ThemeMenuSub } from "./theme-menu";
import { TwitchReconnectBanner } from "./twitch-reconnect-banner";
import { UtilityNav } from "./utility-nav";

type EngineConnection = "connected" | "limited" | "upgrading" | "disconnected";

const ENGINE_CONNECTION: Record<EngineConnection, { label: string; dot: string; text: string }> = {
  connected: { label: "Connected", dot: "bg-green-500", text: "text-green-600 dark:text-green-400" },
  limited: { label: "Limited", dot: "bg-amber-500", text: "text-amber-600 dark:text-amber-400" },
  upgrading: { label: "Upgrading", dot: "bg-blue-500", text: "text-blue-600 dark:text-blue-400" },
  disconnected: { label: "Disconnected", dot: "bg-muted-foreground", text: "text-muted-foreground" },
};

/** An engine that is down for an upgrade is not a lost connection, so it is named for what it is. */
function engineConnection(connected: boolean, upgrading: boolean, relayLimited: boolean): EngineConnection {
  if (connected) {
    return relayLimited ? "limited" : "connected";
  }
  return upgrading ? "upgrading" : "disconnected";
}

function StatusBar() {
  const { connected } = useEngineHealth();
  const engineVersion = useEngineVersion(connected);
  const liveState = useLiveState();
  const relayLimitation = useStore($relayLimitation);
  const connectionState = engineConnection(connected, useEngineUpgrading(), relayLimitation !== null);
  const connection = ENGINE_CONNECTION[connectionState];

  const isLive = liveState?.isLive ?? false;
  const startedAt = isLive ? liveState?.startedAt : undefined;

  return (
    <div className="h-7 bg-card border-t border-border flex items-center px-4 text-xs shrink-0">
      <ConnectionStatusBar
        engine={{ ...connection, state: connectionState, version: formatEngineVersion(engineVersion) }}
      />

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

function AppHeader() {
  const { user } = useConvexUser();
  const { signOut } = useAuthActions();
  const [location] = useLocation();

  const displayName = (user as any)?.name || "User";
  const initials = displayName
    .split(" ")
    .map((n: string) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const isAdmin = useIsInstanceAdmin() ?? false;

  const openCommandPalette = useCallback(() => {
    $commandPaletteOpen.set(true);
  }, []);

  return (
    <header className="h-14 bg-card border-b border-border flex items-center px-4 gap-3 shrink-0">
      <nav className="flex items-center gap-1 flex-1 min-w-0 overflow-x-auto">
        {MAIN_NAV_SECTIONS.map((item) => {
          const isActive = isSectionActive(item, location);

          return (
            <Link key={item.id} href={item.href}>
              <Button
                variant={isActive ? "secondary" : "ghost"}
                size="sm"
                className={cn("gap-2 h-8 shrink-0", isActive && "bg-background shadow-sm")}
                data-testid={`nav-${item.id}`}
              >
                <item.icon className="h-4 w-4" />
                <span className="hidden sm:inline">{item.label}</span>
              </Button>
            </Link>
          );
        })}
      </nav>

      <div className="flex items-center gap-2 shrink-0">
        <UtilityNav sections={sectionsFor(UTILITY_SECTIONS, isAdmin)} location={location} />

        <Separator orientation="vertical" className="h-6 hidden md:block" />

        <Button
          variant="outline"
          className="hidden xl:flex items-center gap-2 text-muted-foreground w-48 justify-start bg-background/50"
          onClick={openCommandPalette}
          data-testid="button-command-palette"
        >
          <Search className="h-4 w-4" />
          <span className="flex-1 text-left text-xs">Quick actions...</span>
          <kbd className="pointer-events-none flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-system-mono text-[10px] font-medium text-muted-foreground">
            <Command className="h-3 w-3" />K
          </kbd>
        </Button>

        <NotificationsMenu />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="h-9 w-9 rounded-full p-0" data-testid="button-user-menu">
              <Avatar className="h-8 w-8">
                <AvatarImage src={(user as any)?.image} />
                <AvatarFallback className="bg-muted text-muted-foreground text-xs font-medium">
                  {initials}
                </AvatarFallback>
              </Avatar>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel className="font-normal">
              <div className="flex flex-col space-y-1">
                <p className="text-sm font-medium">{displayName}</p>
                <p className="text-xs text-muted-foreground">{(user as any)?.email || ""}</p>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <EngineMenuSection />
            <DropdownMenuSeparator />
            <ThemeMenuSub />
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/settings/profile" data-testid="menu-your-settings">
                Your settings
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/team">Team Settings</Link>
            </DropdownMenuItem>
            {isAdmin && (
              <DropdownMenuItem asChild>
                <Link href="/admin">Admin</Link>
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => signOut()} className="text-destructive focus:text-destructive">
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}

interface BroadcastShellProps {
  children: React.ReactNode;
}

export function BroadcastShell({ children }: BroadcastShellProps) {
  const commandPaletteOpen = useStore($commandPaletteOpen);
  const [location] = useLocation();
  const activeSection = findActiveSection(location);
  const { instance } = useInstance();
  const resourceKindItems = useResourceKindNavItems();
  useDefaultEngineOnSignIn();
  useLiveConnection();
  useReconnectAfterUpgrade();
  useWorkflowHealthResyncOnReconnect();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        $commandPaletteOpen.set(true);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <StatusBarSlotProvider>
      <div className="flex flex-col h-screen w-full overflow-hidden bg-background">
        <AppHeader />
        <TwitchReconnectBanner />
        <EngineUpgradingBanner />
        <SetupInstallBanner />

        <div className="flex-1 flex min-h-0 overflow-hidden">
          {activeSection?.children && (
            <SectionSidebar
              title={activeSection.label}
              items={navItemsFor(withAlertsChildren(activeSection.children, resourceKindItems), instance?.hosting)}
              location={location}
            />
          )}
          <main className="flex-1 overflow-auto">{children}</main>
        </div>

        <StatusBar />

        <CommandPalette open={commandPaletteOpen} onOpenChange={(open: boolean) => $commandPaletteOpen.set(open)} />
      </div>
    </StatusBarSlotProvider>
  );
}
