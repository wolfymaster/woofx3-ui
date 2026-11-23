import { Loader2, Undo2, Upload } from "lucide-react";
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
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DRAFT_COPY } from "@/lib/copy";
import type { DraftSaveStatus } from "@/lib/draft-save-status";
import { cn } from "@/lib/utils";

/**
 * A tooltip trigger wrapped around a toggle item overwrites the item's own `data-state`, so the
 * selected look keys off `aria-checked`, which only the item sets.
 */
const MODE_ITEM = "aria-checked:bg-primary aria-checked:text-primary-foreground aria-checked:hover:bg-primary/90";

export type DraftCommand = "publish" | "discard";

/** The tooltips, which name what the document is and where publishing it shows. */
export interface DraftLiveCopy {
  /** What live updating off means: edits wait in a draft. */
  draft: string;
  /** What live updating on means: edits reach their audience as they are made. */
  live: string;
  publish: string;
  /** The Publish button's label. */
  publishLabel: string;
  /** Status while edits wait in a draft. */
  draftStatus: string;
  /** Status while there is no draft and nothing waits to be published. */
  matchesStatus: string;
  /** Status while live updating. */
  liveStatus: string;
  /** The question Discard asks before throwing the draft away. */
  discardTitle: string;
  discardDescription: string;
}

export interface DraftLiveTestIds {
  /** The Draft/Live selector; its two options add "-draft" and "-live". */
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
 * A sync editor's Draft/Live selector, save status, and Discard and Publish buttons. The
 * selector sits in the header because it decides where every edit goes. The status says
 * whether edits have been saved and, in Draft, that saved edits wait until published.
 * Discard and Publish sit in plain sight in Draft, where they apply, and are hidden in
 * Live, where every edit is already published. A draft cannot be brought back once
 * discarded, so Discard asks first.
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
  const canAct = !live && commandsEnabled && pendingCommand === null && hasDraft;
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  return (
    <>
      <div className="flex items-center gap-3">
        <ToggleGroup
          type="single"
          value={live ? "live" : "draft"}
          onValueChange={(mode) => {
            if (mode !== "") {
              onLiveChange(mode === "live");
            }
          }}
          variant="outline"
          size="sm"
          className="gap-0"
          aria-label="Where your edits go"
          data-testid={testIds.live}
        >
          <Tooltip>
            <TooltipTrigger asChild>
              <ToggleGroupItem
                value="draft"
                className={cn(MODE_ITEM, "rounded-r-none")}
                data-testid={`${testIds.live}-draft`}
              >
                Draft
              </ToggleGroupItem>
            </TooltipTrigger>
            <TooltipContent>{copy.draft}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <ToggleGroupItem
                value="live"
                className={cn(MODE_ITEM, "rounded-l-none border-l-0")}
                data-testid={`${testIds.live}-live`}
              >
                Live
              </ToggleGroupItem>
            </TooltipTrigger>
            <TooltipContent>{copy.live}</TooltipContent>
          </Tooltip>
        </ToggleGroup>
        <SaveStatusIndicator status={saveStatus} live={live} copy={copy} />
      </div>
      {!live && (
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => setConfirmingDiscard(true)}
            disabled={!canAct}
            data-testid={testIds.discard}
          >
            {pendingCommand === "discard" ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Undo2 className="h-4 w-4 mr-2" />
            )}
            {DRAFT_COPY.discard}
          </Button>
          <Button
            onClick={() => onCommand("publish")}
            disabled={!canAct}
            className="min-w-40"
            data-testid={testIds.publish}
          >
            {pendingCommand === "publish" ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Upload className="h-4 w-4 mr-2" />
            )}
            {pendingCommand === "publish" ? "Publishing…" : copy.publishLabel}
          </Button>
        </div>
      )}
      <AlertDialog open={confirmingDiscard} onOpenChange={setConfirmingDiscard}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{copy.discardTitle}</AlertDialogTitle>
            <AlertDialogDescription>{copy.discardDescription}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction onClick={() => onCommand("discard")} data-testid={testIds.confirmDiscard}>
              {DRAFT_COPY.discard}
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
    sending: [live ? "Saving…" : "Saving draft…", "Saving your changes"],
    retrying: ["Retrying save…", "Save failed, trying again"],
    draft: [copy.draftStatus, copy.publish],
    saved: live ? [copy.liveStatus, copy.live] : [copy.matchesStatus, DRAFT_COPY.privateUntilPublished],
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
