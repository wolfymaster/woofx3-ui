import type { GoLiveCompletion, GoLiveStepOutcome } from "@convex/lib/goLiveFacts";
import type { StreamInfoField } from "@convex/lib/streamInfo";
import {
  AlertTriangle,
  Bookmark,
  CheckCircle2,
  ChevronRight,
  Copy,
  ExternalLink,
  EyeOff,
  Loader2,
  RotateCw,
  Undo2,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { errorMessage, useGoLiveChecklist } from "@/hooks/use-go-live-checklist";
import { useToast } from "@/hooks/use-toast";
import type { CheckFix, ChecklistOverall, CheckResult, CheckStatus } from "@/lib/go-live-checks";
import { cn } from "@/lib/utils";

const DEFAULT_ANNOUNCEMENT = "Going live!";
const MAX_ANNOUNCEMENT_LENGTH = 500;

const OVERALL_TEXT: Record<ChecklistOverall, string> = {
  running: "Checking your setup...",
  pass: "Everything looks ready",
  warn: "Ready, with a few things worth a look",
  fail: "Something will break on stream",
};

function StatusIcon({ status, className }: { status: CheckStatus; className?: string }) {
  switch (status) {
    case "running": {
      return <Loader2 className={cn("animate-spin text-muted-foreground", className)} aria-label="Checking" />;
    }
    case "pass": {
      return <CheckCircle2 className={cn("text-green-500", className)} aria-label="Passed" />;
    }
    case "warn": {
      return <AlertTriangle className={cn("text-amber-500", className)} aria-label="Warning" />;
    }
    case "fail": {
      return <XCircle className={cn("text-destructive", className)} aria-label="Failed" />;
    }
  }
}

function ApplyPresetButton({
  fix,
  onApplyPreset,
}: {
  fix: Extract<CheckFix, { kind: "apply-preset" }>;
  onApplyPreset: (presetId: string) => Promise<StreamInfoField[]>;
}) {
  const { toast } = useToast();
  const [applying, setApplying] = useState(false);

  const apply = async (presetId: string, name: string) => {
    setApplying(true);
    try {
      const unapplied = await onApplyPreset(presetId);
      if (unapplied.length > 0) {
        toast({
          title: "Twitch didn't apply everything",
          description: `It kept its own ${unapplied.join(" and ")}.`,
          variant: "destructive",
        });
      } else {
        toast({ title: `Applied "${name}"` });
      }
    } catch (error) {
      toast({ title: "Couldn't apply the preset", description: errorMessage(error), variant: "destructive" });
    } finally {
      setApplying(false);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1.5 px-2 text-xs"
          disabled={applying}
          data-testid="button-go-live-apply-preset"
        >
          {applying ? <Loader2 className="h-3 w-3 animate-spin" /> : <Bookmark className="h-3 w-3" />}
          {fix.label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {fix.presets.map((preset) => (
          <DropdownMenuItem
            key={preset.id}
            onSelect={() => void apply(preset.id, preset.name)}
            data-testid={`menuitem-go-live-preset-${preset.id}`}
          >
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-xs font-medium">{preset.name}</span>
              <span className="truncate text-[10px] text-muted-foreground">{preset.summary}</span>
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function FixButton({
  fix,
  onRetry,
  onApplyPreset,
}: {
  fix: CheckFix;
  onRetry: () => void;
  onApplyPreset: (presetId: string) => Promise<StreamInfoField[]>;
}) {
  const { toast } = useToast();
  const className = "h-7 gap-1.5 px-2 text-xs";

  switch (fix.kind) {
    case "route": {
      return (
        <Button asChild variant="outline" size="sm" className={className}>
          <Link href={fix.href}>{fix.label}</Link>
        </Button>
      );
    }
    case "external": {
      return (
        <Button asChild variant="outline" size="sm" className={className}>
          <a href={fix.href} target="_blank" rel="noreferrer">
            {fix.label}
            <ExternalLink className="h-3 w-3" />
          </a>
        </Button>
      );
    }
    case "copy": {
      return (
        <Button
          variant="outline"
          size="sm"
          className={className}
          onClick={() => {
            navigator.clipboard.writeText(fix.text).then(
              () => toast({ title: "Copied", description: "Paste it into an OBS browser source." }),
              (error: unknown) =>
                toast({ title: "Couldn't copy", description: errorMessage(error), variant: "destructive" })
            );
          }}
        >
          <Copy className="h-3 w-3" />
          {fix.label}
        </Button>
      );
    }
    case "retry": {
      return (
        <Button variant="outline" size="sm" className={className} onClick={onRetry}>
          <RotateCw className="h-3 w-3" />
          {fix.label}
        </Button>
      );
    }
    case "apply-preset": {
      return <ApplyPresetButton fix={fix} onApplyPreset={onApplyPreset} />;
    }
  }
}

function CheckRow({
  check,
  compact,
  onRetry,
  onDismiss,
  onApplyPreset,
}: {
  check: CheckResult;
  compact: boolean;
  onRetry: () => void;
  onDismiss: () => void;
  onApplyPreset: (presetId: string) => Promise<StreamInfoField[]>;
}) {
  return (
    <li
      className="flex items-start gap-2.5 rounded-md border border-border p-2.5"
      data-testid={`go-live-check-${check.id}`}
    >
      <StatusIcon status={check.status} className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-sm font-medium">{check.title}</p>
        <p className={cn("break-words text-muted-foreground", compact ? "text-xs" : "text-sm")}>{check.summary}</p>
        {check.details.length > 0 && (
          <ul className="space-y-0.5 text-xs text-muted-foreground">
            {check.details.map((detail) => (
              <li key={detail} className="break-words">
                {detail}
              </li>
            ))}
          </ul>
        )}
        {check.fixes.length > 0 && check.status !== "pass" && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {check.fixes.map((fix) => (
              <FixButton key={`${fix.kind}-${fix.label}`} fix={fix} onRetry={onRetry} onApplyPreset={onApplyPreset} />
            ))}
          </div>
        )}
      </div>
      {check.status !== "running" && check.status !== "pass" && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 shrink-0 text-muted-foreground"
              onClick={onDismiss}
              aria-label={`Dismiss the ${check.title} check`}
              data-testid={`button-dismiss-${check.id}`}
            >
              <EyeOff className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Dismiss: stop checking this</TooltipContent>
        </Tooltip>
      )}
    </li>
  );
}

function describeStep(outcome: GoLiveStepOutcome, done: string): string | null {
  switch (outcome.status) {
    case "done": {
      return done;
    }
    case "queued": {
      return outcome.reason;
    }
    case "skipped": {
      return null;
    }
    case "failed": {
      return outcome.message;
    }
  }
}

/**
 * The Go live pre-flight: every check runs at once on mount, each row fills
 * in as its answer lands, and a dismissed check stays out of the verdict for
 * everyone on the instance until restored.
 */
export function GoLiveChecklist({ variant }: { variant: "page" | "widget" }) {
  const compact = variant === "widget";
  const { toast } = useToast();
  const { summary, isLive, markerPending, runAll, rerun, setDismissed, complete, applyPreset } = useGoLiveChecklist();

  const [announce, setAnnounce] = useState(true);
  const [announcement, setAnnouncement] = useState(DEFAULT_ANNOUNCEMENT);
  const [dropMarker, setDropMarker] = useState(true);
  const [finishing, setFinishing] = useState(false);
  const [dismissedOpen, setDismissedOpen] = useState(false);

  if (!summary) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const changeDismissed = (check: CheckResult, dismissed: boolean) => {
    setDismissed(check.id, dismissed).catch((error: unknown) =>
      toast({
        title: dismissed ? "Couldn't dismiss that check" : "Couldn't restore that check",
        description: errorMessage(error),
        variant: "destructive",
      })
    );
  };

  const report = (result: GoLiveCompletion) => {
    const announced = describeStep(result.announcement, "Announcement posted in chat.");
    const marked = describeStep(result.marker, "Stream marker dropped.");
    const failed = result.announcement.status === "failed" || result.marker.status === "failed";
    const lines = [announced, marked].filter((line): line is string => line !== null);
    toast({
      title: failed ? "Checklist done, with a problem" : "Checklist done. Have a great stream!",
      description: lines.length > 0 ? lines.join(" ") : undefined,
      variant: failed ? "destructive" : undefined,
    });
  };

  const handleFinish = async () => {
    setFinishing(true);
    try {
      const result = await complete({
        announcement: announce ? announcement : undefined,
        dropMarker,
      });
      report(result);
    } catch (error) {
      toast({ title: "Couldn't finish the checklist", description: errorMessage(error), variant: "destructive" });
    } finally {
      setFinishing(false);
    }
  };

  const running = summary.overall === "running";
  const announcementInvalid = announce && !announcement.trim();

  return (
    <div className="flex h-full flex-col">
      <div className={cn("flex-1 space-y-3 overflow-auto", compact ? "p-3" : "p-0")}>
        <div className="flex items-center gap-2" data-testid="go-live-overall">
          <StatusIcon status={summary.overall} className={compact ? "h-4 w-4" : "h-5 w-5"} />
          <span className={cn("flex-1 font-medium", compact ? "text-sm" : "text-base")}>
            {OVERALL_TEXT[summary.overall]}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 px-2 text-xs"
            onClick={runAll}
            disabled={running}
            data-testid="button-go-live-rerun"
          >
            <RotateCw className={cn("h-3.5 w-3.5", running && "animate-spin")} />
            Run again
          </Button>
        </div>

        <ul className="space-y-2">
          {summary.active.map((check) => (
            <CheckRow
              key={check.id}
              check={check}
              compact={compact}
              onRetry={() => rerun(check.id)}
              onDismiss={() => changeDismissed(check, true)}
              onApplyPreset={applyPreset}
            />
          ))}
        </ul>

        {summary.dismissed.length > 0 && (
          <Collapsible open={dismissedOpen} onOpenChange={setDismissedOpen}>
            <CollapsibleTrigger className="flex w-full items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground">
              <ChevronRight className={cn("h-3 w-3 transition-transform", dismissedOpen && "rotate-90")} />
              Dismissed · {summary.dismissed.length}
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-1.5">
              <ul className="space-y-1">
                {summary.dismissed.map((check) => (
                  <li
                    key={check.id}
                    className="flex items-center gap-2 rounded-md px-2 py-1 text-xs text-muted-foreground"
                  >
                    <StatusIcon status={check.status} className="h-3.5 w-3.5 shrink-0" />
                    <span className="flex-1">{check.title}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 gap-1 px-1.5 text-xs"
                      onClick={() => changeDismissed(check, false)}
                      data-testid={`button-restore-${check.id}`}
                    >
                      <Undo2 className="h-3 w-3" />
                      Restore
                    </Button>
                  </li>
                ))}
              </ul>
            </CollapsibleContent>
          </Collapsible>
        )}

        <section className="space-y-2.5 rounded-md border border-border p-3" aria-label="Finish the checklist">
          <div className="flex items-center gap-2">
            <Checkbox
              id={`go-live-announce-${variant}`}
              checked={announce}
              onCheckedChange={(checked) => setAnnounce(checked === true)}
            />
            <Label htmlFor={`go-live-announce-${variant}`} className="text-xs font-normal">
              Post in chat
            </Label>
          </div>
          {announce && (
            <Input
              value={announcement}
              onChange={(event) => setAnnouncement(event.target.value.slice(0, MAX_ANNOUNCEMENT_LENGTH))}
              className="h-8 text-sm"
              aria-label="Chat announcement"
              data-testid="input-go-live-announcement"
            />
          )}
          <div className="flex items-center gap-2">
            <Checkbox
              id={`go-live-marker-${variant}`}
              checked={dropMarker}
              onCheckedChange={(checked) => setDropMarker(checked === true)}
            />
            <Label htmlFor={`go-live-marker-${variant}`} className="text-xs font-normal">
              {isLive ? 'Drop a "Stream start" marker now' : 'Drop a "Stream start" marker when I go live'}
            </Label>
          </div>
          {markerPending && !isLive && (
            <p className="text-xs text-muted-foreground" data-testid="text-go-live-marker-pending">
              A "Stream start" marker is waiting for your stream to go live (requests expire after two hours).
            </p>
          )}
          <Button
            className="w-full gap-1.5"
            size={compact ? "sm" : "default"}
            onClick={() => void handleFinish()}
            disabled={finishing || announcementInvalid}
            data-testid="button-go-live-done"
          >
            {finishing && <Loader2 className="h-4 w-4 animate-spin" />}
            Go live checklist done
          </Button>
          {summary.counts.fail > 0 && !running && (
            <p className="text-xs text-destructive">
              {summary.counts.fail === 1 ? "One check is failing." : `${summary.counts.fail} checks are failing.`} You
              can still finish, but viewers will likely notice.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
