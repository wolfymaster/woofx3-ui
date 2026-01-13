import { useState, useMemo } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { 
  Search, 
  Filter, 
  Grid3X3, 
  List, 
  Download, 
  Check, 
  Star, 
  ExternalLink,
  Puzzle,
  Sparkles,
  MessageSquare,
  Zap,
  Music,
  Video,
  Bell,
  Settings2,
  Loader2
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
  DropdownMenuItem,
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
import { queryClient, apiRequest } from '@/lib/queryClient';
import type { Module, PaginatedResponse } from '@/types';

const categoryIcons: Record<string, React.ReactNode> = {
  'Chat': <MessageSquare className="h-4 w-4" />,
  'Alerts': <Bell className="h-4 w-4" />,
  'Media': <Video className="h-4 w-4" />,
  'Audio': <Music className="h-4 w-4" />,
  'Automation': <Zap className="h-4 w-4" />,
  'Integrations': <Puzzle className="h-4 w-4" />,
  'Effects': <Sparkles className="h-4 w-4" />,
  'Utilities': <Settings2 className="h-4 w-4" />,
};

const categories = Object.keys(categoryIcons);

interface ModuleCardProps {
  module: Module;
  onInstall: (id: string) => void;
  onUninstall: (id: string) => void;
  onConfigure: (id: string) => void;
  isInstalling?: boolean;
}

function ModuleCard({ module, onInstall, onUninstall, onConfigure, isInstalling }: ModuleCardProps) {
  const CategoryIcon = categoryIcons[module.category] ? (
    <span className="text-primary">{categoryIcons[module.category]}</span>
  ) : (
    <Puzzle className="h-4 w-4 text-primary" />
  );

  return (
    <Card 
      className="group flex flex-col hover-elevate overflow-visible"
      data-testid={`card-module-${module.id}`}
    >
      <CardContent className="pt-6 flex-1">
        <div className="flex items-start gap-4 mb-4">
          <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            {CategoryIcon}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="font-semibold truncate" data-testid={`text-module-name-${module.id}`}>
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
              v{module.version} · by {module.author}
            </p>
          </div>
        </div>
        <p className="text-sm text-muted-foreground line-clamp-2 mb-4">
          {module.description}
        </p>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs">
            {module.category}
          </Badge>
        </div>
      </CardContent>
      <CardFooter className="pt-0 gap-2">
        {module.isInstalled ? (
          <>
            <Button 
              variant="outline" 
              size="sm" 
              className="flex-1"
              onClick={() => onConfigure(module.id)}
              data-testid={`button-configure-${module.id}`}
            >
              Configure
            </Button>
            <Button 
              variant="ghost" 
              size="icon"
              data-testid={`button-details-${module.id}`}
            >
              <ExternalLink className="h-4 w-4" />
            </Button>
          </>
        ) : (
          <Button 
            size="sm" 
            className="flex-1"
            onClick={() => onInstall(module.id)}
            disabled={isInstalling}
            data-testid={`button-install-${module.id}`}
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

function ModuleListItem({ module, onInstall, onUninstall, onConfigure, isInstalling }: ModuleCardProps) {
  const CategoryIcon = categoryIcons[module.category] || <Puzzle className="h-4 w-4" />;

  return (
    <div 
      className="flex items-center gap-4 p-4 border-b last:border-0 hover-elevate"
      data-testid={`item-module-${module.id}`}
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
        <Badge variant="outline" className="text-xs hidden sm:flex">{module.category}</Badge>
        <span className="text-xs text-muted-foreground hidden md:block">v{module.version}</span>
        {module.isInstalled ? (
          <Button variant="outline" size="sm" onClick={() => onConfigure(module.id)}>
            Configure
          </Button>
        ) : (
          <Button size="sm" onClick={() => onInstall(module.id)} disabled={isInstalling}>
            {isInstalling ? (
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
}

export default function Modules() {
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [sortBy, setSortBy] = useState('name');
  const [activeTab, setActiveTab] = useState('all');
  const [installingId, setInstallingId] = useState<string | null>(null);

  const { data: modulesData, isLoading, error, refetch } = useQuery<PaginatedResponse<Module>>({
    queryKey: ['/api/modules'],
  });

  const modules = modulesData?.data || [];

  const installMutation = useMutation({
    mutationFn: async (moduleId: string) => {
      setInstallingId(moduleId);
      const response = await apiRequest('POST', `/api/modules/${moduleId}/install`);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/modules'] });
      setInstallingId(null);
    },
    onError: () => {
      setInstallingId(null);
    },
  });

  const uninstallMutation = useMutation({
    mutationFn: async (moduleId: string) => {
      const response = await apiRequest('POST', `/api/modules/${moduleId}/uninstall`);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/modules'] });
    },
  });

  const filteredModules = useMemo(() => {
    let result = modules;

    if (activeTab === 'installed') {
      result = result.filter(m => m.isInstalled);
    }

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(m => 
        m.name.toLowerCase().includes(query) ||
        m.description.toLowerCase().includes(query) ||
        m.category.toLowerCase().includes(query)
      );
    }

    if (selectedCategories.length > 0) {
      result = result.filter(m => selectedCategories.includes(m.category));
    }

    result = [...result].sort((a, b) => {
      if (sortBy === 'name') return a.name.localeCompare(b.name);
      if (sortBy === 'category') return a.category.localeCompare(b.category);
      if (sortBy === 'updated') return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      return 0;
    });

    return result;
  }, [modules, searchQuery, selectedCategories, sortBy, activeTab]);

  const handleInstall = (id: string) => {
    installMutation.mutate(id);
  };

  const handleUninstall = (id: string) => {
    uninstallMutation.mutate(id);
  };

  const handleConfigure = (id: string) => {
    console.log('Configure module:', id);
  };

  const toggleCategory = (category: string) => {
    setSelectedCategories(prev => 
      prev.includes(category) 
        ? prev.filter(c => c !== category)
        : [...prev, category]
    );
  };

  const installedCount = modules.filter(m => m.isInstalled).length;

  return (
    <div className="p-6 lg:p-8 max-w-[1600px] mx-auto">
      <PageHeader 
        title="Modules" 
        description="Browse and manage your stream automation modules."
      />

      <Tabs value={activeTab} onValueChange={setActiveTab} className="mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <TabsList>
            <TabsTrigger value="all" data-testid="tab-all-modules">
              All Modules
              <Badge variant="secondary" className="ml-2">{modules.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="installed" data-testid="tab-installed-modules">
              Installed
              <Badge variant="secondary" className="ml-2">{installedCount}</Badge>
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
                <SelectItem value="updated">Recently Updated</SelectItem>
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

        {selectedCategories.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <span className="text-sm text-muted-foreground">Filters:</span>
            {selectedCategories.map((category) => (
              <Badge 
                key={category} 
                variant="secondary" 
                className="cursor-pointer"
                onClick={() => toggleCategory(category)}
              >
                {category}
                <span className="ml-1">×</span>
              </Badge>
            ))}
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={() => setSelectedCategories([])}
              className="text-xs"
            >
              Clear all
            </Button>
          </div>
        )}

        <TabsContent value="all" className="mt-0">
          {error ? (
            <ErrorState
              title="Failed to load modules"
              message="An error occurred while fetching the modules."
              onRetry={() => refetch()}
            />
          ) : isLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <ModuleCardSkeleton key={i} />
              ))}
            </div>
          ) : filteredModules.length === 0 ? (
            <EmptyState
              icon={Puzzle}
              title="No modules found"
              description="Try adjusting your search or filters to find what you're looking for."
              action={{
                label: 'Clear Filters',
                onClick: () => {
                  setSearchQuery('');
                  setSelectedCategories([]);
                },
              }}
            />
          ) : viewMode === 'grid' ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {filteredModules.map((module) => (
                <ModuleCard 
                  key={module.id} 
                  module={module} 
                  onInstall={handleInstall}
                  onUninstall={handleUninstall}
                  onConfigure={handleConfigure}
                  isInstalling={installingId === module.id}
                />
              ))}
            </div>
          ) : (
            <Card>
              {filteredModules.map((module) => (
                <ModuleListItem 
                  key={module.id} 
                  module={module} 
                  onInstall={handleInstall}
                  onUninstall={handleUninstall}
                  onConfigure={handleConfigure}
                  isInstalling={installingId === module.id}
                />
              ))}
            </Card>
          )}
        </TabsContent>

        <TabsContent value="installed" className="mt-0">
          {error ? (
            <ErrorState
              title="Failed to load modules"
              message="An error occurred while fetching the modules."
              onRetry={() => refetch()}
            />
          ) : isLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <ModuleCardSkeleton key={i} />
              ))}
            </div>
          ) : filteredModules.length === 0 ? (
            <EmptyState
              icon={Puzzle}
              title="No installed modules"
              description="Browse the module library to find and install modules for your stream."
              action={{
                label: 'Browse Modules',
                onClick: () => setActiveTab('all'),
              }}
            />
          ) : viewMode === 'grid' ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {filteredModules.map((module) => (
                <ModuleCard 
                  key={module.id} 
                  module={module} 
                  onInstall={handleInstall}
                  onUninstall={handleUninstall}
                  onConfigure={handleConfigure}
                  isInstalling={installingId === module.id}
                />
              ))}
            </div>
          ) : (
            <Card>
              {filteredModules.map((module) => (
                <ModuleListItem 
                  key={module.id} 
                  module={module} 
                  onInstall={handleInstall}
                  onUninstall={handleUninstall}
                  onConfigure={handleConfigure}
                  isInstalling={installingId === module.id}
                />
              ))}
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
