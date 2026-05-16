import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useQuery } from "convex/react";
import {
  Bell,
  Check,
  Loader2,
  MessageSquare,
  Music,
  Puzzle,
  Search,
  Video,
  Zap,
} from "lucide-react";
import { useState } from "react";
import { useInstance } from "@/hooks/use-instance";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";

type ModuleRepoItem = {
  _id: Id<"moduleRepository">;
  name: string;
  description: string;
  version: string;
  tags: string[];
  author: string;
  category: string;
  moduleKey?: string;
  status?: "pending" | "delivering" | "installed" | "failed";
  statusMessage?: string;
  installedAt?: number;
};

type ModuleView = {
  _id: Id<"moduleRepository">;
  name: string;
  description: string;
  version: string;
  tags: string[];
  author: string;
  category: string;
  moduleKey?: string;
  isInstalled: boolean;
  status?: "pending" | "delivering" | "installed" | "failed";
};

const categoryIcons: Record<string, React.ReactNode> = {
  Chat: <MessageSquare className="h-3.5 w-3.5" />,
  Alerts: <Bell className="h-3.5 w-3.5" />,
  Media: <Video className="h-3.5 w-3.5" />,
  Audio: <Music className="h-3.5 w-3.5" />,
  Automation: <Zap className="h-3.5 w-3.5" />,
  Integrations: <Puzzle className="h-3.5 w-3.5" />,
  Effects: <Puzzle className="h-3.5 w-3.5" />,
  Utilities: <Puzzle className="h-3.5 w-3.5" />,
};

function getCategoryIcon(category: string) {
  return categoryIcons[category] || <Puzzle className="h-3.5 w-3.5" />;
}

export interface ModuleListItem {
  _id: Id<"moduleRepository">;
  name: string;
  description: string;
  version: string;
  tags: string[];
  author: string;
  category: string;
  moduleKey?: string;
  isInstalled: boolean;
  status?: "pending" | "delivering" | "installed" | "failed";
}

interface ModulesSidebarProps {
  selectedModuleId: Id<"moduleRepository"> | null;
  onSelectModule: (module: ModuleListItem | null) => void;
}

export function ModulesSidebar({ selectedModuleId, onSelectModule }: ModulesSidebarProps) {
  const { instance } = useInstance();
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState<"installed" | "browse">("installed");

  const repoModules = useQuery(
    api.moduleRepository.list,
    instance ? { instanceId: instance._id } : "skip",
  ) as ModuleRepoItem[] | undefined;

  const allModules: ModuleView[] = (repoModules || []).map((m) => ({
    ...m,
    moduleKey: m.moduleKey,
    isInstalled: m.status === "installed",
    status: m.status,
    statusMessage: m.statusMessage,
  }));

  const filteredModules = allModules.filter((m) => {
    if (activeTab === "installed" && !m.isInstalled) {
      return false;
    }
    if (activeTab === "browse" && m.isInstalled) {
      return false;
    }
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      return (
        m.name.toLowerCase().includes(query) ||
        m.description.toLowerCase().includes(query) ||
        m.category.toLowerCase().includes(query)
      );
    }
    return true;
  });

  const installedCount = allModules.filter((m) => m.isInstalled).length;
  const browseCount = allModules.filter((m) => !m.isInstalled).length;

  return (
    <div className="w-72 shrink-0 border-r bg-background flex flex-col">
      <div className="flex border-b">
        <button
          onClick={() => setActiveTab("installed")}
          className={cn(
            "flex-1 px-3 py-2.5 text-xs font-medium border-b-2 transition-colors",
            activeTab === "installed"
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          )}
        >
          Installed
          <Badge variant="secondary" className="ml-1.5 text-[10px] py-0 px-1.5">
            {installedCount}
          </Badge>
        </button>
        <button
          onClick={() => setActiveTab("browse")}
          className={cn(
            "flex-1 px-3 py-2.5 text-xs font-medium border-b-2 transition-colors",
            activeTab === "browse"
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          )}
        >
          Browse
          <Badge variant="secondary" className="ml-1.5 text-[10px] py-0 px-1.5">
            {browseCount}
          </Badge>
        </button>
      </div>

      <div className="p-2 border-b">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-8 text-xs pl-7"
          />
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1">
          {repoModules === undefined && (
            <div className="text-xs text-muted-foreground p-3 flex items-center gap-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Loading…
            </div>
          )}
          {filteredModules.length === 0 && (
            <div className="text-xs text-muted-foreground p-3 text-center">
              {activeTab === "installed"
                ? "No installed modules"
                : "No modules found"}
            </div>
          )}
          {filteredModules.map((module) => {
            const isSelected = selectedModuleId === module._id;
            return (
              <div
                key={module._id}
                role="button"
                tabIndex={0}
                aria-pressed={isSelected}
                aria-label={`Select module ${module.name}`}
                className={cn(
                  "group flex items-start gap-2 rounded-md px-2 py-2 cursor-pointer hover:bg-accent",
                  isSelected && "bg-accent"
                )}
                onClick={() => onSelectModule(module)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelectModule(module);
                  }
                }}
              >
                <div className="h-8 w-8 rounded-md bg-primary/10 flex items-center justify-center shrink-0 text-primary">
                  {getCategoryIcon(module.category)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-medium truncate">{module.name}</span>
                    {module.isInstalled && (
                      <Check className="h-3 w-3 text-green-500 shrink-0" />
                    )}
                    {module.status === "delivering" && (
                      <Loader2 className="h-3 w-3 animate-spin text-muted-foreground shrink-0" />
                    )}
                  </div>
                  <span className="text-[11px] text-muted-foreground truncate block">
                    v{module.version} · {module.category}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}