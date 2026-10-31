import { closestCenter, DndContext, type DragEndEvent, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { arrayMove, rectSortingStrategy, SortableContext, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { CHAT_COMMAND_RUN_RESTRICTION, valuesToPairs } from "@shared/macro-run";
import { Check, GripVertical, Loader2, Pencil, Plus, Radio, SlidersHorizontal, Trash2, Zap } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState } from "@/components/common/empty-state";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useEngineScope } from "@/engine/context";
import { useChatCommands } from "@/engine/hooks/use-chat-commands";
import {
  useAddMacroRequest,
  useDeleteMacroRequest,
  useMacros,
  useReorderMacrosRequest,
  useRunMacroRequest,
  useUpdateMacroRequest,
} from "@/engine/hooks/use-macros";
import { useEngineWorkflowsRequest } from "@/engine/hooks/use-modules";
import { useSendChatMessageRequest } from "@/engine/hooks/use-twitch-chat";
import type { Macro, MacroId, MacroInput } from "@/engine/types";
import { useToast } from "@/hooks/use-toast";
import { applyMacroVariables, extractMacroVariables, isHexColor } from "@/lib/macro-pad";
import { cn } from "@/lib/utils";
import { MacroIconPreview } from "./macro-icon-picker";
import { MacroConfigModal } from "./macro-pad-config-modal";
import { type MacroPadRemoteTriggers, useNoRemoteTriggers } from "./macro-pad-remote-triggers";
import { MacroVariablePrompt } from "./macro-variable-prompt";

interface MacroTileProps {
  macro: Macro;
  isEditMode: boolean;
  isExecuting: boolean;
  variableCount: number;
  /** Status line of the macro's remote trigger, or undefined when it has none. */
  remoteTriggerStatus: string | undefined;
  /** Why this viewer may not press the button, or undefined when they may. */
  runBlockedReason: string | undefined;
  /** Why this viewer may not delete the button, or undefined when they may. */
  deleteBlockedReason: string | undefined;
  onRun: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

function MacroTile({
  macro,
  isEditMode,
  isExecuting,
  variableCount,
  remoteTriggerStatus,
  runBlockedReason,
  deleteBlockedReason,
  onRun,
  onEdit,
  onDelete,
}: MacroTileProps) {
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
      title={!isEditMode ? runBlockedReason : undefined}
      data-testid={`macro-tile-${macro.id}`}
    >
      <button
        type="button"
        disabled={isEditMode || isExecuting || (!isEditMode && runBlockedReason !== undefined)}
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

      {remoteTriggerStatus && !isEditMode && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              className="absolute top-1 left-1 text-muted-foreground/70"
              data-testid={`macro-remote-indicator-${macro.id}`}
            >
              <Radio className="h-3 w-3" />
              <span className="sr-only">Remote trigger: {remoteTriggerStatus}</span>
            </span>
          </TooltipTrigger>
          <TooltipContent>Remote trigger: {remoteTriggerStatus}</TooltipContent>
        </Tooltip>
      )}

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
            <Tooltip>
              <TooltipTrigger asChild>
                <span tabIndex={deleteBlockedReason === undefined ? undefined : 0} className="inline-flex">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5 bg-background/80 text-destructive hover:text-destructive"
                    onClick={onDelete}
                    disabled={deleteBlockedReason !== undefined}
                    aria-label="Delete macro"
                    data-testid={`button-delete-macro-${macro.id}`}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>{deleteBlockedReason ?? "Delete macro"}</TooltipContent>
            </Tooltip>
          </div>
        </>
      )}
    </div>
  );
}

interface MacroPadProps {
  /**
   * Reads what the pad shows of remote trigger URLs. A hook, called once per
   * render, so it must be the same function for the pad's whole life.
   */
  useRemoteTriggers: () => MacroPadRemoteTriggers;
}

// Nothing about the pad comes from the per-user widget config: it is shared
// per instance and kept behind the gateway.
export function MacroPad({ useRemoteTriggers }: MacroPadProps) {
  const { instanceId } = useEngineScope();
  const [isEditMode, setIsEditMode] = useState(false);
  const [configModalOpen, setConfigModalOpen] = useState(false);
  const [editingMacro, setEditingMacro] = useState<Macro | null>(null);
  const [isExecuting, setIsExecuting] = useState<MacroId | null>(null);
  const [pendingMacro, setPendingMacro] = useState<Macro | null>(null);
  const [workflows, setWorkflows] = useState<{ id: string; name: string }[]>([]);
  const listEngineWorkflows = useEngineWorkflowsRequest();
  const runMacroOnEngine = useRunMacroRequest();
  const sendChatMessage = useSendChatMessageRequest();
  const { toast } = useToast();

  const macros = useMacros();
  const commands = useChatCommands();
  const remoteTriggers = useRemoteTriggers();
  const addMacro = useAddMacroRequest();
  const updateMacro = useUpdateMacroRequest();
  const deleteMacro = useDeleteMacroRequest();
  const reorderMacros = useReorderMacrosRequest();

  useEffect(() => {
    if (!instanceId) {
      return;
    }
    listEngineWorkflows().then(setWorkflows).catch(console.error);
  }, [instanceId, listEngineWorkflows]);

  const variableCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const macro of macros ?? []) {
      counts[macro.id] = extractMacroVariables(macro.config).length;
    }
    return counts;
  }, [macros]);

  // Until the role is known, members and managers alike see buttons enabled;
  // the store refuses what the role does not allow either way.
  const canManage = remoteTriggers.canManage ?? true;
  const remoteTriggerStatuses = remoteTriggers.statuses;
  const RemoteTriggerSection = remoteTriggers.EditorSection;

  // A macro with a trigger URL does, from anywhere, whatever it is set to do,
  // so only a manager may change that.
  const behaviorLocked = editingMacro !== null && !canManage && editingMacro.id in remoteTriggerStatuses;

  const failed = useCallback(
    (title: string) => (error: unknown) => {
      toast({
        title,
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    },
    [toast]
  );

  const handleAddMacro = useCallback(() => {
    setEditingMacro(null);
    setConfigModalOpen(true);
  }, []);

  const handleDeleteMacro = useCallback(
    (id: MacroId) => {
      deleteMacro(id).catch(failed("Couldn't delete the macro"));
    },
    [deleteMacro, failed]
  );

  const handleSaveMacro = useCallback(
    (input: MacroInput) => {
      if (editingMacro) {
        updateMacro(editingMacro.id, input).catch(failed("Couldn't save the macro"));
      } else {
        addMacro(input).catch(failed("Couldn't add the macro"));
      }
      setConfigModalOpen(false);
      setEditingMacro(null);
    },
    [editingMacro, addMacro, updateMacro, failed]
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id || !macros) {
        return;
      }
      const from = macros.findIndex((m) => m.id === active.id);
      const to = macros.findIndex((m) => m.id === over.id);
      if (from === -1 || to === -1) {
        return;
      }
      const macroIds = arrayMove(macros, from, to).map((m) => m.id);
      reorderMacros(macroIds).catch(failed("Couldn't reorder the macros"));
    },
    [macros, reorderMacros, failed]
  );

  // A pad button is a small target; requiring a few pixels of movement keeps a
  // click from being swallowed as the start of a drag.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  // Chat-command, workflow and action macros run on the engine through the
  // gateway, planned as a remote trigger URL plans them. HTTP-request macros
  // are fetched from here, in the browser, so a target on the streamer's local
  // network stays reachable. Send-message macros post through the gateway's
  // Twitch chat, as the broadcaster.
  const runMacro = useCallback(
    async (macro: Macro, values: Record<string, string>) => {
      if (!instanceId) {
        return;
      }
      setIsExecuting(macro.id);
      try {
        if (macro.type === "http-request") {
          const resolved = applyMacroVariables(macro.config, values);
          if (resolved.url) {
            const response = await fetch(resolved.url, {
              method: resolved.method || "GET",
              headers: resolved.headers || {},
              body: resolved.body ? JSON.stringify(JSON.parse(resolved.body)) : undefined,
            });
            console.log("HTTP request result:", response.status);
          }
        } else if (macro.type === "send-message") {
          const resolved = applyMacroVariables(macro.config, values);
          await sendChatMessage(resolved.message ?? "");
        } else {
          await runMacroOnEngine(macro.id, valuesToPairs(values));
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
    [instanceId, runMacroOnEngine, sendChatMessage, toast]
  );

  const handlePress = useCallback(
    (macro: Macro) => {
      if (isEditMode) {
        return;
      }
      if (extractMacroVariables(macro.config).length > 0) {
        setPendingMacro(macro);
        return;
      }
      void runMacro(macro, {});
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
      void runMacro(macro, values);
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
            description="Add a button to send a chat message, run a chat command, fire a workflow, run an action, or make an HTTP request in one click."
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
                      remoteTriggerStatus={remoteTriggerStatuses[macro.id]}
                      runBlockedReason={
                        macro.type === "chat-command" && !canManage ? CHAT_COMMAND_RUN_RESTRICTION : undefined
                      }
                      deleteBlockedReason={
                        macro.id in remoteTriggerStatuses && !canManage
                          ? "This macro has a remote trigger URL, so only an owner or admin can delete it"
                          : undefined
                      }
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
        behaviorLocked={behaviorLocked}
        remoteTriggerSection={
          editingMacro && RemoteTriggerSection ? <RemoteTriggerSection macro={editingMacro} /> : null
        }
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

/** The macro pad with no remote trigger URLs, as any gateway serves it. */
export function MacroPadWidget() {
  return <MacroPad useRemoteTriggers={useNoRemoteTriggers} />;
}
