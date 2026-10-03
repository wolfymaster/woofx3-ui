import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { platformSettingsItemId } from "@convex/lib/gettingStarted";
import { useMutation, useQuery } from "convex/react";
import { Circle, CircleCheck, CircleX, Copy, Loader2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useFireTestEvent } from "@/hooks/use-fire-test-event";
import { useObsStatus } from "@/hooks/use-obs-status";
import { useToast } from "@/hooks/use-toast";
import { useWorkflowCatalog } from "@/hooks/use-workflow-catalog";
import { browserSourceUrlForKey } from "@/lib/browser-source-url";
import {
  type GettingStartedAction,
  type GettingStartedItem,
  type GettingStartedStatus,
  gettingStartedItems,
  gettingStartedProgress,
} from "@/lib/getting-started";
import type { CheckFix } from "@/lib/go-live-checks";
import { OBS_MODULE_ID } from "@/lib/obs-status";
import { initialValues, payloadFromValues, testEventFields } from "@/lib/test-event-fields";
import { cn } from "@/lib/utils";

const FOLLOW_EVENT = "channel.follow";

function StatusIcon({ status }: { status: GettingStartedStatus }) {
  if (status === "done") {
    return <CircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-green-500" aria-label="Done" />;
  }
  if (status === "problem") {
    return <CircleX className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-label="Needs attention" />;
  }
  return <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-label="To do" />;
}

function FixLink({ fix }: { fix: CheckFix }) {
  const { toast } = useToast();
  const className = "h-7 gap-1.5 px-2 text-xs";
  if (fix.kind === "route") {
    return (
      <Button asChild variant="outline" size="sm" className={className}>
        <Link href={fix.href}>{fix.label}</Link>
      </Button>
    );
  }
  if (fix.kind === "copy") {
    return (
      <Button
        variant="outline"
        size="sm"
        className={className}
        onClick={() => {
          navigator.clipboard.writeText(fix.text).then(
            () => toast({ title: "Copied", description: "Paste it into an OBS browser source." }),
            () => toast({ title: "Couldn't copy", variant: "destructive" })
          );
        }}
      >
        <Copy className="h-3 w-3" />
        {fix.label}
      </Button>
    );
  }
  return null;
}

export interface GettingStarted {
  items: GettingStartedItem[];
  progress: { done: number; total: number };
  /** True when an item needs attention (a failed install, say), not merely to be done. */
  hasProblem: boolean;
  busyAction: GettingStartedAction["kind"] | null;
  runAction: (action: GettingStartedAction) => Promise<void>;
  /** Why an action can't run yet, or null when it can. */
  actionUnavailable: (action: GettingStartedAction) => string | null;
  dismiss: () => void;
}

/**
 * The first-session checklist: finish setup, get the platforms installed and
 * the overlay into OBS, and see woofx3 react to a test follow. Null while
 * loading, once every item is done, or once someone dismissed it; both are
 * per instance, so the whole team sees the same list.
 *
 * Called once by the dashboard and handed to both the rail icon and its
 * flyout, so the OBS status poll behind it runs once.
 */
export function useGettingStarted(instanceId: Id<"instances">): GettingStarted | null {
  const setup = useQuery(api.setup.status, { instanceId });
  const overlays = useQuery(api.goLive.overlays, { instanceId });
  const state = useQuery(api.gettingStarted.state, { instanceId });
  const markDone = useMutation(api.gettingStarted.markDone);
  const dismissMutation = useMutation(api.gettingStarted.dismiss);
  const retryApply = useMutation(api.setup.retryApply);
  const { triggerPresets } = useWorkflowCatalog();
  const fireTestEvent = useFireTestEvent();
  const { toast } = useToast();
  const [busyAction, setBusyAction] = useState<GettingStartedAction["kind"] | null>(null);

  const watchesObs = Boolean(state && !state.dismissed && setup?.platformsNeedingSettings.includes(OBS_MODULE_ID));
  const { status: obsStatus } = useObsStatus(instanceId, watchesObs);

  const followPreset = useMemo(() => triggerPresets.find((preset) => preset.event === FOLLOW_EVENT), [triggerPresets]);

  if (!setup || !overlays || !state || state.dismissed) {
    return null;
  }

  const items = gettingStartedItems({
    setup,
    overlays,
    browserSourceUrl: overlays.featuredKey ? browserSourceUrlForKey(overlays.featuredKey) : null,
    doneItemIds: state.doneItemIds,
    obsStatus,
  });
  const progress = gettingStartedProgress(items);
  if (progress.done === progress.total) {
    return null;
  }

  async function runAction(action: GettingStartedAction) {
    setBusyAction(action.kind);
    try {
      if (action.kind === "retry-installs") {
        await retryApply({ instanceId });
      } else if (action.kind === "mark-command-done") {
        await markDone({ instanceId, itemId: "chat-command" });
      } else if (action.kind === "mark-platform-settings-done") {
        await markDone({ instanceId, itemId: platformSettingsItemId(action.marketplaceModuleId) });
      } else {
        if (!followPreset) {
          return;
        }
        const fields = testEventFields(followPreset);
        const key = await fireTestEvent(followPreset, payloadFromValues(fields, initialValues(fields)));
        if (key !== null) {
          await markDone({ instanceId, itemId: "test-follow" });
          toast({ title: "Test follow sent", description: "Watch your chat and overlay for woofx3's reaction." });
        }
      }
    } catch (err) {
      toast({
        title: "That didn't work",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setBusyAction(null);
    }
  }

  function actionUnavailable(action: GettingStartedAction): string | null {
    if (action.kind !== "fire-test-follow") {
      return null;
    }
    if (!setup?.engineRegistered) {
      return "Available once your engine is ready";
    }
    return followPreset ? null : "Available once the Twitch module is installed";
  }

  return {
    items,
    progress,
    hasProblem: items.some((entry) => entry.status === "problem"),
    busyAction,
    runAction,
    actionUnavailable,
    dismiss: () => void dismissMutation({ instanceId }),
  };
}

/** The checklist as one column, sized for the rail's flyout. */
export function GettingStartedChecklist({ gettingStarted }: { gettingStarted: GettingStarted }) {
  const { items, progress, busyAction, runAction, actionUnavailable, dismiss } = gettingStarted;

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 space-y-1.5 border-b border-border px-3 py-2.5">
        <p className="text-xs text-muted-foreground">
          {progress.done} of {progress.total} done
        </p>
        <Progress value={(progress.done / progress.total) * 100} className="h-1.5" />
      </div>
      <ul className="flex-1 min-h-0 space-y-2 overflow-y-auto p-3" data-testid="list-getting-started">
        {items.map((entry: GettingStartedItem) => (
          <li
            key={entry.id}
            className={cn(
              "flex items-start gap-2.5 rounded-md border bg-card p-2.5",
              entry.status === "done" && "opacity-70"
            )}
            data-testid={`getting-started-${entry.id}`}
          >
            <StatusIcon status={entry.status} />
            <div className="min-w-0 flex-1 space-y-1">
              <p className={cn("text-sm font-medium", entry.status === "done" && "line-through")}>{entry.title}</p>
              <p className="text-xs text-muted-foreground">{entry.summary}</p>
              {entry.status !== "done" && (entry.fixes.length > 0 || entry.actions.length > 0) && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {entry.fixes.map((fix) => (
                    <FixLink key={`${fix.kind}-${fix.label}`} fix={fix} />
                  ))}
                  {entry.actions.map((action) => {
                    const unavailable = actionUnavailable(action);
                    return (
                      <Button
                        key={action.kind}
                        size="sm"
                        className="h-7 gap-1.5 px-2 text-xs"
                        disabled={busyAction !== null || unavailable !== null}
                        onClick={() => void runAction(action)}
                        data-testid={`button-getting-started-${action.kind}`}
                      >
                        {busyAction === action.kind && <Loader2 className="h-3 w-3 animate-spin" />}
                        {action.label}
                      </Button>
                    );
                  })}
                </div>
              )}
              {entry.actions.map((action) => {
                const unavailable = entry.status === "done" ? null : actionUnavailable(action);
                return unavailable ? (
                  <p key={action.kind} className="text-[11px] text-muted-foreground">
                    {unavailable}
                  </p>
                ) : null;
              })}
            </div>
          </li>
        ))}
      </ul>
      <div className="shrink-0 border-t border-border px-3 py-2">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-full text-xs text-muted-foreground"
          onClick={dismiss}
          data-testid="button-dismiss-getting-started"
        >
          Dismiss for everyone on this account
        </Button>
      </div>
    </div>
  );
}
