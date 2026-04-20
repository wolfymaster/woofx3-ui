import { useState, useCallback } from 'react';
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
  Building2,
  ChevronRight,
  ChevronDown,
  Search,
  Bell,
  Command,
  Sun,
  Moon,
  PanelLeftClose,
  PanelLeft,
  Palette,
  LogOut,
  HelpCircle,
  Radio
} from 'lucide-react';
import { Link, useLocation } from 'wouter';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ScrollArea } from '@/components/ui/scroll-area';
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
import { $sidebarCollapsed, $commandPaletteOpen, $notifications } from '@/lib/stores';
import { useTheme } from '@/hooks/use-theme';
import type { NavigationItem } from '@/types';

const navigationItems: NavigationItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: 'LayoutDashboard', href: '/' },
  { 
    id: 'modules', 
    label: 'Modules', 
    icon: 'Puzzle',
    children: [
      { id: 'browse', label: 'Browse Modules', icon: 'Search', href: '/modules' },
      { id: 'installed', label: 'Installed', icon: 'Puzzle', href: '/modules/installed' },
    ]
  },
  { 
    id: 'workflows', 
    label: 'Workflows', 
    icon: 'Workflow',
    children: [
      { id: 'all-workflows', label: 'All Workflows', icon: 'Workflow', href: '/workflows' },
      { id: 'new-workflow', label: 'Create New', icon: 'Workflow', href: '/workflows/new' },
    ]
  },
  { id: 'assets', label: 'Assets', icon: 'FolderOpen', href: '/assets' },
  { id: 'scenes', label: 'Scene Editor', icon: 'Layers', href: '/scenes' },
];

const bottomNavItems: NavigationItem[] = [
  { id: 'team', label: 'Team', icon: 'Users', href: '/team' },
  { id: 'settings', label: 'Settings', icon: 'Settings', href: '/settings' },
];

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  LayoutDashboard,
  Puzzle,
  Workflow,
  FolderOpen,
  Layers,
  Settings,
  Users,
  Search,
  Building2,
};

interface NavItemProps {
  item: NavigationItem;
  collapsed: boolean;
  depth?: number;
}

function NavItem({ item, collapsed, depth = 0 }: NavItemProps) {
  const [location] = useLocation();
  const [isExpanded, setIsExpanded] = useState(false);
  const Icon = iconMap[item.icon] || LayoutDashboard;
  const hasChildren = item.children && item.children.length > 0;
  const isActive = item.href ? location === item.href : item.children?.some(child => location === child.href);

  const handleClick = useCallback(() => {
    if (hasChildren) {
      setIsExpanded(!isExpanded);
    }
  }, [hasChildren, isExpanded]);

  const content = (
    <div
      className={cn(
        'group flex items-center gap-3 px-3 py-2 rounded-md cursor-pointer transition-colors',
        'hover-elevate active-elevate-2',
        isActive && 'bg-sidebar-accent text-sidebar-accent-foreground',
        !isActive && 'text-sidebar-foreground/70 hover:text-sidebar-foreground',
        depth > 0 && 'ml-4'
      )}
      onClick={handleClick}
      data-testid={`nav-item-${item.id}`}
    >
      <Icon className={cn('h-5 w-5 shrink-0', isActive && 'text-primary')} />
      {!collapsed && (
        <>
          <span className="flex-1 text-sm font-medium truncate">{item.label}</span>
          {item.badge && (
            <Badge variant="secondary" className="text-xs px-1.5 py-0.5">
              {item.badge}
            </Badge>
          )}
          {hasChildren && (
            <motion.div
              initial={false}
              animate={{ rotate: isExpanded ? 90 : 0 }}
              transition={{ duration: 0.15 }}
            >
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </motion.div>
          )}
        </>
      )}
    </div>
  );

  const wrappedContent = item.href && !hasChildren ? (
    <Link href={item.href}>{content}</Link>
  ) : (
    content
  );

  if (collapsed && !hasChildren) {
    return (
      <Tooltip delayDuration={0}>
        <TooltipTrigger asChild>
          {item.href ? (
            <Link href={item.href}>{content}</Link>
          ) : (
            content
          )}
        </TooltipTrigger>
        <TooltipContent side="right" className="font-medium">
          {item.label}
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <div>
      {collapsed ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>{content}</DropdownMenuTrigger>
          <DropdownMenuContent side="right" align="start" className="w-48">
            <DropdownMenuLabel>{item.label}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {item.children?.map((child) => (
              <DropdownMenuItem key={child.id} asChild>
                <Link href={child.href || '#'} className="cursor-pointer">
                  {child.label}
                </Link>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <>
          {wrappedContent}
          <AnimatePresence initial={false}>
            {hasChildren && isExpanded && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div className="mt-1 space-y-1">
                  {item.children?.map((child) => (
                    <NavItem key={child.id} item={child} collapsed={collapsed} depth={depth + 1} />
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}
    </div>
  );
}

function TeamSwitcher({ collapsed }: { collapsed: boolean }) {
  const displayName = 'Select Instance';
  const initials = displayName.slice(0, 2).toUpperCase();

  if (collapsed) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="w-10 h-10" data-testid="button-team-switcher">
            <Avatar className="h-8 w-8">
              <AvatarImage src={undefined} />
              <AvatarFallback className="bg-primary/10 text-primary text-xs font-semibold">
                {initials}
              </AvatarFallback>
            </Avatar>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="right" align="start" className="w-56">
          <DropdownMenuLabel>Switch Context</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem>
            <Building2 className="mr-2 h-4 w-4" />
            Demo Team
          </DropdownMenuItem>
          <DropdownMenuItem>
            <Building2 className="mr-2 h-4 w-4" />
            Production Team
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="w-full justify-start gap-3 px-3 py-6 h-auto hover-elevate"
          data-testid="button-team-switcher"
        >
          <Avatar className="h-9 w-9">
            <AvatarImage src={undefined} />
            <AvatarFallback className="bg-primary/10 text-primary text-sm font-semibold">
              {initials}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 text-left">
            <p className="text-sm font-semibold truncate">{displayName}</p>
            <p className="text-xs text-muted-foreground truncate">
              {'Instance'}
            </p>
          </div>
          <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[--radix-dropdown-menu-trigger-width]">
        <DropdownMenuLabel>Switch Context</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Building2 className="mr-2 h-4 w-4" />
            Teams
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuItem>Demo Team</DropdownMenuItem>
            <DropdownMenuItem>Production Team</DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Users className="mr-2 h-4 w-4" />
            Accounts
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuItem>Main Channel</DropdownMenuItem>
            <DropdownMenuItem>Gaming Channel</DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function UserMenu({ collapsed }: { collapsed: boolean }) {
  const { theme, toggleTheme, preset, presets, setPreset } = useTheme();

  const displayName = 'Demo User';
  const email = 'demo@woofx3.io';
  const initials = displayName.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase();

  const content = (
    <div className={cn(
      'flex items-center gap-3 px-3 py-2 rounded-md cursor-pointer hover-elevate',
      collapsed && 'justify-center'
    )}>
      <Avatar className="h-8 w-8">
        <AvatarImage src={undefined} />
        <AvatarFallback className="bg-muted text-muted-foreground text-xs font-medium">
          {initials}
        </AvatarFallback>
      </Avatar>
      {!collapsed && (
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{displayName}</p>
          <p className="text-xs text-muted-foreground truncate">{email}</p>
        </div>
      )}
    </div>
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <div data-testid="button-user-menu">{content}</div>
      </DropdownMenuTrigger>
      <DropdownMenuContent side={collapsed ? 'right' : 'top'} align="start" className="w-56">
        <DropdownMenuLabel className="font-normal">
          <div className="flex flex-col space-y-1">
            <p className="text-sm font-medium">{displayName}</p>
            <p className="text-xs text-muted-foreground">{email}</p>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Palette className="mr-2 h-4 w-4" />
            Theme
          </DropdownMenuSubTrigger>
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
        <DropdownMenuItem onClick={toggleTheme}>
          {theme === 'dark' ? (
            <>
              <Sun className="mr-2 h-4 w-4" />
              Light Mode
            </>
          ) : (
            <>
              <Moon className="mr-2 h-4 w-4" />
              Dark Mode
            </>
          )}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem>
          <HelpCircle className="mr-2 h-4 w-4" />
          Help & Support
        </DropdownMenuItem>
        <DropdownMenuItem className="text-destructive">
          <LogOut className="mr-2 h-4 w-4" />
          Sign Out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface AppShellProps {
  children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const collapsed = useStore($sidebarCollapsed);
  const notifications = useStore($notifications);
  const { theme, toggleTheme } = useTheme();
  const [location] = useLocation();

  const unreadCount = notifications.filter(n => !n.read).length;

  const toggleSidebar = useCallback(() => {
    $sidebarCollapsed.set(!collapsed);
  }, [collapsed]);

  const openCommandPalette = useCallback(() => {
    $commandPaletteOpen.set(true);
  }, []);

  const getBreadcrumbs = () => {
    const paths = location.split('/').filter(Boolean);
    if (paths.length === 0) return [{ label: 'Dashboard', href: '/' }];
    
    return [
      { label: 'Home', href: '/' },
      ...paths.map((path, idx) => ({
        label: path.charAt(0).toUpperCase() + path.slice(1).replace(/-/g, ' '),
        href: '/' + paths.slice(0, idx + 1).join('/'),
      })),
    ];
  };

  const breadcrumbs = getBreadcrumbs();

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      <motion.aside
        initial={false}
        animate={{ width: collapsed ? 64 : 280 }}
        transition={{ duration: 0.2, ease: 'easeInOut' }}
        className="flex flex-col bg-sidebar border-r border-sidebar-border shrink-0"
      >
        <div className="p-2">
          <TeamSwitcher collapsed={collapsed} />
        </div>

        <Separator className="bg-sidebar-border" />

        <ScrollArea className="flex-1 px-2 py-4">
          <nav className="space-y-1">
            {navigationItems.map((item) => (
              <NavItem key={item.id} item={item} collapsed={collapsed} />
            ))}
          </nav>
        </ScrollArea>

        <Separator className="bg-sidebar-border" />

        <div className="px-2 py-2 space-y-1">
          {bottomNavItems.map((item) => (
            <NavItem key={item.id} item={item} collapsed={collapsed} />
          ))}
        </div>

        <Separator className="bg-sidebar-border" />

        <div className="p-2">
          <UserMenu collapsed={collapsed} />
        </div>
      </motion.aside>

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="h-14 border-b border-border bg-background/80 backdrop-blur-sm flex items-center justify-between px-4 gap-4 shrink-0">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleSidebar}
              data-testid="button-toggle-sidebar"
            >
              {collapsed ? (
                <PanelLeft className="h-5 w-5" />
              ) : (
                <PanelLeftClose className="h-5 w-5" />
              )}
            </Button>

            <nav className="flex items-center gap-1 text-sm" data-testid="nav-breadcrumbs">
              {breadcrumbs.map((crumb, idx) => (
                <span key={crumb.href} className="flex items-center gap-1">
                  {idx > 0 && <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                  {idx === breadcrumbs.length - 1 ? (
                    <span className="font-medium text-foreground">{crumb.label}</span>
                  ) : (
                    <Link href={crumb.href} className="text-muted-foreground hover:text-foreground transition-colors">
                      {crumb.label}
                    </Link>
                  )}
                </span>
              ))}
            </nav>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              className="hidden md:flex items-center gap-2 text-muted-foreground w-64 justify-start"
              onClick={openCommandPalette}
              data-testid="button-command-palette"
            >
              <Search className="h-4 w-4" />
              <span className="flex-1 text-left">Search...</span>
              <kbd className="pointer-events-none flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
                <Command className="h-3 w-3" />K
              </kbd>
            </Button>

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
                  {theme === 'dark' ? (
                    <Sun className="h-5 w-5" />
                  ) : (
                    <Moon className="h-5 w-5" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {theme === 'dark' ? 'Light mode' : 'Dark mode'}
              </TooltipContent>
            </Tooltip>

            <div className="flex items-center gap-2 pl-2 border-l border-border">
              <div className="flex items-center gap-1.5">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                </span>
                <span className="text-xs text-muted-foreground hidden sm:inline">Live</span>
              </div>
              <Button size="sm" className="gap-2" data-testid="button-go-live">
                <Radio className="h-4 w-4" />
                <span className="hidden sm:inline">Control Room</span>
              </Button>
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
