import { useState, useMemo } from 'react';
import { useQuery, useMutation } from 'convex/react';
import { useLocation } from 'wouter';
import {
  Search,
  Filter,
  Grid3X3,
  List,
  Download,
  Check,
  ExternalLink,
  Puzzle,
  Sparkles,
  MessageSquare,
  Zap,
  Music,
  Video,
  Bell,
  Settings2,
  Loader2,
  Upload,
  ToggleLeft,
  ToggleRight,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Toggle } from '@/components/ui/toggle';
import { Skeleton } from '@/components/ui/skeleton';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuCheckboxItem,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { PageHeader } from '@/components/layout/page-header';
import { EmptyState } from '@/components/common/empty-state';
import { ErrorState } from '@/components/common/error-state';
import { cn } from '@/lib/utils';
import { api } from '@convex/_generated/api';
import { useInstance } from '@/hooks/use-instance';
import type { Id } from '@convex/_generated/dataModel';

type ModuleRepoItem = {
  _id: Id<'moduleRepository'>;
  name: string;
  description: string;
  version: string;
  tags: string[];
  manifest: Record<string, unknown>;
  archiveKey: string;
};

type InstalledModuleItem = {
  _id: Id<'installedModules'>;
  instanceId: Id<'instances'>;
  moduleId: Id<'moduleRepository'>;
  enabled: boolean;
  installedAt: number;
  module: ModuleRepoItem | null;
};

type ModuleView = ModuleRepoItem & {
  isInstalled: boolean;
  isEnabled: boolean;
  installedRecordId?: Id<'installedModules'>;
};

const categoryIcons: Record<string, React.ReactNode> = {
  Chat: <MessageSquare className="h-4 w-4" />,
  Alerts: <Bell className="h-4 w-4" />,
  Media: <Video className="h-4 w-4" />,
  Audio: <Music className="h-4 w-4" />,
  Automation: <Zap className="h-4 w-4" />,
  Integrations: <Puzzle className="h-4 w-4" />,
  Effects: <Sparkles className="h-4 w-4" />,
  Utilities: <Settings2 className="h-4 w-4" />,
};

const categories = Object.keys(categoryIcons);

function getCategory(module: ModuleRepoItem): string {
  return (module.manifest?.category as string) || module.tags[0] || 'Utilities';
}

function getAuthor(module: ModuleRepoItem): string {
  return (module.manifest?.author as string) || 'Unknown';
}

interface ModuleCardProps {
  module: ModuleView;
  onInstall: (id: Id<'moduleRepository'>) => void;
  onUninstall: (id: Id<'moduleRepository'>) => void;
  onToggleEnabled: (id: Id<'moduleRepository'>, enabled: boolean) => void;
  isInstalling?: boolean;
}

function ModuleCard({ module, onInstall, onUninstall, onToggleEnabled, isInstalling }: ModuleCardProps) {
  const category = getCategory(module);
  const author = getAuthor(module);
  const CategoryIcon = categoryIcons[category] ? (
    <span className="text-primary">{categoryIcons[category]}</span>
  ) : (
    <Puzzle className="h-4 w-4 text-primary" />
  );

  return (
    <Card
      className="group flex flex-col hover-elevate overflow-visible"
      data-testid={`card-module-${module._id}`}
    >
      <CardContent className="pt-6 flex-1">
        <div className="flex items-start gap-4 mb-4">
          <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            {CategoryIcon}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="font-semibold truncate" data-testid={`text-module-name-${module._id}`}>
                {module.name}
              </h3>
              {module.isInstalled && (
                <Badge variant="secondary" className="shrink-0 text-xs">
                  <Check className="h-3 w-3 mr-1" />
                  Installed
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              v{module.version} · by {author}
            </p>
          </div>
        </div>
        <p className="text-sm text-muted-foreground line-clamp-2 mb-4">
          {module.description}
        </p>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs">
            {category}
          </Badge>
          {module.tags.slice(0, 2).map((tag) => (
            <Badge key={tag} variant="secondary" className="text-xs">
              {tag}
            </Badge>
          ))}
        </div>
      </CardContent>
      <CardFooter className="pt-0 gap-2">
        {module.isInstalled ? (
          <>
            <Button
              variant="outline"
              size="sm"
              className="flex-1"
              onClick={() => onToggleEnabled(module._id, !module.isEnabled)}
              data-testid={`button-toggle-${module._id}`}
            >
              {module.isEnabled ? (
                <><ToggleRight className="h-4 w-4 mr-2 text-green-500" />Enabled</>
              ) : (
                <><ToggleLeft className="h-4 w-4 mr-2" />Disabled</>
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onUninstall(module._id)}
              data-testid={`button-uninstall-${module._id}`}
            >
              <ExternalLink className="h-4 w-4" />
            </Button>
          </>
        ) : (
          <Button
            size="sm"
            className="flex-1"
            onClick={() => onInstall(module._id)}
            disabled={isInstalling}
            data-testid={`button-install-${module._id}`}
          >
            {isInstalling ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Download className="h-4 w-4 mr-2" />
            )}
            {isInstalling ? 'Installing...' : 'Install'}
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}

function ModuleCardSkeleton() {
  return (
    <Card className="flex flex-col">
      <CardContent className="pt-6 flex-1">
        <div className="flex items-start gap-4 mb-4">
          <Skeleton className="h-12 w-12 rounded-lg" />
          <div className="flex-1">
            <Skeleton className="h-5 w-32 mb-2" />
            <Skeleton className="h-3 w-24" />
          </div>
        </div>
        <Skeleton className="h-4 w-full mb-2" />
        <Skeleton className="h-4 w-3/4 mb-4" />
        <Skeleton className="h-5 w-20" />
      </CardContent>
      <CardFooter className="pt-0">
        <Skeleton className="h-8 w-full" />
      </CardFooter>
    </Card>
  );
}

export default function Modules() {
  const [, navigate] = useLocation();
  const { instance, isLoading: instanceLoading } = useInstance();
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [sortBy, setSortBy] = useState('name');
  const [activeTab, setActiveTab] = useState('installed');
  const [installingId, setInstallingId] = useState<Id<'moduleRepository'> | null>(null);

  const repoModules = useQuery(api.moduleRepository.list, {}) as ModuleRepoItem[] | undefined;
  const installedModules = useQuery(
    api.installedModules.listForInstance,
    instance ? { instanceId: instance._id } : 'skip'
  ) as InstalledModuleItem[] | undefined;

  const installModule = useMutation(api.installedModules.install);
  const uninstallModule = useMutation(api.installedModules.uninstall);
  const setEnabled = useMutation(api.installedModules.setEnabled);

  const isLoading = instanceLoading || repoModules === undefined;

  // Merge repo modules with installed status
  const allModules = useMemo((): ModuleView[] => {
    if (!repoModules) return [];
    const installedMap = new Map<string, InstalledModuleItem>();
    (installedModules ?? []).forEach((im) => installedMap.set(im.moduleId, im));

    return repoModules.map((m) => {
      const installed = installedMap.get(m._id);
      return {
        ...m,
        isInstalled: !!installed,
        isEnabled: installed?.enabled ?? false,
        installedRecordId: installed?._id,
      };
    });
  }, [repoModules, installedModules]);

  const installedModuleViews = useMemo(
    () => allModules.filter((m) => m.isInstalled),
    [allModules]
  );

  const filterModules = (modules: ModuleView[]) => {
    let result = modules;

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        (m) =>
          m.name.toLowerCase().includes(query) ||
          m.description.toLowerCase().includes(query) ||
          getCategory(m).toLowerCase().includes(query)
      );
    }

    if (selectedCategories.length > 0) {
      result = result.filter((m) => selectedCategories.includes(getCategory(m)));
    }

    result = [...result].sort((a, b) => {
      if (sortBy === 'name') return a.name.localeCompare(b.name);
      if (sortBy === 'category') return getCategory(a).localeCompare(getCategory(b));
      return 0;
    });

    return result;
  };

  const handleInstall = async (moduleId: Id<'moduleRepository'>) => {
    if (!instance) return;
    setInstallingId(moduleId);
    try {
      await installModule({ instanceId: instance._id, moduleId });
    } catch (err) {
      console.error('Install failed:', err);
    } finally {
      setInstallingId(null);
    }
  };

  const handleUninstall = async (moduleId: Id<'moduleRepository'>) => {
    if (!instance) return;
    await uninstallModule({ instanceId: instance._id, moduleId }).catch(console.error);
  };

  const handleToggleEnabled = async (moduleId: Id<'moduleRepository'>, enabled: boolean) => {
    if (!instance) return;
    await setEnabled({ instanceId: instance._id, moduleId, enabled }).catch(console.error);
  };

  const toggleCategory = (category: string) => {
    setSelectedCategories((prev) =>
      prev.includes(category) ? prev.filter((c) => c !== category) : [...prev, category]
    );
  };

  const renderModuleGrid = (modules: ModuleView[]) => {
    const filtered = filterModules(modules);
    if (filtered.length === 0) return null;
    return viewMode === 'grid' ? (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {filtered.map((module) => (
          <ModuleCard
            key={module._id}
            module={module}
            onInstall={handleInstall}
            onUninstall={handleUninstall}
            onToggleEnabled={handleToggleEnabled}
            isInstalling={installingId === module._id}
          />
        ))}
      </div>
    ) : (
      <Card>
        {filtered.map((module) => {
          const category = getCategory(module);
          const CategoryIcon = categoryIcons[category] || <Puzzle className="h-4 w-4" />;
          return (
            <div
              key={module._id}
              className="flex items-center gap-4 p-4 border-b last:border-0 hover-elevate"
              data-testid={`item-module-${module._id}`}
            >
              <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 text-primary">
                {CategoryIcon}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="font-medium truncate">{module.name}</h3>
                  {module.isInstalled && (
                    <Badge variant="secondary" className="text-xs">Installed</Badge>
                  )}
                </div>
                <p className="text-sm text-muted-foreground truncate">{module.description}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Badge variant="outline" className="text-xs hidden sm:flex">{category}</Badge>
                <span className="text-xs text-muted-foreground hidden md:block">v{module.version}</span>
                {module.isInstalled ? (
                  <Button variant="outline" size="sm" onClick={() => handleToggleEnabled(module._id, !module.isEnabled)}>
                    {module.isEnabled ? 'Disable' : 'Enable'}
                  </Button>
                ) : (
                  <Button size="sm" onClick={() => handleInstall(module._id)} disabled={installingId === module._id}>
                    {installingId === module._id ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Download className="h-4 w-4 mr-2" />
                    )}
                    Install
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </Card>
    );
  };

  return (
    <div className="p-6 lg:p-8 max-w-[1600px] mx-auto">
      <PageHeader
        title="Modules"
        description="Browse and manage your stream automation modules."
        actions={
          <Button onClick={() => navigate('/modules/install')} variant="outline">
            <Upload className="h-4 w-4 mr-2" />
            Install Module
          </Button>
        }
      />

      <Tabs value={activeTab} onValueChange={setActiveTab} className="mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <TabsList>
            <TabsTrigger value="installed" data-testid="tab-installed-modules">
              Installed
              <Badge variant="secondary" className="ml-2">{installedModuleViews.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="all" data-testid="tab-all-modules">
              All Modules
              <Badge variant="secondary" className="ml-2">{allModules.length}</Badge>
            </TabsTrigger>
          </TabsList>

          <div className="flex items-center gap-2">
            <div className="relative flex-1 sm:w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search modules..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
                data-testid="input-search-modules"
              />
            </div>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" data-testid="button-filter-modules">
                  <Filter className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuLabel>Categories</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {categories.map((category) => (
                  <DropdownMenuCheckboxItem
                    key={category}
                    checked={selectedCategories.includes(category)}
                    onCheckedChange={() => toggleCategory(category)}
                  >
                    <span className="flex items-center gap-2">
                      {categoryIcons[category]}
                      {category}
                    </span>
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <Select value={sortBy} onValueChange={setSortBy}>
              <SelectTrigger className="w-32 hidden sm:flex" data-testid="select-sort-modules">
                <SelectValue placeholder="Sort by" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="name">Name</SelectItem>
                <SelectItem value="category">Category</SelectItem>
              </SelectContent>
            </Select>

            <div className="flex items-center border rounded-md">
              <Toggle
                pressed={viewMode === 'grid'}
                onPressedChange={() => setViewMode('grid')}
                size="sm"
                className="rounded-r-none"
                data-testid="button-view-grid"
              >
                <Grid3X3 className="h-4 w-4" />
              </Toggle>
              <Toggle
                pressed={viewMode === 'list'}
                onPressedChange={() => setViewMode('list')}
                size="sm"
                className="rounded-l-none"
                data-testid="button-view-list"
              >
                <List className="h-4 w-4" />
              </Toggle>
            </div>
          </div>
        </div>

        <TabsContent value="all" className="mt-0">
          {isLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <ModuleCardSkeleton key={i} />
              ))}
            </div>
          ) : filterModules(allModules).length === 0 ? (
            <EmptyState
              icon={Puzzle}
              title="No modules found"
              description="Try adjusting your search or filters, or install a module from a zip file."
              action={{ label: 'Clear Filters', onClick: () => { setSearchQuery(''); setSelectedCategories([]); } }}
            />
          ) : (
            renderModuleGrid(allModules)
          )}
        </TabsContent>

        <TabsContent value="installed" className="mt-0">
          {isLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <ModuleCardSkeleton key={i} />
              ))}
            </div>
          ) : filterModules(installedModuleViews).length === 0 ? (
            <EmptyState
              icon={Puzzle}
              title="No installed modules"
              description="Browse the module library to find and install modules for your stream."
              action={{ label: 'Browse Modules', onClick: () => setActiveTab('all') }}
            />
          ) : (
            renderModuleGrid(installedModuleViews)
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
