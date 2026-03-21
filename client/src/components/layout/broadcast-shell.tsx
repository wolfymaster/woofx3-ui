import { useCallback, useEffect, useState } from 'react';
import { useStore } from '@nanostores/react';
import { useQuery } from '@tanstack/react-query';
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
  Activity,
  Volume2,
  VolumeX,
  MonitorPlay,
  Circle,
  ChevronDown,
  Check,
  Pencil
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
import { $commandPaletteOpen, $notifications } from '@/lib/stores';
import { useConvexUser, useAuthActions } from '@/hooks/use-convex-auth';
import { useInstance } from '@/hooks/use-instance';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useTheme } from '@/hooks/use-theme';
import { CommandPalette } from './command-palette';
import { useMutation } from 'convex/react';
import { api } from '@convex/_generated/api';

interface NavItem {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  href: string;
}

const mainNavItems: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, href: '/' },
  { id: 'modules', label: 'Modules', icon: Puzzle, href: '/modules' },
  { id: 'workflows', label: 'Workflows', icon: Workflow, href: '/workflows' },
  { id: 'assets', label: 'Assets', icon: FolderOpen, href: '/assets' },
  { id: 'scenes', label: 'Scenes', icon: Layers, href: '/scenes' },
];

const utilityItems: NavItem[] = [
  { id: 'team', label: 'Team', icon: Users, href: '/team' },
  { id: 'settings', label: 'Settings', icon: Settings, href: '/settings' },
];

interface StreamStatusProps {
  accountId?: string;
}

function StreamStatus({ accountId = 'default' }: StreamStatusProps) {
  const { data: status } = useQuery({
    queryKey: ['streamStatus', accountId],
    queryFn: async () => {
      // TODO: replace with transport.getStreamStatus once transport is wired
      return { isLive: false, uptime: '00:00:00', viewerCount: 0 };
    },
    refetchInterval: 5000,
  });

  const isLive = status?.isLive ?? false;
  const uptime = status?.uptime ?? '00:00:00';
  const viewers = status?.viewerCount ?? 0;

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
  const [isMuted, setIsMuted] = useState(false);

  return (
    <div className="flex items-center gap-1">
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

function AppHeader() {
  const notifications = useStore($notifications);
  const { user } = useConvexUser();
  const { signOut } = useAuthActions();
  const { instance, instances, setInstance } = useInstance();
  const { preset, presets, setPreset } = useTheme();

  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editName, setEditName] = useState('');

  const updateInstance = useMutation(api.instances.update);

  const unreadCount = notifications.filter(n => !n.read).length;
  const displayName = (user as any)?.name || 'User';
  const instanceDisplayName = instance?.name || 'No Instance';
  const instanceId = instance?._id || 'default';
  const initials = displayName.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase();

  const openCommandPalette = useCallback(() => {
    $commandPaletteOpen.set(true);
  }, []);

  const handleEditInstance = () => {
    setEditName(instance?.name || '');
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
    <header className="h-14 bg-card border-b border-border flex items-center justify-between px-4 gap-4 shrink-0">
      <div className="flex items-center gap-4">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="flex items-center gap-2 px-2 h-auto py-1.5">
              <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary text-primary-foreground">
                <MonitorPlay className="h-4 w-4" />
              </div>
              <span className="font-bold text-lg tracking-tight hidden sm:block">{instanceDisplayName}</span>
              <ChevronDown className="h-4 w-4 text-muted-foreground hidden sm:block" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64">
            <DropdownMenuLabel>Switch Instance</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {instances.map((inst: { _id: string; name: string }) => inst && (
              <DropdownMenuItem
                key={inst._id}
                onClick={() => setInstance(inst._id)}
                className="flex items-center justify-between"
              >
                <span>{inst.name}</span>
                {inst._id === instance?._id && (
                  <Check className="h-4 w-4 text-primary" />
                )}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleEditInstance}>
              <Pencil className="h-4 w-4 mr-2" />
              Rename Instance
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Separator orientation="vertical" className="h-6 hidden md:block" />

        <div className="hidden md:block">
          <StreamStatus accountId={instanceId} />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          className="hidden lg:flex items-center gap-2 text-muted-foreground w-56 justify-start bg-background/50"
          onClick={openCommandPalette}
          data-testid="button-command-palette"
        >
          <Search className="h-4 w-4" />
          <span className="flex-1 text-left text-xs">Quick actions...</span>
          <kbd className="pointer-events-none flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
            <Command className="h-3 w-3" />K
          </kbd>
        </Button>

        <div className="hidden md:flex items-center">
          <Separator orientation="vertical" className="h-6 mr-2" />
          <TransportControls />
          <Separator orientation="vertical" className="h-6 ml-2" />
        </div>

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
                <p className="text-xs text-muted-foreground">{(user as any)?.email || ''}</p>
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
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => signOut()} className="text-destructive focus:text-destructive">
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>

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
          <Button onClick={handleSaveInstance}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}

function WorkspaceDock() {
  const [location] = useLocation();

  return (
    <nav className="h-12 bg-muted/30 border-b border-border flex items-center px-4 gap-1 shrink-0">
      <div className="flex items-center gap-1">
        {mainNavItems.map((item) => {
          const isActive = item.href === '/' 
            ? location === '/' 
            : location.startsWith(item.href);
          
          return (
            <Link key={item.id} href={item.href}>
              <Button
                variant={isActive ? "secondary" : "ghost"}
                size="sm"
                className={cn(
                  "gap-2 h-8",
                  isActive && "bg-background shadow-sm"
                )}
                data-testid={`nav-${item.id}`}
              >
                <item.icon className="h-4 w-4" />
                <span className="hidden sm:inline">{item.label}</span>
              </Button>
            </Link>
          );
        })}
      </div>

      <Separator orientation="vertical" className="h-6 mx-2" />

      <div className="flex items-center gap-1">
        {utilityItems.map((item) => {
          const isActive = location === item.href;
          
          return (
            <Link key={item.id} href={item.href}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={isActive ? "secondary" : "ghost"}
                    size="icon"
                    className={cn(
                      "h-8 w-8",
                      isActive && "bg-background shadow-sm"
                    )}
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
    </nav>
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

  return (
    <div className="flex flex-col h-screen w-full overflow-hidden bg-background">
      <AppHeader />
      <WorkspaceDock />
      
      <main className="flex-1 overflow-auto">
        {children}
      </main>
      
      <CommandPalette 
        open={commandPaletteOpen} 
        onOpenChange={(open: boolean) => $commandPaletteOpen.set(open)} 
      />
    </div>
  );
}
