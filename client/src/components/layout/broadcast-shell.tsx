import { api } from "@convex/_generated/api";
import { useStore } from "@nanostores/react";
import { useMutation } from "convex/react";
import { Activity, Bell, Check, ChevronDown, Command, MonitorPlay, Pencil, Search } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAuthActions, useConvexUser } from "@/hooks/use-convex-auth";
import { useEngineHealth } from "@/hooks/use-engine-health";
import { useInstance } from "@/hooks/use-instance";
import { useLiveState } from "@/hooks/use-live-state";
import { useSyncEngineTransport } from "@/hooks/use-sync-engine-transport";
import { useTheme } from "@/hooks/use-theme";
import { $commandPaletteOpen, $notifications } from "@/lib/stores";
import { cn, formatUptime } from "@/lib/utils";
import { CommandPalette } from "./command-palette";
import { findActiveSection, isSectionActive, MAIN_NAV_SECTIONS, UTILITY_SECTIONS } from "./nav-config";
import { SectionSidebar } from "./section-sidebar";
import { StatusBarCenterMount, StatusBarSlotProvider } from "./status-bar-slot";

function InstanceBar() {
  const { instance, instances, setInstance } = useInstance();
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editName, setEditName] = useState("");

  const updateInstance = useMutation(api.instances.update);

  const instanceDisplayName = instance?.name || "No Instance";

  const handleEditInstance = () => {
    setEditName(instance?.name || "");
    setEditDialogOpen(true);
  };

  const handleSaveInstance = async () => {
    if (instance && editName.trim()) {
      await updateInstance({ instanceId: instance._id, name: editName.trim() });
      setEditDialogOpen(false);
    }
  };

  return (
    <>
      <div className="h-9 bg-background border-b border-border flex items-center justify-center shrink-0">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="flex items-center gap-2 px-2 h-7">
              <div className="flex items-center justify-center w-5 h-5 rounded bg-primary text-primary-foreground">
                <MonitorPlay className="h-3 w-3" />
              </div>
              <span className="font-semibold text-sm tracking-tight">{instanceDisplayName}</span>
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="center" className="w-64">
            <DropdownMenuLabel>Switch Instance</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {instances.map(
              (inst) =>
                inst && (
                  <DropdownMenuItem
                    key={inst._id}
                    onClick={() => setInstance(inst._id)}
                    className="flex items-center justify-between"
                  >
                    <span>{inst.name}</span>
                    {inst._id === instance?._id && <Check className="h-4 w-4 text-primary" />}
                  </DropdownMenuItem>
                )
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleEditInstance}>
              <Pencil className="h-4 w-4 mr-2" />
              Rename Instance
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename Instance</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <Label htmlFor="instance-name">Name</Label>
            <Input
              id="instance-name"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              placeholder="Enter instance name"
              className="mt-2"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveInstance}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function StatusBar() {
  const { connected } = useEngineHealth();
  const liveState = useLiveState();
  const [now, setNow] = useState(() => Date.now());

  const isLive = liveState?.isLive ?? false;

  useEffect(() => {
    if (!isLive) {
      return;
    }
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [isLive]);

  const streamUptime = isLive && liveState?.startedAt ? formatUptime(liveState.startedAt, now) : "00:00:00";

  return (
    <div className="h-7 bg-card border-t border-border flex items-center px-4 text-xs shrink-0">
      <div className="flex-1 flex items-center gap-2 min-w-0">
        <span className={cn("h-1.5 w-1.5 rounded-full", connected ? "bg-green-500" : "bg-muted-foreground")} />
        <span
          className={cn(
            "font-semibold uppercase tracking-wider",
            connected ? "text-green-600 dark:text-green-400" : "text-muted-foreground"
          )}
        >
          {connected ? "Connected" : "Disconnected"}
        </span>
        {/* Engine exposes no version RPC yet — placeholder until getEngineInfo returns one. */}
        <span className="text-muted-foreground">v—</span>
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
        <div className="flex items-center gap-1.5 text-muted-foreground font-mono">
          <Activity className="h-3 w-3" />
          <span>{streamUptime}</span>
        </div>
      </div>
    </div>
  );
}

function AppHeader() {
  const notifications = useStore($notifications);
  const { user } = useConvexUser();
  const { signOut } = useAuthActions();
  const { preset, presets, setPreset } = useTheme();
  const [location] = useLocation();

  const unreadCount = notifications.filter((n) => !n.read).length;
  const displayName = (user as any)?.name || "User";
  const initials = displayName
    .split(" ")
    .map((n: string) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

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
        <div className="hidden md:flex items-center gap-1">
          {UTILITY_SECTIONS.map((item) => {
            const isActive = isSectionActive(item, location);

            return (
              <Link key={item.id} href={item.href}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant={isActive ? "secondary" : "ghost"}
                      size="icon"
                      className={cn("h-8 w-8", isActive && "bg-background shadow-sm")}
                      data-testid={`nav-${item.id}`}
                    >
                      <item.icon className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{item.label}</TooltipContent>
                </Tooltip>
              </Link>
            );
          })}
        </div>

        <Separator orientation="vertical" className="h-6 hidden md:block" />

        <Button
          variant="outline"
          className="hidden xl:flex items-center gap-2 text-muted-foreground w-48 justify-start bg-background/50"
          onClick={openCommandPalette}
          data-testid="button-command-palette"
        >
          <Search className="h-4 w-4" />
          <span className="flex-1 text-left text-xs">Quick actions...</span>
          <kbd className="pointer-events-none flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
            <Command className="h-3 w-3" />K
          </kbd>
        </Button>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="relative" data-testid="button-notifications">
              <Bell className="h-5 w-5" />
              {unreadCount > 0 && <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-destructive" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>Notifications</TooltipContent>
        </Tooltip>

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
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Theme Preset</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuRadioGroup value={preset.id} onValueChange={setPreset}>
                  {presets.map((p) => (
                    <DropdownMenuRadioItem key={p.id} value={p.id}>
                      {p.name}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/team">Team Settings</Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/admin">Admin</Link>
            </DropdownMenuItem>
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
  useSyncEngineTransport();

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
        <InstanceBar />
        <AppHeader />

        <div className="flex-1 flex min-h-0 overflow-hidden">
          {activeSection?.children && (
            <SectionSidebar title={activeSection.label} items={activeSection.children} location={location} />
          )}
          <main className="flex-1 overflow-auto">{children}</main>
        </div>

        <StatusBar />

        <CommandPalette open={commandPaletteOpen} onOpenChange={(open: boolean) => $commandPaletteOpen.set(open)} />
      </div>
    </StatusBarSlotProvider>
  );
}
