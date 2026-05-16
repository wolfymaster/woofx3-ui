import { api } from "@convex/_generated/api";
import { useStore } from "@nanostores/react";
import type { WorkflowDefinition } from "@woofx3/api";
import { useQuery } from "convex/react";
import { Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "wouter";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { $currentInstanceId } from "@/lib/stores";
import { definitionToTree, treeToDefinition, type StepNode, type WorkflowTree } from "@/lib/workflow-tree";
import { StepNodeCard } from "./step-node";

interface InsertButtonProps {
  onInsert: (type: "action" | "condition" | "wait") => void;
  label?: string;
}

function InsertButton({ onInsert, label }: InsertButtonProps) {
  return (
    <div className="flex items-center justify-center py-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="h-6 text-xs text-muted-foreground hover:text-foreground">
            <Plus className="h-3 w-3 mr-1" />
            {label || "Add step"}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="center">
          <DropdownMenuItem onClick={() => onInsert("action")}>
            Action
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onInsert("condition")}>
            Condition
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onInsert("wait")}>
            Wait
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

interface StepListProps {
  steps: StepNode[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onInsert: (index: number, type: "action" | "condition" | "wait") => void;
  depth?: number;
}

function StepList({ steps, selectedId, onSelect, onInsert, depth = 0 }: StepListProps) {
  return (
    <div className="space-y-0">
      {steps.map((step, index) => (
        <div key={step.id}>
          <StepNodeCard
            node={step}
            isSelected={selectedId === step.id}
            onSelect={() => onSelect(step.id)}
            depth={depth}
          />
          {step.type === "condition" && (
            <div className="mt-2 mb-2">
              <div className="flex items-center gap-2 ml-6">
                <div className="h-px w-4 bg-border" />
                <span className="text-xs text-muted-foreground font-medium">THEN</span>
              </div>
              <div className="mt-1 border-l-2 border-green-500/30 pl-4">
                {step.thenBranch.length > 0 ? (
                  <StepList
                    steps={step.thenBranch}
                    selectedId={selectedId}
                    onSelect={onSelect}
                    onInsert={(idx, type) => {
                      const newStep: StepNode =
                        type === "action"
                          ? { type: "action", id: `step-${Date.now()}`, action: "", parameters: {} }
                          : type === "condition"
                            ? { type: "condition", id: `step-${Date.now()}`, conditions: [], thenBranch: [], elseBranch: [] }
                            : { type: "wait", id: `step-${Date.now()}`, wait: { type: "event", event: "" } };
                      const newThenBranch = [...step.thenBranch];
                      newThenBranch.splice(idx, 0, newStep);
                      step.thenBranch = newThenBranch;
                    }}
                    depth={depth + 1}
                  />
                ) : (
                  <div className="py-2">
                    <InsertButton
                      onInsert={(type) => {
                        const newStep: StepNode =
                          type === "action"
                            ? { type: "action", id: `step-${Date.now()}`, action: "", parameters: {} }
                            : type === "condition"
                              ? { type: "condition", id: `step-${Date.now()}`, conditions: [], thenBranch: [], elseBranch: [] }
                              : { type: "wait", id: `step-${Date.now()}`, wait: { type: "event", event: "" } };
                        step.thenBranch = [newStep];
                      }}
                      label="Add to then"
                    />
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2 ml-6 mt-2">
                <div className="h-px w-4 bg-border" />
                <span className="text-xs text-muted-foreground font-medium">ELSE</span>
              </div>
              <div className="mt-1 border-l-2 border-red-500/30 pl-4">
                {step.elseBranch.length > 0 ? (
                  <StepList
                    steps={step.elseBranch}
                    selectedId={selectedId}
                    onSelect={onSelect}
                    onInsert={(idx, type) => {
                      const newStep: StepNode =
                        type === "action"
                          ? { type: "action", id: `step-${Date.now()}`, action: "", parameters: {} }
                          : type === "condition"
                            ? { type: "condition", id: `step-${Date.now()}`, conditions: [], thenBranch: [], elseBranch: [] }
                            : { type: "wait", id: `step-${Date.now()}`, wait: { type: "event", event: "" } };
                      const newElseBranch = [...step.elseBranch];
                      newElseBranch.splice(idx, 0, newStep);
                      step.elseBranch = newElseBranch;
                    }}
                    depth={depth + 1}
                  />
                ) : (
                  <div className="py-2">
                    <InsertButton
                      onInsert={(type) => {
                        const newStep: StepNode =
                          type === "action"
                            ? { type: "action", id: `step-${Date.now()}`, action: "", parameters: {} }
                            : type === "condition"
                              ? { type: "condition", id: `step-${Date.now()}`, conditions: [], thenBranch: [], elseBranch: [] }
                              : { type: "wait", id: `step-${Date.now()}`, wait: { type: "event", event: "" } };
                        step.elseBranch = [newStep];
                      }}
                      label="Add to else"
                    />
                  </div>
                )}
              </div>
            </div>
          )}
          <InsertButton onInsert={(type) => onInsert(index + 1, type)} />
        </div>
      ))}
    </div>
  );
}

interface StepListEditorProps {
  onDefinitionChange?: (definition: WorkflowDefinition) => void;
}

export default function StepListEditor({ onDefinitionChange }: StepListEditorProps) {
  const params = useParams<{ id: string }>();
  const engineWorkflowId = params?.id;
  const instanceId = useStore($currentInstanceId);

  const workflow = useQuery(
    api.workflows.getByEngineId,
    instanceId && engineWorkflowId ? { instanceId: instanceId as never, engineWorkflowId } : "skip"
  );

  const [tree, setTree] = useState<WorkflowTree | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  useEffect(() => {
    if (workflow?.definition) {
      setTree(definitionToTree(workflow.definition as WorkflowDefinition));
    }
  }, [workflow?.definition]);

  const handleInsertStep = useCallback(
    (index: number, type: "action" | "condition" | "wait") => {
      if (!tree) {
        return;
      }
      const newStep: StepNode =
        type === "action"
          ? { type: "action", id: `step-${Date.now()}`, action: "", parameters: {} }
          : type === "condition"
            ? { type: "condition", id: `step-${Date.now()}`, conditions: [], thenBranch: [], elseBranch: [] }
            : { type: "wait", id: `step-${Date.now()}`, wait: { type: "event", event: "" } };

      const newSteps = [...tree.steps];
      newSteps.splice(index, 0, newStep);
      const newTree = { ...tree, steps: newSteps };
      setTree(newTree);

      if (onDefinitionChange && workflow?.definition) {
        const def = treeToDefinition(newTree);
        def.id = (workflow.definition as WorkflowDefinition).id;
        def.name = (workflow.definition as WorkflowDefinition).name;
        onDefinitionChange(def);
      }
    },
    [tree, workflow, onDefinitionChange]
  );

  const isLoading = workflow === undefined;

  const selectedNode = useMemo(() => {
    if (!tree || !selectedNodeId) {
      return null;
    }
    if (selectedNodeId === "__trigger") {
      return tree.trigger;
    }
    return tree.steps.find((s) => s.id === selectedNodeId) ?? null;
  }, [tree, selectedNodeId]);

  return (
    <div className="h-full flex overflow-hidden">
      <ScrollArea className="flex-1">
        <div className="p-8 max-w-2xl mx-auto">
          {isLoading ? (
            <div className="text-sm text-muted-foreground">Loading workflow…</div>
          ) : !workflow ? (
            <div className="text-sm text-muted-foreground">Workflow not found.</div>
          ) : tree ? (
            <div className="space-y-0">
              <StepNodeCard
                node={tree.trigger}
                isSelected={selectedNodeId === "__trigger"}
                onSelect={() => setSelectedNodeId("__trigger")}
              />
              <InsertButton
                onInsert={(type) => handleInsertStep(0, type)}
                label="Add step after trigger"
              />
              <StepList
                steps={tree.steps}
                selectedId={selectedNodeId}
                onSelect={setSelectedNodeId}
                onInsert={handleInsertStep}
              />
            </div>
          ) : null}
        </div>
      </ScrollArea>

      <Sheet open={!!selectedNode} onOpenChange={() => setSelectedNodeId(null)}>
        <SheetContent className="w-[400px]">
          <SheetHeader>
            <SheetTitle>Node Configuration</SheetTitle>
          </SheetHeader>
          <div className="mt-6">
            {selectedNode && (
              <pre className="text-xs bg-muted p-3 rounded overflow-auto">
                {JSON.stringify(selectedNode, null, 2)}
              </pre>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
