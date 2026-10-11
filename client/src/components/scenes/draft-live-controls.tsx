import { Loader2, Undo2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export type DraftCommand = "publish" | "discard";

/** The tooltips, which name what the document is and where publishing it shows. */
export interface DraftLiveCopy {
  draft: string;
  live: string;
  /** Why Discard and Publish are off in live mode. */
  liveDisabled: string;
  publish: string;
}

export interface DraftLiveTestIds {
  mode: string;
  draft: string;
  live: string;
  discard: string;
  publish: string;
}

interface DraftLiveControlsProps {
  live: boolean;
  onLiveChange: (live: boolean) => void;
  /** Whether a Publish or Discard can be sent now. */
  commandsEnabled: boolean;
  pendingCommand: DraftCommand | null;
  onCommand: (command: DraftCommand) => void;
  hasDraft: boolean;
  copy: DraftLiveCopy;
  testIds: DraftLiveTestIds;
}

/**
 * A sync editor's Draft / Live toggle with its Discard and Publish buttons. Every control
 * is always rendered and Publish has a fixed width, so switching modes or starting a
 * command never moves anything in the header.
 */
export function DraftLiveControls({
  live,
  onLiveChange,
  commandsEnabled,
  pendingCommand,
  onCommand,
  hasDraft,
  copy,
  testIds,
}: DraftLiveControlsProps) {
  const disabled = live || !commandsEnabled;
  return (
    <>
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        value={live ? "live" : "draft"}
        onValueChange={(value) => {
          // Radix lets a single toggle group be emptied by clicking the selected item; one mode always holds.
          if (value) {
            onLiveChange(value === "live");
          }
        }}
        aria-label="Editing mode"
        data-testid={testIds.mode}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <ToggleGroupItem value="draft" data-testid={testIds.draft}>
              Draft
            </ToggleGroupItem>
          </TooltipTrigger>
          <TooltipContent>{copy.draft}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <ToggleGroupItem
              value="live"
              className="data-[state=on]:bg-red-600 data-[state=on]:text-white data-[state=on]:border-red-600"
              data-testid={testIds.live}
            >
              Live
            </ToggleGroupItem>
          </TooltipTrigger>
          <TooltipContent>{copy.live}</TooltipContent>
        </Tooltip>
      </ToggleGroup>
      {/* The spans carry the tooltips, which a disabled button cannot. */}
      <Tooltip>
        <TooltipTrigger asChild>
          <span tabIndex={disabled ? 0 : undefined} className="inline-flex">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onCommand("discard")}
              disabled={disabled}
              aria-label="Discard draft"
              data-testid={testIds.discard}
            >
              {pendingCommand === "discard" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Undo2 className="h-4 w-4" />
              )}
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent>{live ? copy.liveDisabled : "Discard draft"}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <span tabIndex={disabled ? 0 : undefined} className="inline-flex">
            <Button
              onClick={() => onCommand("publish")}
              disabled={disabled}
              className="w-32"
              data-testid={testIds.publish}
            >
              {pendingCommand === "publish" ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Upload className="h-4 w-4 mr-2" />
              )}
              {pendingCommand === "publish" ? "Publishing…" : "Publish"}
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent>{live ? copy.liveDisabled : hasDraft ? copy.publish : "Nothing to publish"}</TooltipContent>
      </Tooltip>
    </>
  );
}
