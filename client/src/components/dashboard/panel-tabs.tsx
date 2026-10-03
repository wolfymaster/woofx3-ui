import { useStore } from "@nanostores/react";
import { Check, LayoutGrid, Loader2, PanelTop, Pencil, Plus, Trash2, X } from "lucide-react";
import { memo, type ReactNode, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { DashboardPanel } from "@/lib/dashboard-panels";
import { $commandBarHidden } from "@/lib/stores";
import { cn } from "@/lib/utils";

interface PanelTabsProps {
  panels: DashboardPanel[];
  activeIndex: number;
  isEditing: boolean;
  onSelect: (index: number) => void;
  isSaving: boolean;
  onEnterEdit: () => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onRename: (panelId: string, name: string) => void;
  onAddPanel: () => void;
  onRemovePanel: (panel: { id: string; name: string }) => void;
}

function StripButton({
  label,
  onClick,
  disabled,
  className,
  testId,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
  testId: string;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn("h-5 w-5 text-muted-foreground hover:text-foreground", className)}
          onClick={onClick}
          disabled={disabled}
          aria-label={label}
          data-testid={testId}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * The panel tab strip, its inline rename, and the dashboard's edit controls.
 * It lives in the status bar, which is always there, so entering edit mode
 * adds no row above the panels and the canvas keeps its height. Rename state
 * lives here so each keystroke re-renders the strip only, not the dashboard
 * and its widgets.
 */
export const PanelTabs = memo(function PanelTabs({
  panels,
  activeIndex,
  isEditing,
  isSaving,
  onSelect,
  onEnterEdit,
  onSaveEdit,
  onCancelEdit,
  onRename,
  onAddPanel,
  onRemovePanel,
}: PanelTabsProps) {
  const commandBarHidden = useStore($commandBarHidden);
  const [renamingPanelId, setRenamingPanelId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);

  const startRenaming = (panelId: string, currentName: string) => {
    setRenamingPanelId(panelId);
    setRenameValue(currentName);
    setTimeout(() => {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }, 0);
  };

  const commitRename = (panelId: string) => {
    setRenamingPanelId(null);
    const trimmed = renameValue.trim();
    const panel = panels.find((p) => p.id === panelId);
    if (!trimmed || !panel || trimmed === panel.name) {
      return;
    }
    onRename(panelId, trimmed);
  };

  const activePanel = panels[activeIndex];

  return (
    <div className="flex items-center gap-1">
      <Tabs value={String(activeIndex)} onValueChange={(value) => onSelect(Number(value))}>
        <TabsList className="h-6 p-0.5 bg-transparent">
          {panels.map((panel, index) =>
            renamingPanelId === panel.id ? (
              <input
                key={panel.id}
                ref={renameInputRef}
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onBlur={() => commitRename(panel.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commitRename(panel.id);
                  } else if (e.key === "Escape") {
                    setRenamingPanelId(null);
                  }
                }}
                className="h-5 w-20 px-2 rounded-sm bg-background border border-primary text-[11px] outline-none"
                data-testid={`input-rename-panel-${panel.id}`}
              />
            ) : (
              <ContextMenu key={panel.id}>
                <ContextMenuTrigger asChild>
                  <TabsTrigger
                    value={String(index)}
                    className={cn(
                      "h-5 px-2 text-[11px]",
                      // ContextMenuTrigger's asChild also writes `data-state` (open/closed) onto
                      // this same element, clobbering the Tabs primitive's own active/inactive
                      // data-state — so drive the active style from React state instead.
                      index === activeIndex && "bg-muted text-foreground shadow-sm"
                    )}
                    onDoubleClick={isEditing ? () => startRenaming(panel.id, panel.name) : undefined}
                    data-testid={`tab-panel-${panel.id}`}
                  >
                    {panel.name}
                  </TabsTrigger>
                </ContextMenuTrigger>
                <ContextMenuContent>
                  {!isEditing && (
                    <>
                      <ContextMenuItem onClick={onEnterEdit} data-testid="button-toggle-edit">
                        <LayoutGrid className="h-3.5 w-3.5 mr-2" />
                        Edit
                      </ContextMenuItem>
                      <ContextMenuSeparator />
                    </>
                  )}
                  {commandBarHidden && (
                    <>
                      <ContextMenuItem
                        onClick={() => $commandBarHidden.set(false)}
                        data-testid="button-show-command-bar"
                      >
                        <PanelTop className="h-3.5 w-3.5 mr-2" />
                        Show Command Bar
                      </ContextMenuItem>
                      <ContextMenuSeparator />
                    </>
                  )}
                  <ContextMenuItem
                    onClick={() => startRenaming(panel.id, panel.name)}
                    data-testid={`button-rename-panel-${panel.id}`}
                  >
                    <Pencil className="h-3.5 w-3.5 mr-2" />
                    Rename
                  </ContextMenuItem>
                  <ContextMenuItem onClick={onAddPanel} data-testid="button-add-panel">
                    <Plus className="h-3.5 w-3.5 mr-2" />
                    Add Panel
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem
                    onClick={() => onRemovePanel({ id: panel.id, name: panel.name })}
                    disabled={panels.length <= 1}
                    className="text-destructive focus:text-destructive"
                    data-testid={`button-remove-panel-${panel.id}`}
                  >
                    <Trash2 className="h-3.5 w-3.5 mr-2" />
                    Delete
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            )
          )}
        </TabsList>
      </Tabs>
      {isEditing ? (
        <>
          <StripButton label="Add panel" onClick={onAddPanel} testId="button-strip-add-panel">
            <Plus className="h-3.5 w-3.5" />
          </StripButton>
          {activePanel && (
            <>
              <StripButton
                label={`Rename "${activePanel.name}"`}
                onClick={() => startRenaming(activePanel.id, activePanel.name)}
                testId="button-strip-rename-panel"
              >
                <Pencil className="h-3 w-3" />
              </StripButton>
              <StripButton
                label={panels.length <= 1 ? "The last panel can't be deleted" : `Delete "${activePanel.name}"`}
                onClick={() => onRemovePanel({ id: activePanel.id, name: activePanel.name })}
                disabled={panels.length <= 1}
                className="hover:text-destructive"
                testId="button-strip-delete-panel"
              >
                <Trash2 className="h-3 w-3" />
              </StripButton>
            </>
          )}
          {commandBarHidden && (
            <StripButton
              label="Show command bar"
              onClick={() => $commandBarHidden.set(false)}
              testId="button-strip-show-command-bar"
            >
              <PanelTop className="h-3 w-3" />
            </StripButton>
          )}
          <div className="mx-1 h-3.5 w-px bg-border" />
          <Button
            variant="ghost"
            size="sm"
            className="h-5 gap-1 px-2 text-[11px]"
            onClick={onCancelEdit}
            disabled={isSaving}
            data-testid="button-cancel-edit"
          >
            <X className="h-3 w-3" />
            Cancel
          </Button>
          <Button
            size="sm"
            className="h-5 gap-1 px-2 text-[11px]"
            onClick={onSaveEdit}
            disabled={isSaving}
            data-testid="button-save-edit"
          >
            {isSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
            Save
          </Button>
        </>
      ) : (
        <StripButton label="Edit dashboard" onClick={onEnterEdit} testId="button-edit-dashboard">
          <LayoutGrid className="h-3.5 w-3.5" />
        </StripButton>
      )}
    </div>
  );
});
