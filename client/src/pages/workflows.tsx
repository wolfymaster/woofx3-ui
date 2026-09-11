import { api } from "@convex/_generated/api";
import type { Doc, Id } from "@convex/_generated/dataModel";
import type { WorkflowDefinition } from "@woofx3/api";
import { useAction, useQuery } from "convex/react";
import {
  ArrowLeft,
  Code,
  Loader2,
  MoreVertical,
  Pencil,
  Plus,
  Save,
  Search,
  ToggleLeft,
  ToggleRight,
  Trash2,
  Workflow as WorkflowIcon,
  Zap,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { useLocation, useParams } from "wouter";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BasicWorkflowEditor } from "@/components/workflows/basic-editor";
import StepListEditor from "@/components/workflows/step-list-editor";
import { useInstance } from "@/hooks/use-instance";
import { useToast } from "@/hooks/use-toast";
import { useWorkflowCatalog } from "@/hooks/use-workflow-catalog";
import { escapeDollarKeys, unescapeDollarKeys } from "@/lib/dollar-keys";
import { cn } from "@/lib/utils";
import {
  UNTRIGGERED_LABEL,
  workflowDescription,
  workflowName,
  workflowStepCount,
  workflowTriggerLabel,
} from "@/lib/workflow-display";

type WorkflowRow = Doc<"workflows">;
type EnabledFilter = "all" | "enabled" | "disabled";

const LIST_PATH = "/stream/workflows";
const CREATE_PATH = "/stream/workflows/new";

export default function Workflows() {
  const params = useParams<{ id?: string }>();
  const [location] = useLocation();

  if (location === CREATE_PATH) {
    return <CreateWorkflowScreen />;
  }
  if (params?.id) {
    // Keyed so switching workflows resets the editor's draft state instead of carrying it over.
    return <WorkflowEditorScreen key={params.id} engineWorkflowId={params.id} />;
  }
  return <WorkflowListScreen />;
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

function WorkflowTableSkeleton() {
  return (
    <Card>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Workflow</TableHead>
            <TableHead>Trigger</TableHead>
            <TableHead>Steps</TableHead>
            <TableHead>Enabled</TableHead>
            <TableHead className="w-[100px]">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: 5 }).map((_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder rows
            <TableRow key={i}>
              <TableCell>
                <Skeleton className="h-4 w-40" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-5 w-28" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-4 w-10" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-5 w-10" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-4 w-16" />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

function WorkflowListScreen() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { instance, isLoading: instanceLoading } = useInstance();
  const { catalogTriggers } = useWorkflowCatalog();

  const workflows = useQuery(api.workflows.list, instance ? { instanceId: instance._id as Id<"instances"> } : "skip");
  const setEnabled = useAction(api.workflowActions.setEnabled);
  const deleteByEngineId = useAction(api.workflowActions.deleteByEngineId);

  const [searchQuery, setSearchQuery] = useState("");
  const [enabledFilter, setEnabledFilter] = useState<EnabledFilter>("all");
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<WorkflowRow | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const isLoading = instanceLoading || workflows === undefined;
  const allWorkflows = useMemo(() => workflows ?? [], [workflows]);

  const visibleWorkflows = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return allWorkflows
      .filter((w) => {
        if (enabledFilter === "enabled" && !w.isEnabled) {
          return false;
        }
        if (enabledFilter === "disabled" && w.isEnabled) {
          return false;
        }
        if (!query) {
          return true;
        }
        return (
          workflowName(w).toLowerCase().includes(query) ||
          (workflowDescription(w)?.toLowerCase().includes(query) ?? false)
        );
      })
      .sort((a, b) => workflowName(a).localeCompare(workflowName(b)));
  }, [allWorkflows, enabledFilter, searchQuery]);

  const enabledCount = allWorkflows.filter((w) => w.isEnabled).length;

  async function handleToggleEnabled(workflow: WorkflowRow) {
    if (!instance) {
      return;
    }
    setTogglingId(workflow.engineWorkflowId);
    try {
      await setEnabled({
        instanceId: instance._id as Id<"instances">,
        engineWorkflowId: workflow.engineWorkflowId,
        isEnabled: !workflow.isEnabled,
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
  }

  async function handleDelete() {
    if (!instance || !deleteTarget) {
      return;
    }
    setIsDeleting(true);
    try {
      await deleteByEngineId({
        instanceId: instance._id as Id<"instances">,
        engineWorkflowId: deleteTarget.engineWorkflowId,
      });
      toast({ title: "Workflow deleted" });
      setDeleteTarget(null);
    } catch (err) {
      toast({
        title: "Failed to delete workflow",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <div className="p-6 lg:p-8 max-w-[1600px] mx-auto">
      <PageHeader title="Workflows" description="Automations that run when something happens on your stream." />

      <div className="space-y-6">
        <Tabs value={enabledFilter} onValueChange={(v) => setEnabledFilter(v as EnabledFilter)}>
          <TabsList>
            <TabsTrigger value="all" data-testid="tab-workflows-all">
              All ({allWorkflows.length})
            </TabsTrigger>
            <TabsTrigger value="enabled" data-testid="tab-workflows-enabled">
              Enabled ({enabledCount})
            </TabsTrigger>
            <TabsTrigger value="disabled" data-testid="tab-workflows-disabled">
              Disabled ({allWorkflows.length - enabledCount})
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
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
          <Button onClick={() => navigate(CREATE_PATH)} disabled={!instance} data-testid="button-create-workflow">
            <Plus className="h-4 w-4 mr-2" />
            Create Workflow
          </Button>
        </div>

        {isLoading ? (
          <WorkflowTableSkeleton />
        ) : visibleWorkflows.length === 0 ? (
          <EmptyState
            icon={WorkflowIcon}
            title={allWorkflows.length === 0 ? "No workflows yet" : "No workflows found"}
            description={
              allWorkflows.length === 0
                ? "Create your first workflow to start automating your stream."
                : "Try adjusting your search or filter."
            }
            action={
              allWorkflows.length === 0 ? { label: "Create Workflow", onClick: () => navigate(CREATE_PATH) } : undefined
            }
          />
        ) : (
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Workflow</TableHead>
                  <TableHead>Trigger</TableHead>
                  <TableHead>Steps</TableHead>
                  <TableHead>Enabled</TableHead>
                  <TableHead className="w-[100px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleWorkflows.map((workflow) => {
                  const description = workflowDescription(workflow);
                  const triggerLabel = workflowTriggerLabel(workflow, catalogTriggers);

                  return (
                    <TableRow
                      key={workflow._id}
                      className="cursor-pointer"
                      onClick={() => navigate(`${LIST_PATH}/${workflow.engineWorkflowId}`)}
                      data-testid={`row-workflow-${workflow.engineWorkflowId}`}
                    >
                      <TableCell className="font-medium max-w-[420px]">
                        <span className="block truncate">{workflowName(workflow)}</span>
                        {description && (
                          <span className="block truncate text-xs font-normal text-muted-foreground">
                            {description}
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={triggerLabel === UNTRIGGERED_LABEL ? "outline" : "secondary"} className="gap-1">
                          <Zap className="h-3 w-3" />
                          {triggerLabel}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{workflowStepCount(workflow)}</TableCell>
                      <TableCell>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleToggleEnabled(workflow);
                          }}
                          className="text-muted-foreground hover:text-foreground transition-colors"
                          title={workflow.isEnabled ? "Click to disable" : "Click to enable"}
                        >
                          {togglingId === workflow.engineWorkflowId ? (
                            <Loader2 className="h-5 w-5 animate-spin" />
                          ) : workflow.isEnabled ? (
                            <ToggleRight className="h-5 w-5 text-primary" />
                          ) : (
                            <ToggleLeft className="h-5 w-5" />
                          )}
                        </button>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={(e) => {
                              e.stopPropagation();
                              navigate(`${LIST_PATH}/${workflow.engineWorkflowId}`);
                            }}
                            title="Edit workflow"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive hover:text-destructive"
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeleteTarget(workflow);
                            }}
                            title="Delete workflow"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Card>
        )}
      </div>

      <DeleteWorkflowDialog
        name={deleteTarget ? workflowName(deleteTarget) : ""}
        open={deleteTarget !== null}
        isDeleting={isDeleting}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null);
          }
        }}
        onConfirm={handleDelete}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

function CreateWorkflowScreen() {
  const [, navigate] = useLocation();

  return (
    <div className="p-6 lg:p-8 max-w-[1600px] mx-auto">
      <Button variant="ghost" size="sm" className="mb-4 -ml-2" onClick={() => navigate(LIST_PATH)}>
        <ArrowLeft className="h-4 w-4 mr-2" />
        Back to workflows
      </Button>

      <PageHeader title="Create a new workflow" description="Choose what triggers your workflow" />

      <BasicWorkflowEditor />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------

function WorkflowEditorScreen({ engineWorkflowId }: { engineWorkflowId: string }) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { instance } = useInstance();

  const workflows = useQuery(api.workflows.list, instance ? { instanceId: instance._id as Id<"instances"> } : "skip");
  const updateFromDefinition = useAction(api.workflowActions.updateFromDefinition);
  const deleteByEngineId = useAction(api.workflowActions.deleteByEngineId);

  const [currentDefinition, setCurrentDefinition] = useState<WorkflowDefinition | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [showJson, setShowJson] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editedTitle, setEditedTitle] = useState("");
  const titleInputRef = useRef<HTMLInputElement>(null);

  const workflow = workflows?.find((w) => w.engineWorkflowId === engineWorkflowId);
  const name = workflow ? workflowName(workflow) : "";

  if (workflows === undefined) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!workflow) {
    return (
      <div className="p-6 lg:p-8 max-w-[1600px] mx-auto">
        <EmptyState
          icon={WorkflowIcon}
          title="Workflow not found"
          description="It may have been deleted, or it belongs to another instance."
          action={{ label: "Back to workflows", onClick: () => navigate(LIST_PATH) }}
        />
      </div>
    );
  }

  const startEditingTitle = () => {
    setEditedTitle(name);
    setIsEditingTitle(true);
    setTimeout(() => {
      titleInputRef.current?.focus();
      titleInputRef.current?.select();
    }, 0);
  };

  const saveTitle = async () => {
    if (!instance) {
      return;
    }
    const trimmed = editedTitle.trim();
    if (!trimmed || trimmed === name) {
      setIsEditingTitle(false);
      return;
    }
    try {
      const def = unescapeDollarKeys(workflow.definition) as WorkflowDefinition;
      await updateFromDefinition({
        instanceId: instance._id as Id<"instances">,
        engineWorkflowId,
        definition: escapeDollarKeys({ ...def, name: trimmed }) as WorkflowDefinition,
      });
      toast({ title: "Workflow name updated" });
    } catch (err) {
      toast({
        title: "Failed to update name",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setIsEditingTitle(false);
    }
  };

  const handleTitleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void saveTitle();
    } else if (e.key === "Escape") {
      setIsEditingTitle(false);
    }
  };

  const handleSave = async () => {
    if (!instance || !currentDefinition) {
      return;
    }
    setIsSaving(true);
    try {
      await updateFromDefinition({
        instanceId: instance._id as Id<"instances">,
        engineWorkflowId,
        definition: escapeDollarKeys(currentDefinition) as WorkflowDefinition,
      });
      toast({ title: "Workflow saved" });
    } catch (err) {
      toast({
        title: "Save failed",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!instance) {
      return;
    }
    setIsDeleting(true);
    try {
      await deleteByEngineId({ instanceId: instance._id as Id<"instances">, engineWorkflowId });
      setDeleteDialogOpen(false);
      navigate(LIST_PATH);
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

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="h-14 border-b border-border bg-background flex items-center justify-between px-4 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <Button variant="ghost" size="icon" onClick={() => navigate(LIST_PATH)} title="Back to workflows">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          {isEditingTitle ? (
            <input
              ref={titleInputRef}
              type="text"
              value={editedTitle}
              onChange={(e) => setEditedTitle(e.target.value)}
              onBlur={() => void saveTitle()}
              onKeyDown={handleTitleKeyDown}
              className="text-xl font-semibold bg-transparent border-b-2 border-primary outline-none px-0 py-0 w-full max-w-md"
            />
          ) : (
            <button
              type="button"
              className="text-xl font-semibold truncate cursor-pointer hover:text-primary transition-colors"
              onClick={startEditingTitle}
              title="Click to edit"
            >
              {name}
            </button>
          )}
          <Badge
            variant={workflow.isEnabled ? "secondary" : "outline"}
            className={cn(!workflow.isEnabled && "text-muted-foreground")}
          >
            {workflow.isEnabled ? "Enabled" : "Disabled"}
          </Badge>
        </div>

        <div className="flex items-center gap-2">
          <Button size="sm" onClick={handleSave} disabled={!currentDefinition || isSaving}>
            <Save className="h-4 w-4 mr-2" />
            {isSaving ? "Saving…" : "Save"}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setShowJson(true)}>
                <Code className="h-4 w-4 mr-2" />
                View JSON
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => setDeleteDialogOpen(true)}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="flex-1 overflow-hidden">
        <StepListEditor onDefinitionChange={setCurrentDefinition} />
      </div>

      <Sheet open={showJson} onOpenChange={setShowJson}>
        <SheetContent className="w-[500px] sm:max-w-none">
          <SheetHeader>
            <SheetTitle>Workflow JSON</SheetTitle>
          </SheetHeader>
          <div className="mt-6">
            <pre className="text-xs bg-muted p-4 rounded-md overflow-auto max-h-[80vh]">
              {JSON.stringify(workflow.definition ?? {}, null, 2)}
            </pre>
          </div>
        </SheetContent>
      </Sheet>

      <DeleteWorkflowDialog
        name={name}
        open={deleteDialogOpen}
        isDeleting={isDeleting}
        onOpenChange={setDeleteDialogOpen}
        onConfirm={confirmDelete}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

interface DeleteWorkflowDialogProps {
  name: string;
  open: boolean;
  isDeleting: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void | Promise<void>;
}

function DeleteWorkflowDialog({ name, open, isDeleting, onOpenChange, onConfirm }: DeleteWorkflowDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete Workflow</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to delete "{name}"? This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              void onConfirm();
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
  );
}
