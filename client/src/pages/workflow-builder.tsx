import { api } from "@convex/_generated/api";
import { useStore } from "@nanostores/react";
import type { WorkflowDefinition } from "@woofx3/api";
import { useAction, useMutation, useQuery } from "convex/react";
import {
  ArrowRight,
  ChevronLeft,
  Clock,
  GitBranch,
  GripVertical,
  Maximize2,
  Redo2,
  Save,
  Search,
  Settings2,
  Trash2,
  Undo2,
  Zap,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import ReactFlow, {
  Background,
  BackgroundVariant,
  Controls,
  type Edge,
  Handle,
  MiniMap,
  type Node,
  type NodeProps,
  type NodeTypes,
  Panel,
  Position,
  useEdgesState,
  useNodesState,
} from "reactflow";
import "reactflow/dist/style.css";
import { useLocation, useParams } from "wouter";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
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
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import { useWorkflowCatalog } from "@/hooks/use-workflow-catalog";
import { resolveLucideIcon } from "@/lib/resolve-lucide-icon";
import { $currentInstanceId } from "@/lib/stores";
import { cn } from "@/lib/utils";
import { definitionToReactFlow, type ProjectionNode } from "@/lib/workflow-projection";

type NodeKind = "trigger" | "action" | "condition" | "delay" | "wait" | "workflow" | "log";

type NodeLibraryCategory = {
  name: string;
  type: NodeKind;
  icon: React.ReactNode;
  items: { id: string; label: string; description: string; icon: string }[];
};

const staticNodeLibraryCategories: NodeLibraryCategory[] = [
  {
    name: "Logic",
    type: "condition",
    icon: <GitBranch className="h-4 w-4" />,
    items: [
      { id: "condition", label: "Condition", description: "Branch based on conditions", icon: "GitBranch" },
      { id: "filter", label: "Filter", description: "Filter events by criteria", icon: "Filter" },
      { id: "random", label: "Random", description: "Random path selection", icon: "GitBranch" },
    ],
  },
  {
    name: "Timing",
    type: "delay",
    icon: <Clock className="h-4 w-4" />,
    items: [
      { id: "delay", label: "Delay", description: "Wait before continuing", icon: "Clock" },
      { id: "cooldown", label: "Cooldown", description: "Rate limit execution", icon: "Clock" },
      { id: "schedule", label: "Schedule", description: "Run at specific times", icon: "Clock" },
    ],
  },
];

const KIND_COLORS: Record<NodeKind, { border: string; icon: string; handle: string; mini: string }> = {
  trigger: {
    border: "border-green-500/50 bg-green-500/5",
    icon: "bg-green-500/20 text-green-500",
    handle: "bg-green-500",
    mini: "rgb(34 197 94)",
  },
  action: {
    border: "border-blue-500/50 bg-blue-500/5",
    icon: "bg-blue-500/20 text-blue-500",
    handle: "bg-blue-500",
    mini: "rgb(59 130 246)",
  },
  condition: {
    border: "border-yellow-500/50 bg-yellow-500/5",
    icon: "bg-yellow-500/20 text-yellow-500",
    handle: "bg-yellow-500",
    mini: "rgb(234 179 8)",
  },
  delay: {
    border: "border-purple-500/50 bg-purple-500/5",
    icon: "bg-purple-500/20 text-purple-500",
    handle: "bg-purple-500",
    mini: "rgb(168 85 247)",
  },
  wait: {
    border: "border-purple-500/50 bg-purple-500/5",
    icon: "bg-purple-500/20 text-purple-500",
    handle: "bg-purple-500",
    mini: "rgb(168 85 247)",
  },
  workflow: {
    border: "border-blue-500/50 bg-blue-500/5",
    icon: "bg-blue-500/20 text-blue-500",
    handle: "bg-blue-500",
    mini: "rgb(59 130 246)",
  },
  log: {
    border: "border-slate-500/50 bg-slate-500/5",
    icon: "bg-slate-500/20 text-slate-500",
    handle: "bg-slate-500",
    mini: "rgb(100 116 139)",
  },
};

function nodeKindOf(node: Node): NodeKind {
  const t = (node.type ?? "action") as NodeKind;
  return t in KIND_COLORS ? t : "action";
}

function nodeLabel(node: Node): string {
  const data = node.data as ProjectionNode["data"] | undefined;
  if (!data) {
    return node.id;
  }
  if (data.kind === "trigger") {
    return data.eventType ? `Trigger: ${data.eventType}` : "Trigger";
  }
  const task = data.task;
  if (!task) {
    return node.id;
  }
  const actionName = (task.parameters?.action as string | undefined) ?? undefined;
  if (task.type === "action" && actionName) {
    return actionName;
  }
  return `${task.type} · ${task.id}`;
}

function CustomNode({ data, selected, type }: NodeProps<ProjectionNode["data"]>) {
  const kind: NodeKind = (type as NodeKind) in KIND_COLORS ? (type as NodeKind) : "action";
  const Icon = resolveLucideIcon(kind === "trigger" ? "Zap" : "ArrowRight");
  const colors = KIND_COLORS[kind];

  const label =
    data.kind === "trigger"
      ? data.eventType
        ? `Trigger: ${data.eventType}`
        : "Trigger"
      : ((data.task?.parameters?.action as string | undefined) ??
        `${data.task?.type ?? "task"} · ${data.task?.id ?? ""}`);
  const description = data.kind === "task" ? data.task?.id : undefined;

  return (
    <div
      className={cn(
        "px-4 py-3 rounded-lg border-2 bg-card min-w-[180px] max-w-[220px]",
        colors.border,
        selected && "ring-2 ring-primary ring-offset-2 ring-offset-background"
      )}
      data-testid={`node-${kind}-${data.task?.id ?? "trigger"}`}
    >
      {kind !== "trigger" && (
        <Handle
          type="target"
          position={Position.Left}
          className={cn("!w-3 !h-3 !border-2 !border-background", colors.handle)}
        />
      )}
      <div className="flex items-center gap-3">
        <div className={cn("h-8 w-8 rounded-md flex items-center justify-center shrink-0", colors.icon)}>
          <Icon className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{label}</p>
          {description && <p className="text-xs text-muted-foreground truncate">{description}</p>}
        </div>
      </div>
      <Handle
        type="source"
        position={Position.Right}
        className={cn("!w-3 !h-3 !border-2 !border-background", colors.handle)}
      />
    </div>
  );
}

const nodeTypes: NodeTypes = {
  trigger: CustomNode,
  action: CustomNode,
  condition: CustomNode,
  delay: CustomNode,
  wait: CustomNode,
  workflow: CustomNode,
  log: CustomNode,
};

interface NodeLibraryProps {
  categories: NodeLibraryCategory[];
  catalogLoading: boolean;
  onDragStart: (event: React.DragEvent, nodeType: string, data: Record<string, unknown>) => void;
}

function NodeLibrary({ categories, catalogLoading, onDragStart }: NodeLibraryProps) {
  const [searchQuery, setSearchQuery] = useState("");

  const filteredCategories = useMemo(() => {
    if (!searchQuery) {
      return categories;
    }
    const query = searchQuery.toLowerCase();
    return categories
      .map((cat) => ({
        ...cat,
        items: cat.items.filter(
          (item) => item.label.toLowerCase().includes(query) || item.description.toLowerCase().includes(query)
        ),
      }))
      .filter((cat) => cat.items.length > 0);
  }, [searchQuery, categories]);

  const defaultOpen = useMemo(() => categories.map((c) => c.name), [categories]);

  return (
    <div className="w-60 bg-sidebar border-r border-sidebar-border flex flex-col">
      <div className="p-3 border-b border-sidebar-border space-y-2">
        {catalogLoading && <p className="text-xs text-muted-foreground">Loading instance catalog…</p>}
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search nodes..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8 h-8 text-sm"
            data-testid="input-search-nodes"
          />
        </div>
      </div>
      <ScrollArea className="flex-1">
        <Accordion type="multiple" defaultValue={defaultOpen} className="px-2 py-2">
          {filteredCategories.map((category) => (
            <AccordionItem key={category.name} value={category.name} className="border-none">
              <AccordionTrigger className="py-2 px-2 text-sm font-medium hover:no-underline hover:bg-sidebar-accent rounded-md">
                <span className="flex items-center gap-2">
                  {category.icon}
                  {category.name}
                </span>
              </AccordionTrigger>
              <AccordionContent className="pb-2">
                <div className="space-y-1">
                  {category.items.map((item) => {
                    const Icon = resolveLucideIcon(item.icon);
                    return (
                      // biome-ignore lint/a11y/noStaticElementInteractions: drag source for React Flow
                      <div
                        key={item.id}
                        className="flex items-center gap-2 p-2 rounded-md cursor-grab hover-elevate text-sm"
                        draggable
                        onDragStart={(e) =>
                          onDragStart(e, category.type, {
                            label: item.label,
                            description: item.description,
                            type: category.type,
                            icon: item.icon,
                          })
                        }
                        data-testid={`node-library-${item.id}`}
                      >
                        <GripVertical className="h-3 w-3 text-muted-foreground" />
                        <Icon className="h-4 w-4 text-muted-foreground" />
                        <span className="truncate">{item.label}</span>
                      </div>
                    );
                  })}
                </div>
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </ScrollArea>
    </div>
  );
}

interface NodeInspectorProps {
  node: Node | null;
  onClose: () => void;
}

function NodeInspector({ node, onClose }: NodeInspectorProps) {
  if (!node) {
    return null;
  }
  const label = nodeLabel(node);
  const kind = nodeKindOf(node);
  const data = node.data as ProjectionNode["data"] | undefined;
  const task = data?.kind === "task" ? data.task : undefined;

  return (
    <Sheet open={!!node} onOpenChange={() => onClose()}>
      <SheetContent className="w-[360px] sm:w-[400px]">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Settings2 className="h-5 w-5" />
            {label}
          </SheetTitle>
        </SheetHeader>
        <div className="mt-6 space-y-4">
          <div>
            <p className="text-xs text-muted-foreground">Type</p>
            <p className="text-sm font-medium capitalize">{kind}</p>
          </div>
          {task && (
            <div>
              <p className="text-xs text-muted-foreground">Task id</p>
              <p className="text-sm font-mono">{task.id}</p>
            </div>
          )}
          {task?.dependsOn && task.dependsOn.length > 0 && (
            <div>
              <p className="text-xs text-muted-foreground">Depends on</p>
              <p className="text-sm font-mono">{task.dependsOn.join(", ")}</p>
            </div>
          )}
          {task?.parameters && Object.keys(task.parameters).length > 0 && (
            <div>
              <p className="text-xs text-muted-foreground mb-1">Parameters</p>
              <pre className="p-2 bg-muted rounded text-xs overflow-auto max-h-64">
                {JSON.stringify(task.parameters, null, 2)}
              </pre>
            </div>
          )}
          <Separator />
          <p className="text-xs text-muted-foreground">
            Structural edits happen via the canonical JSON definition. Use "Preview JSON" in the toolbar to inspect the
            full workflow.
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}

export default function WorkflowBuilder() {
  const params = useParams<{ id: string }>();
  const engineWorkflowId = params?.id;
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const instanceId = useStore($currentInstanceId);
  const { catalogTriggers, catalogActions, loading: catalogLoading } = useWorkflowCatalog();

  const workflow = useQuery(
    api.workflows.getByEngineId,
    instanceId && engineWorkflowId ? { instanceId: instanceId as never, engineWorkflowId } : "skip"
  );

  const [definition, setDefinition] = useState<WorkflowDefinition | null>(null);
  useEffect(() => {
    if (workflow?.definition) {
      setDefinition(workflow.definition as WorkflowDefinition);
    }
  }, [workflow?.definition]);

  const projection = useMemo(
    () => (definition ? definitionToReactFlow(definition) : { nodes: [], edges: [] }),
    [definition]
  );
  const [nodes, setNodes, onNodesChange] = useNodesState(projection.nodes as Node[]);
  const [edges, _setEdges, onEdgesChange] = useEdgesState(projection.edges as Edge[]);

  useEffect(() => {
    setNodes(projection.nodes as Node[]);
    _setEdges(projection.edges as Edge[]);
  }, [projection, setNodes, _setEdges]);

  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const updateFromDefinition = useAction(api.workflowActions.updateFromDefinition);
  const updateProjection = useMutation(api.workflows.updateProjection);
  const deleteByEngineId = useAction(api.workflowActions.deleteByEngineId);

  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleSave = useCallback(async () => {
    if (!definition || !instanceId) {
      return;
    }
    setIsSaving(true);
    try {
      await updateFromDefinition({
        instanceId: instanceId as never,
        engineWorkflowId: definition.id,
        definition,
      });
      toast({ title: "Workflow saved" });
      void updateProjection({
        instanceId: instanceId as never,
        engineWorkflowId: definition.id,
        nodes: projection.nodes as unknown[],
        edges: projection.edges as unknown[],
      }).catch(() => {});
    } catch (err) {
      toast({
        title: "Save failed",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  }, [definition, instanceId, projection.nodes, projection.edges, updateFromDefinition, updateProjection, toast]);

  const handleDelete = useCallback(async () => {
    if (!definition || !instanceId) {
      return;
    }
    setIsDeleting(true);
    try {
      await deleteByEngineId({
        instanceId: instanceId as never,
        engineWorkflowId: definition.id,
      });
      toast({ title: "Workflow deleted" });
      setDeleteOpen(false);
      navigate("/workflows");
    } catch (err) {
      toast({
        title: "Delete failed",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setIsDeleting(false);
    }
  }, [definition, instanceId, deleteByEngineId, toast, navigate]);

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  const onDragStart = useCallback((event: React.DragEvent, nodeType: string, data: Record<string, unknown>) => {
    event.dataTransfer.setData("application/reactflow/type", nodeType);
    event.dataTransfer.setData("application/reactflow/data", JSON.stringify(data));
    event.dataTransfer.effectAllowed = "move";
  }, []);

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    setSelectedNode(node);
  }, []);

  const nodeLibraryCategories = useMemo((): NodeLibraryCategory[] => {
    const dynamic: NodeLibraryCategory[] = [];
    const triggerItems = catalogTriggers.map((t) => ({
      id: t.id,
      label: t.name,
      description: t.description,
      icon: t.icon || "Zap",
    }));
    if (triggerItems.length > 0) {
      dynamic.push({
        name: "Triggers",
        type: "trigger",
        icon: <Zap className="h-4 w-4" />,
        items: triggerItems,
      });
    }
    const actionItems = catalogActions.map((a) => ({
      id: a.id,
      label: a.name,
      description: a.description,
      icon: a.icon || "ArrowRight",
    }));
    if (actionItems.length > 0) {
      dynamic.push({
        name: "Actions",
        type: "action",
        icon: <ArrowRight className="h-4 w-4" />,
        items: actionItems,
      });
    }
    return [...dynamic, ...staticNodeLibraryCategories];
  }, [catalogTriggers, catalogActions]);

  const workflowName = definition?.name ?? workflow?.definition?.name ?? "Workflow";
  const isLoading = workflow === undefined;

  return (
    <div className="h-full flex flex-col">
      <div className="h-14 border-b border-border bg-background flex items-center justify-between px-4 shrink-0">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate("/workflows")} data-testid="button-back">
            <ChevronLeft className="h-5 w-5" />
          </Button>
          <Separator orientation="vertical" className="h-6" />
          <span className="font-semibold w-64 truncate" data-testid="text-workflow-name">
            {workflowName}
          </span>
          <Badge variant="secondary">{workflow?.isEnabled ? "Enabled" : "Disabled"}</Badge>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" disabled data-testid="button-undo">
            <Undo2 className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" disabled data-testid="button-redo">
            <Redo2 className="h-4 w-4" />
          </Button>
          <Separator orientation="vertical" className="h-6 mx-2" />
          <Button variant="outline" onClick={() => setShowPreview(true)} data-testid="button-preview-json">
            Preview JSON
          </Button>
          <Button
            variant="outline"
            onClick={() => setDeleteOpen(true)}
            data-testid="button-delete-workflow"
            disabled={!definition}
          >
            <Trash2 className="h-4 w-4 mr-2" />
            Delete
          </Button>
          <Button onClick={handleSave} disabled={!definition || isSaving} data-testid="button-save-workflow">
            <Save className="h-4 w-4 mr-2" />
            {isSaving ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        <NodeLibrary categories={nodeLibraryCategories} catalogLoading={catalogLoading} onDragStart={onDragStart} />

        <div className="flex-1 relative">
          {isLoading ? (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
              Loading workflow…
            </div>
          ) : !workflow ? (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
              Workflow not found.
            </div>
          ) : (
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onNodeClick={onNodeClick}
              onDragOver={onDragOver}
              nodeTypes={nodeTypes}
              fitView
              className="bg-background"
            >
              <Background variant={BackgroundVariant.Dots} gap={24} size={1} className="!bg-muted/30" />
              <Controls className="!bg-card !border-border !shadow-none" />
              <MiniMap
                className="!bg-card !border-border"
                nodeColor={(node) => {
                  const kind = nodeKindOf(node);
                  return KIND_COLORS[kind].mini;
                }}
              />
              <Panel position="bottom-left" className="flex items-center gap-2 !m-4">
                <Button variant="outline" size="icon" data-testid="button-zoom-in">
                  <ZoomIn className="h-4 w-4" />
                </Button>
                <Button variant="outline" size="icon" data-testid="button-zoom-out">
                  <ZoomOut className="h-4 w-4" />
                </Button>
                <Button variant="outline" size="icon" data-testid="button-fit-view">
                  <Maximize2 className="h-4 w-4" />
                </Button>
              </Panel>
            </ReactFlow>
          )}
        </div>
      </div>

      <NodeInspector node={selectedNode} onClose={() => setSelectedNode(null)} />

      <Sheet open={showPreview} onOpenChange={setShowPreview}>
        <SheetContent className="w-[640px] sm:max-w-none">
          <SheetHeader>
            <SheetTitle>Workflow JSON</SheetTitle>
          </SheetHeader>
          <pre className="mt-4 p-3 bg-muted rounded text-xs overflow-auto max-h-[80vh]">
            {JSON.stringify(definition ?? {}, null, 2)}
          </pre>
        </SheetContent>
      </Sheet>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete workflow</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the workflow from the engine and cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void handleDelete();
              }}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete"
            >
              {isDeleting ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
