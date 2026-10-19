import { ChevronDown, Loader2, Undo2, Upload } from "lucide-react";
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
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { DraftSaveStatus } from "@/lib/draft-save-status";
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
  /** The switch that turns live updating on or off. */
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
  saveStatus: DraftSaveStatus;
  copy: DraftLiveCopy;
  testIds: DraftLiveTestIds;
}

/**
 * A sync editor's live updating switch, save status and Publish button. The switch sits
 * in the header, not a menu, because it decides where every edit goes. The status says
 * whether edits have been saved and, while not live updating, that saved edits wait in a
 * draft until published. Publish carries a menu with the rarer command, discarding the
 * draft, and has a fixed width, so starting a command never moves anything in the header.
 * A draft cannot be brought back once discarded, so Discard asks first.
 */
export function DraftLiveControls({
  live,
  onLiveChange,
  commandsEnabled,
  pendingCommand,
  onCommand,
  hasDraft,
  saveStatus,
  copy,
  testIds,
}: DraftLiveControlsProps) {
  const disabled = live || !commandsEnabled;
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  return (
    <>
      <div className="flex items-center gap-3">
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex items-center gap-2">
              <Switch id={testIds.live} checked={live} onCheckedChange={onLiveChange} data-testid={testIds.live} />
              <Label htmlFor={testIds.live} className="cursor-pointer whitespace-nowrap text-xs font-normal">
                Live Update
              </Label>
            </div>
          </TooltipTrigger>
          <TooltipContent>{live ? copy.live : copy.draft}</TooltipContent>
        </Tooltip>
        <SaveStatusIndicator status={saveStatus} live={live} copy={copy} />
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

const SAVE_STATUS_TONE: Record<DraftSaveStatus, StatusTone> = {
  sending: "waiting",
  retrying: "attention",
  draft: "waiting",
  saved: "ok",
};

function SaveStatusIndicator({ status, live, copy }: { status: DraftSaveStatus; live: boolean; copy: DraftLiveCopy }) {
  const [label, tooltip] = {
    sending: [live ? "Saving…" : "Saving draft…", "Your latest edits are still being sent"],
    retrying: ["Retrying save…", "A save didn't go through and is being sent again"],
    draft: ["Draft saved, not published", copy.publish],
    saved: ["All changes saved", undefined],
  }[status];
  return (
    <StatusIndicator tone={SAVE_STATUS_TONE[status]} tooltip={tooltip} testId="status-saved">
      {label}
    </StatusIndicator>
  );
}

/** `ok`: nothing to do. `waiting`: fine, but not finished. `attention`: something needs looking at. */
export type StatusTone = "ok" | "waiting" | "attention";

const TONE_DOT: Record<StatusTone, string> = {
  ok: "bg-green-500",
  waiting: "bg-amber-500",
  attention: "bg-red-500",
};

/** A label with a dot colored by its tone. */
export function StatusIndicator({
  tone,
  tooltip,
  testId,
  children,
}: {
  tone: StatusTone;
  tooltip?: string;
  testId?: string;
  children: ReactNode;
}) {
  const label = (
    <span
      className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground"
      data-state={tone}
      data-testid={testId}
    >
      <span className={cn("h-2 w-2 shrink-0 rounded-full", TONE_DOT[tone])} aria-hidden="true" />
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
