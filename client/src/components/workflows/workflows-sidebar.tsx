import { api } from "@convex/_generated/api";
import type { Doc, Id } from "@convex/_generated/dataModel";
import { useAction, useQuery } from "convex/react";
import { Loader2, Power, PowerOff, Search, Zap } from "lucide-react";
import { useState } from "react";
import { useInstance } from "@/hooks/use-instance";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";

type WorkflowRow = Doc<"workflows">;

function workflowName(row: WorkflowRow): string {
  const def = row.definition as { name?: string } | undefined;
  return def?.name ?? row.engineWorkflowId;
}

function workflowStepCount(row: WorkflowRow): number {
  if (Array.isArray(row.nodes)) {
    return row.nodes.length;
  }
  const def = row.definition as { tasks?: unknown[] } | undefined;
  return (def?.tasks?.length ?? 0) + 1;
}

export interface WorkflowListItem {
  _id: Id<"workflows">;
  engineWorkflowId: string;
  name: string;
  description?: string;
  isEnabled: boolean;
  stepCount: number;
}

interface WorkflowsSidebarProps {
  selectedWorkflowId: string | null;
  onSelectWorkflow: (workflow: WorkflowListItem | null) => void;
}

export function WorkflowsSidebar({ selectedWorkflowId, onSelectWorkflow }: WorkflowsSidebarProps) {
  const { instance } = useInstance();
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState<"all" | "enabled" | "disabled">("all");
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const workflows = useQuery(
    api.workflows.list,
    instance ? { instanceId: instance._id as Id<"instances"> } : "skip"
  );
  const setEnabled = useAction(api.workflowActions.setEnabled);

  const filteredWorkflows = (workflows || []).filter((w) => {
    const name = workflowName(w);
    const description = (w.definition as { description?: string } | undefined)?.description;

    if (activeTab === "enabled" && !w.isEnabled) {
      return false;
    }
    if (activeTab === "disabled" && w.isEnabled) {
      return false;
    }
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      if (!name.toLowerCase().includes(query) && !description?.toLowerCase().includes(query)) {
        return false;
      }
    }
    return true;
  });

  const allCount = (workflows || []).length;
  const enabledCount = (workflows || []).filter((w) => w.isEnabled).length;
  const disabledCount = allCount - enabledCount;

  const handleToggle = async (engineWorkflowId: string, enabled: boolean) => {
    if (!instance) {
      return;
    }
    setTogglingId(engineWorkflowId);
    try {
      await setEnabled({
        instanceId: instance._id as Id<"instances">,
        engineWorkflowId,
        isEnabled: enabled,
      });
    } catch (err) {
      toast({
        title: "Failed to toggle workflow",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setTogglingId(null);
    }
  };

  const toListItem = (w: WorkflowRow): WorkflowListItem => ({
    _id: w._id,
    engineWorkflowId: w.engineWorkflowId,
    name: workflowName(w),
    description: (w.definition as { description?: string } | undefined)?.description,
    isEnabled: w.isEnabled,
    stepCount: workflowStepCount(w),
  });

  return (
    <div className="w-72 shrink-0 border-r bg-background flex flex-col">
      <div className="flex border-b">
        <button
          onClick={() => setActiveTab("all")}
          className={cn(
            "flex-1 px-3 py-2.5 text-xs font-medium border-b-2 transition-colors",
            activeTab === "all" ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
          )}
        >
          All
          <Badge variant="secondary" className="ml-1.5 text-[10px] py-0 px-1.5">
            {allCount}
          </Badge>
        </button>
        <button
          onClick={() => setActiveTab("enabled")}
          className={cn(
            "flex-1 px-3 py-2.5 text-xs font-medium border-b-2 transition-colors",
            activeTab === "enabled" ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
          )}
        >
          On
          <Badge variant="secondary" className="ml-1.5 text-[10px] py-0 px-1.5">
            {enabledCount}
          </Badge>
        </button>
        <button
          onClick={() => setActiveTab("disabled")}
          className={cn(
            "flex-1 px-3 py-2.5 text-xs font-medium border-b-2 transition-colors",
            activeTab === "disabled" ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
          )}
        >
          Off
          <Badge variant="secondary" className="ml-1.5 text-[10px] py-0 px-1.5">
            {disabledCount}
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
          {workflows === undefined && (
            <div className="text-xs text-muted-foreground p-3 flex items-center gap-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Loading…
            </div>
          )}
          {filteredWorkflows.length === 0 && (
            <div className="text-xs text-muted-foreground p-3 text-center">
              {activeTab === "all" ? "No workflows yet" : `No ${activeTab} workflows`}
            </div>
          )}
          {filteredWorkflows.map((workflow) => {
            const isSelected = selectedWorkflowId === workflow.engineWorkflowId;
            const name = workflowName(workflow);
            const isToggling = togglingId === workflow.engineWorkflowId;

            return (
              <div
                key={workflow._id}
                role="button"
                tabIndex={0}
                aria-pressed={isSelected}
                aria-label={`Select workflow ${name}`}
                className={cn(
                  "group flex items-start gap-2 rounded-md px-2 py-2 cursor-pointer hover:bg-accent",
                  isSelected && "bg-accent"
                )}
                onClick={() => onSelectWorkflow(toListItem(workflow))}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelectWorkflow(toListItem(workflow));
                  }
                }}
              >
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleToggle(workflow.engineWorkflowId, !workflow.isEnabled);
                  }}
                  className={cn(
                    "h-8 w-8 rounded-lg flex items-center justify-center shrink-0 cursor-pointer transition-colors",
                    workflow.isEnabled
                      ? "bg-green-500/10 text-green-600 hover:bg-green-500/20"
                      : "bg-muted text-muted-foreground hover:bg-accent"
                  )}
                  title={workflow.isEnabled ? "Click to deactivate" : "Click to activate"}
                >
                  {isToggling ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : workflow.isEnabled ? (
                    <Power className="h-4 w-4" />
                  ) : (
                    <PowerOff className="h-4 w-4" />
                  )}
                </button>
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium truncate block">{name}</span>
                  <span className="text-[11px] text-muted-foreground truncate block">
                    {workflowStepCount(workflow)} steps
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