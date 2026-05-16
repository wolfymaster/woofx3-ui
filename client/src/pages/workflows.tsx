import { api } from "@convex/_generated/api";
import type { Doc, Id } from "@convex/_generated/dataModel";
import { useAction, useQuery } from "convex/react";
import {
  ArrowLeft,
  CheckCircle2,
  Edit3,
  Loader2,
  MoreHorizontal,
  Plus,
  Power,
  PowerOff,
  Trash2,
  Workflow as WorkflowIcon,
  Zap,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useLocation, useParams } from "wouter";
import { BasicWorkflowEditor } from "@/components/workflows/basic-editor";
import { WorkflowsSidebar, type WorkflowListItem } from "@/components/workflows/workflows-sidebar";
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PageHeader } from "@/components/layout/page-header";
import { Switch } from "@/components/ui/switch";
import { useInstance } from "@/hooks/use-instance";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

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

export default function Workflows() {
  const params = useParams<{ id?: string }>();
  const [location, navigate] = useLocation();
  const isEditMode = location.endsWith("/edit");
  const engineWorkflowIdFromUrl = params?.id;

  const { toast } = useToast();
  const { instance } = useInstance();

  const [selectedWorkflow, setSelectedWorkflow] = useState<WorkflowListItem | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const workflows = useQuery(
    api.workflows.list,
    instance ? { instanceId: instance._id as Id<"instances"> } : "skip"
  );

  const setEnabled = useAction(api.workflowActions.setEnabled);
  const deleteByEngineId = useAction(api.workflowActions.deleteByEngineId);

  const selectedWorkflowData = workflows?.find(
    (w) => w.engineWorkflowId === selectedWorkflow?.engineWorkflowId
  );

  useEffect(() => {
    if (engineWorkflowIdFromUrl && workflows) {
      const found = workflows.find((w) => w.engineWorkflowId === engineWorkflowIdFromUrl);
      if (found) {
        setSelectedWorkflow({
          _id: found._id,
          engineWorkflowId: found.engineWorkflowId,
          name: workflowName(found),
          description: (found.definition as { description?: string } | undefined)?.description,
          isEnabled: found.isEnabled,
          stepCount: workflowStepCount(found),
        });
      }
    }
  }, [engineWorkflowIdFromUrl, workflows]);

  const handleSelectWorkflow = (workflow: WorkflowListItem | null) => {
    setSelectedWorkflow(workflow);
    if (workflow) {
      navigate(`/workflows/${workflow.engineWorkflowId}`);
    } else {
      navigate("/workflows");
    }
  };

  const handleDelete = () => {
    setDeleteDialogOpen(true);
  };

  const confirmDelete = async () => {
    if (!instance || !selectedWorkflow) {
      return;
    }
    setIsDeleting(true);
    try {
      await deleteByEngineId({
        instanceId: instance._id as Id<"instances">,
        engineWorkflowId: selectedWorkflow.engineWorkflowId,
      });
      setDeleteDialogOpen(false);
      setSelectedWorkflow(null);
      navigate("/workflows");
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

  const handleEdit = () => {
    if (selectedWorkflow) {
      navigate(`/workflows/${selectedWorkflow.engineWorkflowId}/edit`);
    }
  };

  const handleBackFromEdit = () => {
    if (selectedWorkflow) {
      navigate(`/workflows/${selectedWorkflow.engineWorkflowId}`);
    } else {
      navigate("/workflows");
    }
  };

  const handleToggle = async (enabled: boolean) => {
    if (!instance || !selectedWorkflow) {
      return;
    }
    try {
      await setEnabled({
        instanceId: instance._id as Id<"instances">,
        engineWorkflowId: selectedWorkflow.engineWorkflowId,
        isEnabled: enabled,
      });
    } catch (err) {
      toast({
        title: "Failed to toggle workflow",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    }
  };

  return (
    <div className="flex h-[calc(100vh-4rem)]">
      <WorkflowsSidebar
        selectedWorkflowId={selectedWorkflow?.engineWorkflowId ?? null}
        onSelectWorkflow={handleSelectWorkflow}
      />

      <div className="flex-1 overflow-hidden">
        {isEditMode ? (
          <div className="h-full">
            <BasicWorkflowEditor />
          </div>
        ) : selectedWorkflow && selectedWorkflowData ? (
          <div className="h-full overflow-auto">
            <div className="p-6">
              <div className="flex items-center gap-4 mb-6">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    setSelectedWorkflow(null);
                    navigate("/workflows");
                  }}
                >
                  <ArrowLeft className="h-4 w-4" />
                </Button>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h2 className="text-xl font-semibold">{selectedWorkflow.name}</h2>
                    <Badge variant={selectedWorkflow.isEnabled ? "secondary" : "outline"} className="text-xs">
                      {selectedWorkflow.isEnabled ? (
                        <>
                          <Power className="h-3 w-3 mr-1" />
                          Active
                        </>
                      ) : (
                        "Inactive"
                      )}
                    </Badge>
                  </div>
                  {selectedWorkflow.description && (
                    <p className="text-sm text-muted-foreground">{selectedWorkflow.description}</p>
                  )}
                </div>
                <>
                  <Button variant="outline" size="sm" onClick={handleEdit}>
                    <Edit3 className="h-4 w-4 mr-2" />
                    Edit
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={handleEdit}>
                        <Edit3 className="h-4 w-4 mr-2" />
                        Edit Workflow
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={handleDelete}
                        className="text-destructive focus:text-destructive"
                      >
                        <Trash2 className="h-4 w-4 mr-2" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Zap className="h-4 w-4" />
                      Steps
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{selectedWorkflow.stepCount}</div>
                    <p className="text-xs text-muted-foreground mt-1">Total steps in workflow</p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Power className="h-4 w-4" />
                      Status
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={selectedWorkflow.isEnabled}
                        onCheckedChange={handleToggle}
                      />
                      <span className="text-sm">
                        {selectedWorkflow.isEnabled ? "Enabled" : "Disabled"}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      Toggle to enable or disable the workflow
                    </p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4" />
                      Trigger
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {selectedWorkflowData.nodes && selectedWorkflowData.nodes.length > 0 ? (
                      <div className="space-y-2">
                        {selectedWorkflowData.nodes.slice(0, 3).map((node: { type?: string; label?: string }, i: number) => (
                          <div key={i} className="text-sm">
                            <span className="text-muted-foreground">{node.type || "trigger"}:</span>{" "}
                            {node.label || "unnamed"}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">No trigger configured</p>
                    )}
                  </CardContent>
                </Card>

                <Card className="md:col-span-2 lg:col-span-3">
                  <CardHeader>
                    <CardTitle className="text-sm">Definition</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <pre className="text-xs bg-muted p-3 rounded-md overflow-auto max-h-64">
                      {JSON.stringify(selectedWorkflowData.definition, null, 2)}
                    </pre>
                  </CardContent>
                </Card>
              </div>
            </div>
          </div>
        ) : (
          <div className="p-6 lg:p-8 max-w-[1600px] mx-auto">
            <PageHeader
              title="Workflows"
              description="Automate your stream with trigger-action workflows."
              actions={
                <Button onClick={() => navigate("/workflows/new")} data-testid="button-new-workflow">
                  <Plus className="h-4 w-4 mr-2" />
                  New Workflow
                </Button>
              }
            />

            {workflows === undefined ? (
              <div className="flex items-center justify-center min-h-[40vh]">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : workflows.length === 0 ? (
              <div className="mt-8 text-center">
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-muted mb-4">
                  <WorkflowIcon className="h-8 w-8 text-muted-foreground" />
                </div>
                <h3 className="text-lg font-semibold mb-2">No workflows yet</h3>
                <p className="text-sm text-muted-foreground max-w-sm mx-auto mb-6">
                  Create your first workflow to start automating your stream.
                </p>
                <Button onClick={() => navigate("/workflows/new")}>
                  <Plus className="h-4 w-4 mr-2" />
                  Create Workflow
                </Button>
              </div>
            ) : (
              <div className="mt-8 text-center">
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-muted mb-4">
                  <WorkflowIcon className="h-8 w-8 text-muted-foreground" />
                </div>
                <h3 className="text-lg font-semibold mb-2">Select a workflow</h3>
                <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                  Choose a workflow from the sidebar to view its details, or create a new one.
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Workflow</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{selectedWorkflow?.name}"? This action cannot be undone.
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
    </div>
  );
}