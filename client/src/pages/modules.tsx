import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useAction, useMutation, useQuery } from "convex/react";
import {
  Bell,
  Check,
  Download,
  Eye,
  Filter,
  Grid3X3,
  List,
  Loader2,
  MessageSquare,
  Music,
  Puzzle,
  Search,
  Settings2,
  Sparkles,
  Trash2,
  Upload,
  Video,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { PageHeader } from "@/components/layout/page-header";
import { UninstallModuleDialog } from "@/components/modules/uninstall-module-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Toggle } from "@/components/ui/toggle";
import { useInstance } from "@/hooks/use-instance";
import { cn } from "@/lib/utils";

type ModuleRepoItem = {
  _id: Id<"moduleRepository">;
  name: string;
  description: string;
  version: string;
  tags: string[];
  manifest: Record<string, unknown>;
  archiveKey: string;
  moduleKey?: string;
};

type ModuleView = {
  _id: Id<"moduleRepository"> | string;
  name: string;
  description: string;
  version: string;
  tags: string[];
  manifest: Record<string, unknown>;
  archiveKey: string;
  moduleKey?: string;
  isInstalled: boolean;
  isEnabled: boolean;
  engineState?: string;
  isOrphan?: boolean;
  status?: "pending" | "delivering" | "installed" | "failed";
  statusMessage?: string;
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

function getCategory(module: ModuleView): string {
  return (module.manifest?.category as string) || module.tags[0] || "Utilities";
}

function getAuthor(module: ModuleView): string {
  return (module.manifest?.author as string) || "Unknown";
}

interface ModuleCardProps {
  module: ModuleView;
  onInstall: (id: Id<"moduleRepository"> | string) => void;
  onDelete: (id: Id<"moduleRepository">) => void;
  onRetry: (id: Id<"moduleRepository">) => void;
  onView: (id: Id<"moduleRepository">) => void;
  onShowError: (message: string) => void;
  isInstalling?: boolean;
}

function ModuleCard({ module, onInstall, onDelete, onRetry, onView, onShowError, isInstalling }: ModuleCardProps) {
  const category = getCategory(module);
  const author = getAuthor(module);
  const CategoryIcon = categoryIcons[category] ? (
    <span className="text-primary">{categoryIcons[category]}</span>
  ) : (
    <Puzzle className="h-4 w-4 text-primary" />
  );

  return (
    <Card className="group flex flex-col hover-elevate overflow-visible" data-testid={`card-module-${module._id}`}>
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
              {module.status === "delivering" && (
                <Badge variant="secondary" className="shrink-0 text-xs">
                  <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                  Installing
                </Badge>
              )}
              {module.status === "failed" && (
                <Badge variant="destructive" className="shrink-0 text-xs">
                  Failed
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              v{module.version} · by {author}
            </p>
          </div>
        </div>
        <p className="text-sm text-muted-foreground line-clamp-2 mb-4">{module.description}</p>
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
        {module.status === "failed" ? (
          <div className="flex-1 flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm text-destructive">
              <span>Failed</span>
              <Button
                variant="ghost"
                size="sm"
                className="text-xs text-muted-foreground"
                onClick={() => onShowError(module.statusMessage || "Installation failed")}
              >
                Show details
              </Button>
            </div>
            <div className="flex items-center gap-1">
              <Button size="sm" variant="outline" onClick={() => onRetry(module._id as Id<"moduleRepository">)}>
                Retry
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="text-muted-foreground hover:text-destructive"
                onClick={() => onDelete(module._id as Id<"moduleRepository">)}
                data-testid={`button-delete-${module._id}`}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ) : module.isInstalled && !module.isOrphan ? (
          <>
            <Button
              variant="outline"
              size="sm"
              className="flex-1"
              onClick={() => onView(module._id as Id<"moduleRepository">)}
              data-testid={`button-view-${module._id}`}
            >
              <Eye className="h-4 w-4 mr-2" />
              View Details
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="text-muted-foreground hover:text-destructive"
              onClick={() => onDelete(module._id as Id<"moduleRepository">)}
              data-testid={`button-delete-${module._id}`}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </>
        ) : module.isInstalled ? (
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            onClick={() => onView(module._id as Id<"moduleRepository">)}
            data-testid={`button-view-${module._id}`}
          >
            <Eye className="h-4 w-4 mr-2" />
            View Details
          </Button>
        ) : !module.isOrphan ? (
          <>
            <Button
              size="sm"
              className="flex-1"
              onClick={() => onInstall(module._id)}
              disabled={isInstalling}
              data-testid={`button-install-${module._id}`}
            >
              {isInstalling ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
              {isInstalling ? "Installing..." : "Install"}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="text-muted-foreground hover:text-destructive"
              onClick={() => onDelete(module._id as Id<"moduleRepository">)}
              data-testid={`button-delete-${module._id}`}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </>
        ) : null}
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
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [sortBy, setSortBy] = useState("name");
  const [installingId, setInstallingId] = useState<Id<"moduleRepository"> | null>(null);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  interface EngineModule {
    name: string;
    version: string;
    state: string;
  }

  const [engineModules, setEngineModules] = useState<EngineModule[]>([]);
  const [engineError, setEngineError] = useState<string | null>(null);

  const repoModules = useQuery(api.moduleRepository.list, {}) as ModuleRepoItem[] | undefined;
  const enqueueEngineInstall = useMutation(api.moduleRepository.enqueueEngineInstall);
  const engineListModules = useAction(api.moduleEngine.listEngineModules);
  const [uninstallTarget, setUninstallTarget] = useState<{
    _id: Id<"moduleRepository">;
    name: string;
    version: string;
    moduleKey?: string;
  } | null>(null);

  const isLoading = instanceLoading || repoModules === undefined;

  const refreshEngineModules = useCallback(
    async (retries = 2) => {
      if (!instance) {
        setEngineModules([]);
        setEngineError(null);
        return;
      }
      try {
        const modules = await engineListModules({ instanceId: instance._id });
        setEngineModules(modules ?? []);
        setEngineError(null);
      } catch (err) {
        if (retries > 0) {
          await new Promise((r) => setTimeout(r, 1500));
          return refreshEngineModules(retries - 1);
        }
        console.error("Failed to fetch engine modules:", err);
        setEngineError("Could not reach engine module list.");
        setEngineModules([]);
      }
    },
    [instance, engineListModules]
  );

  useEffect(() => {
    void refreshEngineModules();
  }, [refreshEngineModules]);

  // Merge repo modules with installed status
  const allModules = useMemo((): ModuleView[] => {
    if (!repoModules) {
      return [];
    }
    const installedMap = new Map<string, EngineModule>();
    engineModules.forEach((m) => installedMap.set(`${m.name}:${m.version}`, m));

    const repoViews: ModuleView[] = repoModules.map((m) => {
      const key = `${m.name}:${m.version}`;
      const installed = installedMap.get(key);
      if (installed) {
        installedMap.delete(key);
      }
      return {
        ...m,
        moduleKey: m.moduleKey,
        isInstalled: !!installed,
        isEnabled: (installed?.state ?? "disabled") === "active",
        engineState: installed?.state,
        status: (m as Record<string, unknown>).status as ModuleView["status"],
        statusMessage: (m as Record<string, unknown>).statusMessage as string | undefined,
      };
    });

    const orphans: ModuleView[] = Array.from(installedMap.values()).map((em) => ({
      _id: `engine:${em.name}:${em.version}`,
      name: em.name,
      description: "Installed on engine (not in module catalog)",
      version: em.version,
      tags: [],
      manifest: {},
      archiveKey: "",
      isInstalled: true,
      isEnabled: em.state === "active",
      engineState: em.state,
      isOrphan: true,
    }));

    return [...repoViews, ...orphans];
  }, [repoModules, engineModules]);

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
      if (sortBy === "name") {
        return a.name.localeCompare(b.name);
      }
      if (sortBy === "category") {
        return getCategory(a).localeCompare(getCategory(b));
      }
      return 0;
    });

    return result;
  };

  const handleInstall = async (moduleId: Id<"moduleRepository"> | string) => {
    if (!instance || typeof moduleId === "string") {
      return;
    }
    setInstallingId(moduleId);
    try {
      await enqueueEngineInstall({ instanceId: instance._id, moduleId });
      await refreshEngineModules();
    } catch (err) {
      console.error("Install failed:", err);
    } finally {
      setInstallingId(null);
    }
  };

  const handleDelete = (moduleId: Id<"moduleRepository">) => {
    const target = allModules.find((m) => m._id === moduleId);
    if (!target) {
      return;
    }
    setUninstallTarget({
      _id: moduleId,
      name: target.name,
      version: target.version,
      moduleKey: target.moduleKey,
    });
  };

  const handleView = (moduleId: Id<"moduleRepository">) => {
    navigate(`/modules/${moduleId}`);
  };

  const handleRetry = async (moduleId: Id<"moduleRepository">) => {
    if (!instance) {
      return;
    }
    setInstallingId(moduleId);
    try {
      await enqueueEngineInstall({ instanceId: instance._id, moduleId });
      await refreshEngineModules();
    } catch (err) {
      console.error("Retry failed:", err);
    } finally {
      setInstallingId(null);
    }
  };

  const toggleCategory = (category: string) => {
    setSelectedCategories((prev) =>
      prev.includes(category) ? prev.filter((c) => c !== category) : [...prev, category]
    );
  };

  const renderModuleGrid = (modules: ModuleView[]) => {
    const filtered = filterModules(modules);
    if (filtered.length === 0) {
      return null;
    }
    return viewMode === "grid" ? (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {filtered.map((module) => (
          <ModuleCard
            key={module._id}
            module={module}
            onInstall={handleInstall}
            onDelete={handleDelete}
            onRetry={handleRetry}
            onView={handleView}
            onShowError={setErrorDetail}
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
                    <Badge variant="secondary" className="text-xs">
                      Installed
                    </Badge>
                  )}
                </div>
                <p className="text-sm text-muted-foreground truncate">{module.description}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Badge variant="outline" className="text-xs hidden sm:flex">
                  {category}
                </Badge>
                <span className="text-xs text-muted-foreground hidden md:block">v{module.version}</span>
                {module.status === "failed" ? (
                  <>
                    <span className="text-sm text-destructive">Failed</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-xs text-muted-foreground"
                      onClick={() => setErrorDetail(module.statusMessage || "Installation failed")}
                    >
                      Show details
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleRetry(module._id as Id<"moduleRepository">)}
                    >
                      Retry
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() => handleDelete(module._id as Id<"moduleRepository">)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </>
                ) : module.isInstalled && !module.isOrphan ? (
                  <>
                    <Button variant="outline" size="sm" onClick={() => navigate(`/modules/${module._id}`)}>
                      <Eye className="h-4 w-4 mr-2" />
                      View
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() => handleDelete(module._id as Id<"moduleRepository">)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </>
                ) : module.isInstalled ? (
                  <Button variant="outline" size="sm" onClick={() => navigate(`/modules/${module._id}`)}>
                    <Eye className="h-4 w-4 mr-2" />
                    View
                  </Button>
                ) : !module.isOrphan ? (
                  <>
                    <Button size="sm" onClick={() => handleInstall(module._id)} disabled={installingId === module._id}>
                      {installingId === module._id ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <Download className="h-4 w-4 mr-2" />
                      )}
                      Install
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() => handleDelete(module._id as Id<"moduleRepository">)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </>
                ) : null}
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
          <Button onClick={() => navigate("/modules/install")} variant="outline">
            <Upload className="h-4 w-4 mr-2" />
            Install Module
          </Button>
        }
      />

      <div className="flex flex-col sm:flex-row sm:items-center justify-end gap-4 mb-6">
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
              pressed={viewMode === "grid"}
              onPressedChange={() => setViewMode("grid")}
              size="sm"
              className="rounded-r-none"
              data-testid="button-view-grid"
            >
              <Grid3X3 className="h-4 w-4" />
            </Toggle>
            <Toggle
              pressed={viewMode === "list"}
              onPressedChange={() => setViewMode("list")}
              size="sm"
              className="rounded-l-none"
              data-testid="button-view-list"
            >
              <List className="h-4 w-4" />
            </Toggle>
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <ModuleCardSkeleton key={i} />
          ))}
        </div>
      ) : engineError ? (
        <ErrorState
          title="Engine connection issue"
          message={engineError}
          onRetry={() => {
            void refreshEngineModules();
          }}
        />
      ) : filterModules(allModules).length === 0 ? (
        <EmptyState
          icon={Puzzle}
          title="No modules found"
          description="Try adjusting your search or filters, or install a module from a zip file."
          action={{
            label: "Clear Filters",
            onClick: () => {
              setSearchQuery("");
              setSelectedCategories([]);
            },
          }}
        />
      ) : (
        renderModuleGrid(allModules)
      )}

      <Dialog
        open={errorDetail !== null}
        onOpenChange={(open) => {
          if (!open) {
            setErrorDetail(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Install Failed</DialogTitle>
          </DialogHeader>
          <pre className="mt-2 whitespace-pre-wrap break-words rounded-md bg-muted p-4 text-sm">{errorDetail}</pre>
        </DialogContent>
      </Dialog>

      {instance && (
        <UninstallModuleDialog
          open={uninstallTarget !== null}
          onOpenChange={(open) => {
            if (!open) {
              setUninstallTarget(null);
            }
          }}
          instanceId={instance._id}
          module={uninstallTarget}
          onSuccess={() => {
            setUninstallTarget(null);
            void refreshEngineModules();
          }}
        />
      )}
    </div>
  );
}
