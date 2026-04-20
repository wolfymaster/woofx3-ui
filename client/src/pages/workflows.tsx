import { api } from "@convex/_generated/api";
import type { Doc, Id } from "@convex/_generated/dataModel";
import { useAction, useQuery as useConvexQuery } from "convex/react";
import {
  BookTemplate,
  CheckCircle2,
  Edit3,
  Loader2,
  MoreHorizontal,
  Plus,
  Search,
  Trash2,
  Workflow as WorkflowIcon,
  Zap,
} from "lucide-react";
import { useState } from "react";
import { useLocation } from "wouter";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useInstance } from "@/hooks/use-instance";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

type WorkflowRow = Doc<"workflows">;

function workflowName(row: WorkflowRow): string {
  const def = row.definition as { name?: string } | undefined;
  return def?.name ?? row.engineWorkflowId;
}

function workflowDescription(row: WorkflowRow): string | undefined {
  const def = row.definition as { description?: string } | undefined;
  return def?.description;
}

function workflowStepCount(row: WorkflowRow): number {
  if (Array.isArray(row.nodes)) {
    return row.nodes.length;
  }
  const def = row.definition as { tasks?: unknown[] } | undefined;
  // +1 for the implicit trigger node the projection adds.
  return (def?.tasks?.length ?? 0) + 1;
}

interface WorkflowCardProps {
  workflow: WorkflowRow;
  onToggle: (engineWorkflowId: string, enabled: boolean) => void;
  onEdit: (engineWorkflowId: string) => void;
  onDelete: (engineWorkflowId: string) => void;
  isToggling?: boolean;
}

function WorkflowCard({ workflow, onToggle, onEdit, onDelete, isToggling }: WorkflowCardProps) {
  const [, navigate] = useLocation();
  const name = workflowName(workflow);
  const description = workflowDescription(workflow);

  return (
    <Card
      className="group hover-elevate cursor-pointer overflow-visible"
      onClick={() => navigate(`/workflows/${workflow.engineWorkflowId}`)}
      data-testid={`card-workflow-${workflow.engineWorkflowId}`}
    >
      <CardContent className="pt-6">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <div
              className={cn(
                "h-10 w-10 rounded-lg flex items-center justify-center shrink-0",
                workflow.isEnabled ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
              )}
            >
              <WorkflowIcon className="h-5 w-5" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <h3 className="font-semibold truncate" data-testid={`text-workflow-name-${workflow.engineWorkflowId}`}>
                  {name}
                </h3>
              </div>
              <p className="text-sm text-muted-foreground line-clamp-2">{description ?? ""}</p>
            </div>
          </div>
          <div
            className="flex items-center gap-2"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            {isToggling ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Switch
                checked={workflow.isEnabled}
                onCheckedChange={(checked) => onToggle(workflow.engineWorkflowId, checked)}
                data-testid={`switch-workflow-${workflow.engineWorkflowId}`}
              />
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" data-testid={`button-workflow-menu-${workflow.engineWorkflowId}`}>
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => onEdit(workflow.engineWorkflowId)}>
                  <Edit3 className="h-4 w-4 mr-2" />
                  Edit
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => onDelete(workflow.engineWorkflowId)}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <div className="flex items-center gap-4 pt-4 border-t border-border/50">
          <div className="flex items-center gap-1.5 text-sm">
            <Zap className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium">{workflowStepCount(workflow)}</span>
            <span className="text-muted-foreground">steps</span>
          </div>
          <div className="flex items-center gap-1.5 text-sm">
            <CheckCircle2 className="h-4 w-4 text-green-500" />
            <span className="font-medium text-muted-foreground">{workflow.isEnabled ? "Active" : "Inactive"}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function WorkflowCardSkeleton() {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-start gap-3 mb-4">
          <Skeleton className="h-10 w-10 rounded-lg" />
          <div className="flex-1">
            <Skeleton className="h-5 w-40 mb-2" />
            <Skeleton className="h-4 w-full" />
          </div>
          <Skeleton className="h-6 w-10" />
        </div>
        <div className="flex items-center gap-4 pt-4 border-t border-border/50">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-24" />
        </div>
      </CardContent>
    </Card>
  );
}

type WorkflowTemplate = {
  _id: string;
  name: string;
  description: string;
  trigger: string;
  workflowJson: Record<string, unknown>;
};

function TemplatePickerDialog({
  open,
  onOpenChange,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (template: WorkflowTemplate) => void;
}) {
  const templates = useConvexQuery(api.workflowTemplates.list, {}) as WorkflowTemplate[] | undefined;

  const triggerEmoji: Record<string, string> = {
    follow: "👤",
    subscribe: "⭐",
    bits: "💎",
    raid: "🚨",
    gift: "🎁",
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>From Template</DialogTitle>
          <DialogDescription>Choose a Twitch event template to pre-populate your workflow.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2 mt-2">
          {templates === undefined ? (
            Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)
          ) : templates.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">No templates available.</p>
          ) : (
            templates.map((t) => (
              <button
                key={t._id}
                type="button"
                className="w-full text-left p-3 rounded-lg border border-border hover:bg-muted/50 transition-colors"
                onClick={() => {
                  onSelect(t);
                  onOpenChange(false);
                }}
              >
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{triggerEmoji[t.trigger] ?? "⚡"}</span>
                  <div>
                    <p className="font-medium text-sm">{t.name}</p>
                    <p className="text-xs text-muted-foreground">{t.description}</p>
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function Workflows() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { instance } = useInstance();
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "enabled" | "disabled">("all");
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingEngineId, setDeletingEngineId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);

  const workflowDocs = useConvexQuery(
    api.workflows.list,
    instance ? { instanceId: instance._id as Id<"instances"> } : "skip"
  );
  const isLoading = workflowDocs === undefined;
  const workflows = workflowDocs ?? [];

  const setEnabled = useAction(api.workflowActions.setEnabled);
  const deleteByEngineId = useAction(api.workflowActions.deleteByEngineId);

  const filteredWorkflows = workflows.filter((w) => {
    const name = workflowName(w);
    const description = workflowDescription(w);
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      if (!name.toLowerCase().includes(query) && !description?.toLowerCase().includes(query)) {
        return false;
      }
    }
    if (statusFilter === "enabled" && !w.isEnabled) {
      return false;
    }
    if (statusFilter === "disabled" && w.isEnabled) {
      return false;
    }
    return true;
  });

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

  const handleEdit = (engineWorkflowId: string) => navigate(`/workflows/${engineWorkflowId}`);

  const handleDelete = (engineWorkflowId: string) => {
    setDeletingEngineId(engineWorkflowId);
    setDeleteDialogOpen(true);
  };

  const confirmDelete = async () => {
    if (!deletingEngineId || !instance) {
      return;
    }
    setIsDeleting(true);
    try {
      await deleteByEngineId({
        instanceId: instance._id as Id<"instances">,
        engineWorkflowId: deletingEngineId,
      });
      setDeleteDialogOpen(false);
      setDeletingEngineId(null);
    } catch (err) {
      toast({
        title: "Failed to delete workflow",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setIsDeleting(false);
    }
  };

  const handleTemplateSelect = (_template: WorkflowTemplate) => {
    toast({
      title: "Templates not yet wired",
      description: "Template-based creation will be re-enabled once the engine accepts canonical JSON templates.",
    });
  };

  return (
    <div className="p-6 lg:p-8 max-w-[1600px] mx-auto">
      <PageHeader
        title="Workflows"
        description="Automate your stream with trigger-action workflows."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => setTemplateDialogOpen(true)}>
              <BookTemplate className="h-4 w-4 mr-2" />
              From Template
            </Button>
            <Button onClick={() => navigate("/workflows/new")} data-testid="button-new-workflow">
              <Plus className="h-4 w-4 mr-2" />
              New Workflow
            </Button>
          </div>
        }
      />

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search workflows..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
            data-testid="input-search-workflows"
          />
        </div>
        <div className="flex items-center gap-2">
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}>
            <SelectTrigger className="w-32" data-testid="select-filter-workflows">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="enabled">Enabled</SelectItem>
              <SelectItem value="disabled">Disabled</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <WorkflowCardSkeleton key={i} />
          ))}
        </div>
      ) : filteredWorkflows.length === 0 ? (
        <EmptyState
          icon={WorkflowIcon}
          title="No workflows found"
          description={
            workflows.length === 0
              ? "Create your first workflow to start automating your stream."
              : "Try adjusting your search or filters."
          }
          action={{
            label: workflows.length === 0 ? "Create Workflow" : "Clear Filters",
            onClick: () => {
              if (workflows.length === 0) {
                navigate("/workflows/new");
              } else {
                setSearchQuery("");
                setStatusFilter("all");
              }
            },
          }}
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {filteredWorkflows.map((workflow) => (
            <WorkflowCard
              key={workflow._id}
              workflow={workflow}
              onToggle={handleToggle}
              onEdit={handleEdit}
              onDelete={handleDelete}
              isToggling={togglingId === workflow.engineWorkflowId}
            />
          ))}
        </div>
      )}

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Workflow</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this workflow? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void confirmDelete();
              }}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <TemplatePickerDialog
        open={templateDialogOpen}
        onOpenChange={setTemplateDialogOpen}
        onSelect={handleTemplateSelect}
      />
    </div>
  );
}
