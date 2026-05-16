import { api } from "@convex/_generated/api";
import type { Doc, Id } from "@convex/_generated/dataModel";
import type { WorkflowDefinition } from "@woofx3/api";
import { useAction, useQuery } from "convex/react";
import {
  ArrowLeft,
  Code,
  Loader2,
  MoreVertical,
  Plus,
  Save,
  Trash2,
  Workflow as WorkflowIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useLocation, useParams } from "wouter";
import { BasicWorkflowEditor } from "@/components/workflows/basic-editor";
import StepListEditor from "@/components/workflows/step-list-editor";
import { WorkflowsSidebar, type WorkflowListItem } from "@/components/workflows/workflows-sidebar";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useInstance } from "@/hooks/use-instance";
import { useToast } from "@/hooks/use-toast";

type WorkflowRow = Doc<"workflows">;

function workflowName(row: WorkflowRow): string {
  const def = row.definition as { name?: string } | undefined;
  return def?.name ?? row.engineWorkflowId;
}

export default function Workflows() {
  const params = useParams<{ id?: string }>();
  const [, navigate] = useLocation();
  const engineWorkflowIdFromUrl = params?.id;

  const { toast } = useToast();
  const { instance } = useInstance();

  const [selectedWorkflow, setSelectedWorkflow] = useState<WorkflowListItem | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showJson, setShowJson] = useState(false);

  const workflows = useQuery(
    api.workflows.list,
    instance ? { instanceId: instance._id as Id<"instances"> } : "skip"
  );

  const deleteByEngineId = useAction(api.workflowActions.deleteByEngineId);
  const updateFromDefinition = useAction(api.workflowActions.updateFromDefinition);

  const [isSaving, setIsSaving] = useState(false);
  const [currentDefinition, setCurrentDefinition] = useState<WorkflowDefinition | null>(null);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editedTitle, setEditedTitle] = useState("");
  const titleInputRef = useRef<HTMLInputElement>(null);

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
          stepCount: 0,
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

  const handleSave = async () => {
    if (!instance || !selectedWorkflow || !currentDefinition) {
      return;
    }
    setIsSaving(true);
    try {
      await updateFromDefinition({
        instanceId: instance._id as Id<"instances">,
        engineWorkflowId: selectedWorkflow.engineWorkflowId,
        definition: currentDefinition,
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

  const handleDefinitionChange = (definition: WorkflowDefinition) => {
    setCurrentDefinition(definition);
  };

  const handleTitleClick = () => {
    if (!selectedWorkflow) {
      return;
    }
    setEditedTitle(selectedWorkflow.name);
    setIsEditingTitle(true);
    setTimeout(() => {
      titleInputRef.current?.focus();
      titleInputRef.current?.select();
    }, 0);
  };

  const saveTitle = async () => {
    if (!instance || !selectedWorkflow || !selectedWorkflowData) {
      return;
    }
    const trimmed = editedTitle.trim();
    if (!trimmed || trimmed === selectedWorkflow.name) {
      setIsEditingTitle(false);
      return;
    }
    try {
      const def = selectedWorkflowData.definition as WorkflowDefinition;
      await updateFromDefinition({
        instanceId: instance._id as Id<"instances">,
        engineWorkflowId: selectedWorkflow.engineWorkflowId,
        definition: { ...def, name: trimmed },
      });
      setSelectedWorkflow({ ...selectedWorkflow, name: trimmed });
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

  return (
    <div className="flex h-[calc(100vh-4rem)]">
      <WorkflowsSidebar
        selectedWorkflowId={selectedWorkflow?.engineWorkflowId ?? null}
        onSelectWorkflow={handleSelectWorkflow}
      />

      <div className="flex-1 overflow-hidden">
        {selectedWorkflow && selectedWorkflowData ? (
          <div className="h-full flex flex-col">
            <div className="h-14 border-b border-border bg-background flex items-center justify-between px-4 shrink-0">
              <div className="flex items-center gap-4">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    setSelectedWorkflow(null);
                    navigate("/workflows");
                  }}
                >
                  <ArrowLeft className="h-5 w-5" />
                </Button>
                <div className="flex-1">
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
                    <h2
                      className="text-xl font-semibold cursor-pointer hover:text-primary transition-colors"
                      onClick={handleTitleClick}
                      title="Click to edit"
                    >
                      {selectedWorkflow.name}
                    </h2>
                  )}
                </div>
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
                    <DropdownMenuItem onClick={handleDelete} className="text-destructive focus:text-destructive">
                      <Trash2 className="h-4 w-4 mr-2" />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>

            <div className="flex-1 overflow-hidden">
              <StepListEditor onDefinitionChange={handleDefinitionChange} />
            </div>

            <Sheet open={showJson} onOpenChange={setShowJson}>
              <SheetContent className="w-[500px] sm:max-w-none">
                <SheetHeader>
                  <SheetTitle>Workflow JSON</SheetTitle>
                </SheetHeader>
                <div className="mt-6">
                  <pre className="text-xs bg-muted p-4 rounded-md overflow-auto max-h-[80vh]">
                    {JSON.stringify(selectedWorkflowData?.definition ?? {}, null, 2)}
                  </pre>
                </div>
              </SheetContent>
            </Sheet>
          </div>
        ) : (
          <div className="p-6 lg:p-8 max-w-[1600px] mx-auto">
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
              <>
                <PageHeader
                  title="Create a new workflow"
                  description="Choose what triggers your workflow"
                />
                <BasicWorkflowEditor />
              </>
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
