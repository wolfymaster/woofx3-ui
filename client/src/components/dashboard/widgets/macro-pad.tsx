import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { closestCenter, DndContext, type DragEndEvent, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { arrayMove, rectSortingStrategy, SortableContext, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useAction, useMutation, useQuery } from "convex/react";
import { Check, GripVertical, Loader2, Pencil, Plus, SlidersHorizontal, Trash2, Zap } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState } from "@/components/common/empty-state";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useInstance } from "@/hooks/use-instance";
import { useToast } from "@/hooks/use-toast";
import {
  applyMacroVariables,
  chatCommandParts,
  extractMacroVariables,
  isHexColor,
  type MacroButton,
  type MacroConfig,
  type MacroInput,
} from "@/lib/macro-pad";
import { cn } from "@/lib/utils";
import { MacroIconPreview } from "./macro-icon-picker";
import { MacroConfigModal } from "./macro-pad-config-modal";
import { MacroVariablePrompt } from "./macro-variable-prompt";

export type { MacroButton } from "@/lib/macro-pad";

interface MacroTileProps {
  macro: MacroButton;
  isEditMode: boolean;
  isExecuting: boolean;
  variableCount: number;
  onRun: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

function MacroTile({ macro, isEditMode, isExecuting, variableCount, onRun, onEdit, onDelete }: MacroTileProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: macro.id,
    disabled: !isEditMode,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  // Tint rather than fill: the label keeps the theme's foreground color, so a
  // pale or a vivid choice stays readable without measuring contrast. Same
  // `${hex}20` wash the module detail panel uses for catalog colors.
  const tint = isHexColor(macro.color) ? { borderColor: macro.color, backgroundColor: `${macro.color}20` } : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn("relative aspect-square", isDragging && "z-10 opacity-80")}
      data-testid={`macro-tile-${macro.id}`}
    >
      <button
        type="button"
        disabled={isEditMode || isExecuting}
        onClick={onRun}
        style={tint}
        className={cn(
          "h-full w-full rounded-lg border border-border bg-card p-2",
          "flex flex-col items-center justify-center gap-1.5 text-center",
          "transition-all duration-100",
          !isEditMode && "hover:border-primary/60 hover:bg-muted/50 active:scale-[0.97] active:bg-muted",
          isEditMode && "cursor-grab border-dashed active:cursor-grabbing",
          isDragging && "border-primary shadow-lg"
        )}
        {...(isEditMode ? attributes : {})}
        {...(isEditMode ? listeners : {})}
        data-testid={`button-macro-${macro.id}`}
      >
        {isExecuting ? (
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        ) : (
          <MacroIconPreview
            icon={macro.icon}
            className={tint ? undefined : "text-muted-foreground"}
            style={tint ? { color: macro.color } : undefined}
          />
        )}
        <span className="text-xs font-medium leading-tight line-clamp-2">{macro.label}</span>
        {variableCount > 0 && !isEditMode && (
          <span className="text-[10px] text-muted-foreground tabular-nums">
            {variableCount === 1 ? "1 input" : `${variableCount} inputs`}
          </span>
        )}
      </button>

      {isEditMode && (
        <>
          <GripVertical className="absolute bottom-1 left-1 h-3.5 w-3.5 text-muted-foreground/60 pointer-events-none" />
          <div className="absolute top-1 right-1 flex gap-0.5">
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5 bg-background/80"
              onClick={onEdit}
              data-testid={`button-edit-macro-${macro.id}`}
            >
              <Pencil className="h-3 w-3" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5 bg-background/80 text-destructive hover:text-destructive"
              onClick={onDelete}
              data-testid={`button-delete-macro-${macro.id}`}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

// Takes no props: the pad is shared per instance, so nothing about it comes from
// the per-user widget config.
export function MacroPadModule() {
  const { instance } = useInstance();
  const [isEditMode, setIsEditMode] = useState(false);
  const [configModalOpen, setConfigModalOpen] = useState(false);
  const [editingMacro, setEditingMacro] = useState<MacroButton | null>(null);
  const [isExecuting, setIsExecuting] = useState<string | null>(null);
  const [pendingMacro, setPendingMacro] = useState<MacroButton | null>(null);
  const [workflows, setWorkflows] = useState<{ id: string; name: string }[]>([]);
  const listEngineWorkflows = useAction(api.moduleEngine.listWorkflows);
  const triggerWorkflow = useAction(api.workflowActions.trigger);
  const sendChatMessage = useAction(api.twitchBroadcast.sendChatMessage);
  const executeCommand = useAction(api.chatCommandActions.executeCommand);
  const { toast } = useToast();

  const instanceId = instance?._id;
  const listArgs = instanceId ? { instanceId } : "skip";

  const macros = useQuery(api.macros.list, listArgs);
  const commands = useQuery(api.chatCommands.list, listArgs);
  const addMacro = useMutation(api.macros.addMacro);
  const updateMacro = useMutation(api.macros.updateMacro);
  const deleteMacro = useMutation(api.macros.deleteMacro);
  // Without an optimistic update a dragged tile springs back to its old slot
  // until the server round-trip lands.
  const reorderMacros = useMutation(api.macros.reorderMacros).withOptimisticUpdate((localStore, args) => {
    if (!instanceId) {
      return;
    }
    const current = localStore.getQuery(api.macros.list, { instanceId });
    if (!current) {
      return;
    }
    const byId = new Map(current.map((macro) => [macro.id, macro]));
    const reordered = args.macroIds.flatMap((id) => {
      const macro = byId.get(id);
      return macro ? [macro] : [];
    });
    localStore.setQuery(api.macros.list, { instanceId }, reordered);
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: depends on instance?._id (not the instance object) so it doesn't re-fetch on every reference change
  useEffect(() => {
    if (!instance) return;
    listEngineWorkflows({ instanceId: instance._id }).then(setWorkflows).catch(console.error);
  }, [instance?._id, listEngineWorkflows]);

  const variableCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const macro of macros ?? []) {
      counts[macro.id] = extractMacroVariables(macro.config).length;
    }
    return counts;
  }, [macros]);

  const handleAddMacro = useCallback(() => {
    setEditingMacro(null);
    setConfigModalOpen(true);
  }, []);

  const handleDeleteMacro = useCallback(
    (id: string) => {
      if (!instanceId) {
        return;
      }
      void deleteMacro({ instanceId, macroId: id as Id<"macros"> });
    },
    [instanceId, deleteMacro]
  );

  const handleSaveMacro = useCallback(
    (input: MacroInput) => {
      if (!instanceId) {
        return;
      }
      if (editingMacro) {
        void updateMacro({ instanceId, macroId: editingMacro.id as Id<"macros">, ...input });
      } else {
        void addMacro({ instanceId, ...input });
      }
      setConfigModalOpen(false);
      setEditingMacro(null);
    },
    [editingMacro, instanceId, addMacro, updateMacro]
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id || !instanceId || !macros) {
        return;
      }
      const from = macros.findIndex((m) => m.id === active.id);
      const to = macros.findIndex((m) => m.id === over.id);
      if (from === -1 || to === -1) {
        return;
      }
      const macroIds = arrayMove(macros, from, to).map((m) => m.id);
      void reorderMacros({ instanceId, macroIds });
    },
    [macros, instanceId, reorderMacros]
  );

  // A pad button is a small target; requiring a few pixels of movement keeps a
  // click from being swallowed as the start of a drag.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  // `resolved` arrives with every {{variable}} already filled in.
  const runMacro = useCallback(
    async (macro: MacroButton, resolved: MacroConfig) => {
      if (!instanceId) {
        return;
      }
      setIsExecuting(macro.id);
      try {
        switch (macro.type) {
          case "send-message":
            await sendChatMessage({ instanceId, message: resolved.message ?? "" });
            break;
          case "chat-command": {
            const { command, text } = chatCommandParts(resolved);
            await executeCommand({ instanceId, command, text });
            break;
          }
          case "trigger-workflow":
            if (!resolved.workflowId) {
              throw new Error("This button has no workflow selected");
            }
            // Resolves once the request reaches the bus. The run happens in
            // the engine and reports its own lifecycle, so there is nothing
            // further to await here.
            await triggerWorkflow({ instanceId, workflowNameOrId: resolved.workflowId });
            break;
          case "http-request":
            if (resolved.url) {
              const response = await fetch(resolved.url, {
                method: resolved.method || "GET",
                headers: resolved.headers || {},
                body: resolved.body ? JSON.stringify(JSON.parse(resolved.body)) : undefined,
              });
              console.log("HTTP request result:", response.status);
            }
            break;
        }
      } catch (error) {
        toast({
          title: `"${macro.label}" failed`,
          description: error instanceof Error ? error.message : String(error),
          variant: "destructive",
        });
      } finally {
        setIsExecuting(null);
      }
    },
    [instanceId, triggerWorkflow, sendChatMessage, executeCommand, toast]
  );

  const handlePress = useCallback(
    (macro: MacroButton) => {
      if (isEditMode) {
        return;
      }
      if (extractMacroVariables(macro.config).length > 0) {
        setPendingMacro(macro);
        return;
      }
      void runMacro(macro, macro.config);
    },
    [isEditMode, runMacro]
  );

  const handleVariablesSubmitted = useCallback(
    (values: Record<string, string>) => {
      if (!pendingMacro) {
        return;
      }
      const macro = pendingMacro;
      setPendingMacro(null);
      void runMacro(macro, applyMacroVariables(macro.config, values));
    },
    [pendingMacro, runMacro]
  );

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-end px-3 py-2 border-b border-border shrink-0">
        <TooltipProvider>
          <div className="flex items-center gap-1">
            {macros && macros.length > 0 && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={isEditMode ? "secondary" : "ghost"}
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => setIsEditMode(!isEditMode)}
                    data-testid="button-toggle-macro-edit"
                  >
                    {isEditMode ? <Check className="h-3.5 w-3.5" /> : <SlidersHorizontal className="h-3.5 w-3.5" />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{isEditMode ? "Done" : "Edit and reorder"}</TooltipContent>
              </Tooltip>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={handleAddMacro}
                  data-testid="button-add-macro"
                >
                  <Plus className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Add a macro</TooltipContent>
            </Tooltip>
          </div>
        </TooltipProvider>
      </div>

      <div className="flex-1 overflow-auto p-3">
        {macros === undefined ? (
          <div className="h-full flex items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : macros.length === 0 ? (
          <EmptyState
            icon={Zap}
            title="No macros yet"
            description="Add a button to send a chat message, run a chat command, fire a workflow, or make an HTTP request in one click."
            action={{ label: "Add Macro", onClick: handleAddMacro }}
            className="h-full py-6"
          />
        ) : (
          <>
            {isEditMode && <p className="text-[11px] text-muted-foreground mb-2">Drag to reorder</p>}
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={macros.map((m) => m.id)} strategy={rectSortingStrategy}>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(5.25rem,1fr))] gap-2">
                  {macros.map((macro) => (
                    <MacroTile
                      key={macro.id}
                      macro={macro}
                      isEditMode={isEditMode}
                      isExecuting={isExecuting === macro.id}
                      variableCount={variableCounts[macro.id] ?? 0}
                      onRun={() => handlePress(macro)}
                      onEdit={() => {
                        setEditingMacro(macro);
                        setConfigModalOpen(true);
                      }}
                      onDelete={() => handleDeleteMacro(macro.id)}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          </>
        )}
      </div>

      <MacroConfigModal
        open={configModalOpen}
        onOpenChange={setConfigModalOpen}
        macro={editingMacro}
        workflows={workflows}
        commands={commands ?? []}
        onSave={handleSaveMacro}
      />

      <MacroVariablePrompt
        open={pendingMacro !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPendingMacro(null);
          }
        }}
        macroLabel={pendingMacro?.label ?? ""}
        variables={pendingMacro ? extractMacroVariables(pendingMacro.config) : []}
        onSubmit={handleVariablesSubmitted}
      />
    </div>
  );
}
