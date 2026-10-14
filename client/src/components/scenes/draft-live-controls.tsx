import { ChevronDown, Loader2, Radio, Undo2, Upload } from "lucide-react";
import { type ReactNode, useState } from "react";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export type DraftCommand = "publish" | "discard";

/** The tooltips, which name what the document is and where publishing it shows. */
export interface DraftLiveCopy {
  /** What live updating off means: edits wait in a draft. */
  draft: string;
  /** What live updating on means: edits reach their audience as they are made. */
  live: string;
  /** Why Discard and Publish are off while live updating. */
  liveDisabled: string;
  publish: string;
  /** The question Discard asks before throwing the draft away. */
  discardTitle: string;
  discardDescription: string;
}

export interface DraftLiveTestIds {
  /** The menu item that turns live updating on or off. */
  live: string;
  discard: string;
  /** The confirmation's Discard button. */
  confirmDiscard: string;
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
  /** Edits not yet where the current mode puts them: still sending, or waiting in a draft. */
  unsaved: boolean;
  copy: DraftLiveCopy;
  testIds: DraftLiveTestIds;
}

/**
 * A sync editor's status and Publish button. The status says whether edits go live as
 * they are made and whether any are still unsaved; Publish carries a menu with the rarer
 * commands, turning live updating on or off and discarding the draft. Publish has a fixed
 * width, so starting a command never moves anything in the header. A draft cannot be
 * brought back once discarded, so Discard asks first.
 */
export function DraftLiveControls({
  live,
  onLiveChange,
  commandsEnabled,
  pendingCommand,
  onCommand,
  hasDraft,
  unsaved,
  copy,
  testIds,
}: DraftLiveControlsProps) {
  const disabled = live || !commandsEnabled;
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  return (
    <>
      <div className="flex items-center gap-3">
        <StatusIndicator ok={live} tooltip={live ? copy.live : copy.draft} testId="status-live-updating">
          Live Updating: {live ? "ON" : "OFF"}
        </StatusIndicator>
        <StatusIndicator
          ok={!unsaved}
          tooltip={unsaved ? (live ? "Your latest edits are still being sent" : copy.publish) : undefined}
          testId="status-saved"
        >
          {unsaved ? "Unsaved changes" : "All changes saved"}
        </StatusIndicator>
      </div>
      <div className="flex items-center">
        {/* The span carries the tooltip, which a disabled button cannot. */}
        <Tooltip>
          <TooltipTrigger asChild>
            <span tabIndex={disabled ? 0 : undefined} className="inline-flex">
              <Button
                onClick={() => onCommand("publish")}
                disabled={disabled}
                className="w-32 rounded-r-none"
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
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="icon"
              className="rounded-l-none border-l border-primary-foreground/25"
              aria-label="More publish options"
              data-testid={`${testIds.publish}-menu`}
            >
              <ChevronDown className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem onClick={() => onLiveChange(!live)} data-testid={testIds.live}>
              <Radio className="h-4 w-4 mr-2" />
              {live ? "Disable Live Update" : "Enable Live Update"}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => setConfirmingDiscard(true)}
              disabled={disabled}
              data-testid={testIds.discard}
            >
              {pendingCommand === "discard" ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Undo2 className="h-4 w-4 mr-2" />
              )}
              Discard draft
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <AlertDialog open={confirmingDiscard} onOpenChange={setConfirmingDiscard}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{copy.discardTitle}</AlertDialogTitle>
            <AlertDialogDescription>{copy.discardDescription}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction onClick={() => onCommand("discard")} data-testid={testIds.confirmDiscard}>
              Discard draft
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** A label with a green dot when `ok`, red otherwise. */
export function StatusIndicator({
  ok,
  tooltip,
  testId,
  children,
}: {
  ok: boolean;
  tooltip?: string;
  testId?: string;
  children: ReactNode;
}) {
  const label = (
    <span
      className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground"
      data-state={ok ? "ok" : "attention"}
      data-testid={testId}
    >
      <span className={cn("h-2 w-2 shrink-0 rounded-full", ok ? "bg-green-500" : "bg-red-500")} aria-hidden="true" />
      {children}
    </span>
  );
  if (tooltip === undefined) {
    return label;
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>{label}</TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
}
