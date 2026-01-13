import { useCallback, useEffect, useState } from 'react';
import { useStore } from '@nanostores/react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  LayoutDashboard, 
  Puzzle, 
  Workflow, 
  FolderOpen, 
  Layers, 
  Settings,
  Users,
  Search,
  Bell,
  Command,
  Sun,
  Moon,
  Radio,
  ChevronUp,
  ChevronDown,
  Circle,
  Activity,
  Volume2,
  VolumeX,
  MonitorPlay
} from 'lucide-react';
import { Link, useLocation } from 'wouter';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Separator } from '@/components/ui/separator';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from '@/components/ui/dropdown-menu';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
} from '@/components/ui/sidebar';
import { $currentTeam, $currentUser, $commandPaletteOpen, $notifications } from '@/lib/stores';
import { useTheme } from '@/hooks/use-theme';
import { CommandPalette } from './command-palette';
import { ContextRibbon } from './context-ribbon';

interface WorkspaceItem {
  id: string;
  label: string;
  shortLabel: string;
  icon: React.ComponentType<{ className?: string }>;
  href: string;
  color: string;
}

const workspaces: WorkspaceItem[] = [
  { id: 'dashboard', label: 'Dashboard', shortLabel: 'DASH', icon: LayoutDashboard, href: '/', color: 'bg-blue-500' },
  { id: 'modules', label: 'Modules', shortLabel: 'MOD', icon: Puzzle, href: '/modules', color: 'bg-purple-500' },
  { id: 'workflows', label: 'Workflows', shortLabel: 'WRK', icon: Workflow, href: '/workflows', color: 'bg-amber-500' },
  { id: 'assets', label: 'Assets', shortLabel: 'AST', icon: FolderOpen, href: '/assets', color: 'bg-green-500' },
  { id: 'scenes', label: 'Scenes', shortLabel: 'SCN', icon: Layers, href: '/scenes', color: 'bg-rose-500' },
];

const utilityItems = [
  { id: 'team', label: 'Team', icon: Users, href: '/team' },
  { id: 'settings', label: 'Settings', icon: Settings, href: '/settings' },
];

function StreamStatus() {
  const [isLive] = useState(true);
  const [uptime] = useState('02:34:17');
  const [viewers] = useState(1247);

  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-card border border-border">
        <span className="relative flex h-2.5 w-2.5">
          {isLive && (
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
          )}
          <span className={cn(
            "relative inline-flex rounded-full h-2.5 w-2.5",
            isLive ? "bg-red-500" : "bg-muted-foreground"
          )} />
        </span>
        <span className={cn(
          "text-xs font-bold uppercase tracking-wider",
          isLive ? "text-red-500" : "text-muted-foreground"
        )}>
          {isLive ? 'LIVE' : 'OFFLINE'}
        </span>
      </div>

      {isLive && (
        <>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Activity className="h-3.5 w-3.5" />
            <span className="font-mono">{uptime}</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Circle className="h-3 w-3 fill-current" />
            <span className="font-medium">{viewers.toLocaleString()}</span>
          </div>
        </>
      )}
    </div>
  );
}

function TransportControls() {
  const [isLive, setIsLive] = useState(true);
  const [isMuted, setIsMuted] = useState(false);

  return (
    <div className="flex items-center gap-1">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant={isLive ? "destructive" : "default"}
            size="sm"
            className="gap-2 font-semibold"
            onClick={() => setIsLive(!isLive)}
            data-testid="button-toggle-live"
          >
            <Radio className="h-4 w-4" />
            {isLive ? 'END STREAM' : 'GO LIVE'}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{isLive ? 'End your stream' : 'Start streaming'}</TooltipContent>
      </Tooltip>

      <Separator orientation="vertical" className="h-6 mx-2" />

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setIsMuted(!isMuted)}
            data-testid="button-toggle-mute"
          >
            {isMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{isMuted ? 'Unmute' : 'Mute'}</TooltipContent>
      </Tooltip>
    </div>
  );
}

function WorkspaceDock() {
  const [location] = useLocation();
  const [isExpanded, setIsExpanded] = useState(true);

  const currentWorkspace = workspaces.find(w => {
    if (w.href === '/') return location === '/';
    return location.startsWith(w.href);
  }) || workspaces[0];

  return (
    <motion.div
      initial={false}
      animate={{ height: isExpanded ? 'auto' : 48 }}
      className="bg-card/95 backdrop-blur-md border-t border-border"
    >
      <div className="flex items-center justify-between px-2 h-12">
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => setIsExpanded(!isExpanded)}
            data-testid="button-toggle-dock"
          >
            {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
          </Button>
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Workspaces
          </span>
        </div>

        {!isExpanded && (
          <div className="flex items-center gap-1">
            {workspaces.map((workspace) => {
              const Icon = workspace.icon;
              const isActive = workspace === currentWorkspace;
              return (
                <Tooltip key={workspace.id}>
                  <TooltipTrigger asChild>
                    <Link href={workspace.href}>
                      <Button
                        variant={isActive ? "secondary" : "ghost"}
                        size="icon"
                        className="h-8 w-8"
                        data-testid={`dock-item-${workspace.id}-collapsed`}
                      >
                        <Icon className={cn("h-4 w-4", isActive && "text-primary")} />
                      </Button>
                    </Link>
                  </TooltipTrigger>
                  <TooltipContent>{workspace.label}</TooltipContent>
                </Tooltip>
              );
            })}
          </div>
        )}

        <div className="flex items-center gap-1">
          {utilityItems.map((item) => {
            const Icon = item.icon;
            const isActive = location === item.href;
            return (
              <Tooltip key={item.id}>
                <TooltipTrigger asChild>
                  <Link href={item.href}>
                    <Button
                      variant={isActive ? "secondary" : "ghost"}
                      size="icon"
                      className="h-8 w-8"
                      data-testid={`dock-utility-${item.id}`}
                    >
                      <Icon className={cn("h-4 w-4", isActive && "text-primary")} />
                    </Button>
                  </Link>
                </TooltipTrigger>
                <TooltipContent>{item.label}</TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      </div>

      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="px-2 pb-2"
          >
            <div className="flex items-stretch gap-2">
              {workspaces.map((workspace) => {
                const Icon = workspace.icon;
                const isActive = workspace === currentWorkspace;
                return (
                  <Link key={workspace.id} href={workspace.href} className="flex-1">
                    <motion.div
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      className={cn(
                        "relative flex flex-col items-center justify-center gap-2 p-4 rounded-lg cursor-pointer transition-all",
                        "border-2",
                        isActive
                          ? "bg-primary/10 border-primary shadow-lg shadow-primary/20"
                          : "bg-background/50 border-border hover:border-primary/50 hover:bg-background"
                      )}
                      data-testid={`dock-item-${workspace.id}`}
                    >
                      <div className={cn(
                        "flex items-center justify-center w-10 h-10 rounded-lg",
                        workspace.color,
                        "text-white shadow-md"
                      )}>
                        <Icon className="h-5 w-5" />
                      </div>
                      
                      <div className="text-center">
                        <div className={cn(
                          "text-xs font-bold uppercase tracking-wider",
                          isActive ? "text-primary" : "text-muted-foreground"
                        )}>
                          {workspace.shortLabel}
                        </div>
                        <div className="text-[10px] text-muted-foreground mt-0.5">
                          {workspace.label}
                        </div>
                      </div>

                      {isActive && (
                        <motion.div
                          layoutId="workspace-indicator"
                          className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 w-8 h-1 bg-primary rounded-full"
                        />
                      )}
                    </motion.div>
                  </Link>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function BroadcastHeader() {
  const notifications = useStore($notifications);
  const currentUser = useStore($currentUser);
  const currentTeam = useStore($currentTeam);
  const { theme, toggleTheme, preset, presets, setPreset } = useTheme();

  const unreadCount = notifications.filter(n => !n.read).length;
  const displayName = currentUser?.displayName || 'Demo User';
  const teamName = currentTeam?.name || 'StreamControl';
  const initials = displayName.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();

  const openCommandPalette = useCallback(() => {
    $commandPaletteOpen.set(true);
  }, []);

  return (
    <header className="h-14 bg-card/95 backdrop-blur-md border-b border-border flex items-center justify-between px-4 gap-4 shrink-0 z-50">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary text-primary-foreground">
            <MonitorPlay className="h-4 w-4" />
          </div>
          <span className="font-bold text-lg tracking-tight">{teamName}</span>
        </div>

        <Separator orientation="vertical" className="h-6" />

        <StreamStatus />
      </div>

      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          className="hidden md:flex items-center gap-2 text-muted-foreground w-56 justify-start bg-background/50"
          onClick={openCommandPalette}
          data-testid="button-command-palette"
        >
          <Search className="h-4 w-4" />
          <span className="flex-1 text-left text-xs">Quick actions...</span>
          <kbd className="pointer-events-none flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
            <Command className="h-3 w-3" />K
          </kbd>
        </Button>

        <Separator orientation="vertical" className="h-6" />

        <TransportControls />

        <Separator orientation="vertical" className="h-6" />

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="relative" data-testid="button-notifications">
              <Bell className="h-5 w-5" />
              {unreadCount > 0 && (
                <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-destructive" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>Notifications</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" onClick={toggleTheme} data-testid="button-theme-toggle">
              {theme === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{theme === 'dark' ? 'Light mode' : 'Dark mode'}</TooltipContent>
        </Tooltip>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="h-9 w-9 rounded-full p-0" data-testid="button-user-menu">
              <Avatar className="h-8 w-8">
                <AvatarImage src={currentUser?.avatarUrl} />
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
                <p className="text-xs text-muted-foreground">{currentUser?.email || 'demo@streamcontrol.io'}</p>
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
              <Link href="/settings">Preferences</Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}

function AppSidebar() {
  const [location] = useLocation();
  
  return (
    <Sidebar collapsible="icon" className="border-r-0">
      <SidebarContent className="bg-sidebar">
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {workspaces.map((item) => {
                const isActive = item.href === '/' 
                  ? location === '/' 
                  : location.startsWith(item.href);
                return (
                  <SidebarMenuItem key={item.id}>
                    <SidebarMenuButton 
                      asChild 
                      isActive={isActive}
                      tooltip={item.label}
                      data-testid={`sidebar-nav-${item.id}`}
                    >
                      <Link href={item.href}>
                        <item.icon className="h-4 w-4" />
                        <span>{item.label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <div className="mt-auto">
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {utilityItems.map((item) => {
                  const isActive = location === item.href;
                  return (
                    <SidebarMenuItem key={item.id}>
                      <SidebarMenuButton 
                        asChild 
                        isActive={isActive}
                        tooltip={item.label}
                        data-testid={`sidebar-utility-${item.id}`}
                      >
                        <Link href={item.href}>
                          <item.icon className="h-4 w-4" />
                          <span>{item.label}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </div>
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  );
}

interface BroadcastShellProps {
  children: React.ReactNode;
}

export function BroadcastShell({ children }: BroadcastShellProps) {
  const commandPaletteOpen = useStore($commandPaletteOpen);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        $commandPaletteOpen.set(true);
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const style = {
    "--sidebar-width": "13rem",
    "--sidebar-width-icon": "3rem",
  };

  return (
    <SidebarProvider defaultOpen={false} style={style as React.CSSProperties}>
      <div className="flex h-screen w-full overflow-hidden bg-background">
        <AppSidebar />
        
        <div className="flex flex-col flex-1 min-w-0">
          <BroadcastHeader />
          <ContextRibbon />
          
          <main className="flex-1 overflow-auto">
            {children}
          </main>
          
          <WorkspaceDock />
        </div>
      </div>
      
      <CommandPalette 
        open={commandPaletteOpen} 
        onOpenChange={(open: boolean) => $commandPaletteOpen.set(open)} 
      />
    </SidebarProvider>
  );
}
