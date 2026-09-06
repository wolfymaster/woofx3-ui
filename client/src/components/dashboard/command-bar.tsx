import { api } from "@convex/_generated/api";
import type { Doc, Id } from "@convex/_generated/dataModel";
import { useAction, useMutation, useQuery } from "convex/react";
import { Clapperboard, Loader2, Maximize2, Pencil, Plus, Radio, X } from "lucide-react";
import { useEffect, useState } from "react";
import { StreamPlayerDialog } from "@/components/dashboard/stream-player-dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useInstance } from "@/hooks/use-instance";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

// Same public preview CDN and refresh cadence the stream-preview widget uses —
// Twitch only regenerates the underlying image every few minutes.
const THUMBNAIL_REFRESH_MS = 60_000;

type StreamGoal = Doc<"streamGoals">;

function StreamPreviewThumbnail({ isLive, login, title }: { isLive: boolean; login: string | null; title?: string }) {
  const [enlarged, setEnlarged] = useState(false);
  const [thumbnailTick, setThumbnailTick] = useState(0);

  useEffect(() => {
    if (!isLive) {
      return;
    }
    const interval = setInterval(() => setThumbnailTick((tick) => tick + 1), THUMBNAIL_REFRESH_MS);
    return () => clearInterval(interval);
  }, [isLive]);

  return (
    <>
      {/* Fixed 16:9 at every viewport width — the one element in the bar that never
          reflows to its container's shape. */}
      <button
        type="button"
        disabled={!isLive || !login}
        onClick={() => setEnlarged(true)}
        className="relative shrink-0 w-[118px] aspect-video rounded-md overflow-hidden bg-black group disabled:cursor-default"
        data-testid="button-command-bar-preview"
      >
        {isLive && login ? (
          <>
            <img
              src={`https://static-cdn.jtvnw.net/previews-ttv/live_user_${login}-440x248.jpg?ts=${thumbnailTick}`}
              alt={title ?? "Stream preview"}
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/40 transition-colors">
              <Maximize2 className="h-4 w-4 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
          </>
        ) : (
          <div className="h-full w-full flex items-center justify-center">
            <Radio className="h-5 w-5 text-muted-foreground/50" />
          </div>
        )}
      </button>

      {login && <StreamPlayerDialog open={enlarged} onOpenChange={setEnlarged} channel={login} title={title} />}
    </>
  );
}

function StatusPill({ isLive }: { isLive: boolean }) {
  return (
    <div
      className={cn(
        "shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold uppercase tracking-wider",
        isLive ? "bg-red-500/15 text-red-500" : "bg-muted text-muted-foreground"
      )}
      data-testid="status-command-bar-live"
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", isLive ? "bg-red-500 animate-pulse" : "bg-muted-foreground")} />
      {isLive ? "Live" : "Offline"}
    </div>
  );
}

function GoalCard({
  goal,
  showRemaining,
  onToggleDisplay,
  onEdit,
}: {
  goal: StreamGoal;
  showRemaining: boolean;
  onToggleDisplay: () => void;
  onEdit: () => void;
}) {
  const remaining = Math.max(0, goal.target - goal.current);
  const percent = goal.target > 0 ? Math.min(100, (goal.current / goal.target) * 100) : 0;

  return (
    <div
      className="shrink-0 w-[150px] rounded-lg border border-border bg-card/60 px-3 py-2"
      data-testid={`goal-card-${goal._id}`}
    >
      <div className="flex items-center justify-between gap-1">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground truncate">{goal.label}</span>
        <button
          type="button"
          className="shrink-0 text-muted-foreground hover:text-foreground"
          onClick={onEdit}
          aria-label={`Edit ${goal.label}`}
          data-testid={`button-edit-goal-${goal._id}`}
        >
          <Pencil className="h-3 w-3" />
        </button>
      </div>
      {/* Clicking any card flips every card at once — one shared display mode, not per-card. */}
      <button
        type="button"
        className="w-full text-left"
        onClick={onToggleDisplay}
        data-testid={`button-toggle-goal-display-${goal._id}`}
      >
        <div className="text-sm font-bold tabular-nums">
          {showRemaining ? (
            `${remaining.toLocaleString()} to go`
          ) : (
            <>
              {goal.current.toLocaleString()}
              <span className="text-muted-foreground font-medium"> / {goal.target.toLocaleString()}</span>
            </>
          )}
        </div>
        <div className="mt-1 h-1 w-full rounded-full bg-muted overflow-hidden">
          <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${percent}%` }} />
        </div>
      </button>
    </div>
  );
}

interface GoalDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  instanceId: Id<"instances">;
  /** Null when adding a new goal. */
  goal: StreamGoal | null;
}

function GoalDialog({ open, onOpenChange, instanceId, goal }: GoalDialogProps) {
  const { toast } = useToast();
  const createGoal = useMutation(api.streamGoals.create);
  const updateGoal = useMutation(api.streamGoals.update);
  const removeGoal = useMutation(api.streamGoals.remove);

  const [label, setLabel] = useState("");
  const [current, setCurrent] = useState("0");
  const [target, setTarget] = useState("100");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }
    setLabel(goal?.label ?? "");
    setCurrent(String(goal?.current ?? 0));
    setTarget(String(goal?.target ?? 100));
  }, [open, goal]);

  const handleSave = async () => {
    const parsedTarget = Number(target);
    const parsedCurrent = Number(current);
    if (!label.trim()) {
      toast({ title: "Give the goal a name", variant: "destructive" });
      return;
    }
    if (!Number.isFinite(parsedTarget) || parsedTarget <= 0) {
      toast({ title: "Target must be a positive number", variant: "destructive" });
      return;
    }
    if (!Number.isFinite(parsedCurrent) || parsedCurrent < 0) {
      toast({ title: "Progress must be zero or more", variant: "destructive" });
      return;
    }

    setSaving(true);
    try {
      if (goal) {
        await updateGoal({ goalId: goal._id, label, current: parsedCurrent, target: parsedTarget });
      } else {
        await createGoal({ instanceId, label, current: parsedCurrent, target: parsedTarget });
      }
      onOpenChange(false);
    } catch (error) {
      toast({
        title: "Couldn't save the goal",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async () => {
    if (!goal) {
      return;
    }
    setSaving(true);
    try {
      await removeGoal({ goalId: goal._id });
      onOpenChange(false);
    } catch (error) {
      toast({
        title: "Couldn't remove the goal",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{goal ? "Edit goal" : "New goal"}</DialogTitle>
          <DialogDescription>
            Goals are tracked by hand — the engine doesn't report running follower, sub, or bits totals yet.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="goal-label">Name</Label>
            <Input
              id="goal-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Subs"
              data-testid="input-goal-label"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="goal-current">Progress</Label>
              <Input
                id="goal-current"
                type="number"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                data-testid="input-goal-current"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="goal-target">Target</Label>
              <Input
                id="goal-target"
                type="number"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                data-testid="input-goal-target"
              />
            </div>
          </div>
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          {goal ? (
            <Button
              variant="ghost"
              className="text-destructive hover:text-destructive"
              onClick={() => void handleRemove()}
              disabled={saving}
              data-testid="button-remove-goal"
            >
              Remove
            </Button>
          ) : (
            <span />
          )}
          <Button onClick={() => void handleSave()} disabled={saving} data-testid="button-save-goal">
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface CommandBarProps {
  /** Hides the bar for this browser — see $commandBarHidden in lib/stores.ts. */
  onDismiss: () => void;
}

/**
 * Full-width strip above the dashboard panels: stream preview, live pill,
 * goals, and a Clip button. Everything here reads the same
 * `instanceLiveState` row the stream-status and stream-preview widgets do —
 * Convex dedupes the subscription, so this is one data path, not a second.
 */
export function CommandBar({ onDismiss }: CommandBarProps) {
  const { instance } = useInstance();
  const { toast } = useToast();

  const liveState = useQuery(api.instanceLiveState.getForInstance, instance ? { instanceId: instance._id } : "skip");
  const platformLinks = useQuery(api.instances.getPlatformLinks, instance ? { instanceId: instance._id } : "skip");
  const goals = useQuery(api.streamGoals.list, instance ? { instanceId: instance._id } : "skip");
  const createClip = useAction(api.twitchClips.createClip);

  const [showRemaining, setShowRemaining] = useState(false);
  const [editingGoal, setEditingGoal] = useState<StreamGoal | null>(null);
  const [goalDialogOpen, setGoalDialogOpen] = useState(false);
  const [clipping, setClipping] = useState(false);

  const isLive = liveState?.isLive ?? false;
  const twitchLink = platformLinks?.find((link) => link.platform === "twitch");
  const login = twitchLink ? twitchLink.platformUsername.toLowerCase() : null;

  const openGoalDialog = (goal: StreamGoal | null) => {
    setEditingGoal(goal);
    setGoalDialogOpen(true);
  };

  const handleClip = async () => {
    if (!instance) {
      return;
    }
    setClipping(true);
    try {
      const { editUrl } = await createClip({ instanceId: instance._id });
      // Twitch creates the clip as a draft — it isn't published until it's
      // trimmed in their editor, so send the user straight there.
      window.open(editUrl, "_blank", "noopener,noreferrer");
      toast({ title: "Clip created", description: "Opened Twitch's clip editor to trim and publish it." });
    } catch (error) {
      toast({
        title: "Couldn't create the clip",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    } finally {
      setClipping(false);
    }
  };

  return (
    <Card className="shrink-0 mx-4 mt-4 mb-0 p-2 flex items-center gap-3" data-testid="dashboard-command-bar">
      <StreamPreviewThumbnail isLive={isLive} login={login} title={liveState?.streamTitle} />
      <StatusPill isLive={isLive} />

      <div className="flex-1 min-w-0 flex items-center gap-2 scroll-strip-x py-0.5">
        {(goals ?? []).map((goal) => (
          <GoalCard
            key={goal._id}
            goal={goal}
            showRemaining={showRemaining}
            onToggleDisplay={() => setShowRemaining((prev) => !prev)}
            onEdit={() => openGoalDialog(goal)}
          />
        ))}
        <button
          type="button"
          className="shrink-0 h-[58px] w-[92px] rounded-lg border border-dashed border-border text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors flex items-center justify-center gap-1"
          onClick={() => openGoalDialog(null)}
          disabled={!instance}
          data-testid="button-add-goal"
        >
          <Plus className="h-3.5 w-3.5" />
          Add
        </button>
      </div>

      <Button
        size="sm"
        className="shrink-0 gap-1.5"
        onClick={() => void handleClip()}
        disabled={clipping || !instance || !twitchLink}
        data-testid="button-create-clip"
      >
        {clipping ? <Loader2 className="h-4 w-4 animate-spin" /> : <Clapperboard className="h-4 w-4" />}
        Clip
      </Button>
      <button
        type="button"
        className="shrink-0 text-muted-foreground hover:text-foreground"
        onClick={onDismiss}
        aria-label="Hide command bar"
        data-testid="button-hide-command-bar"
      >
        <X className="h-4 w-4" />
      </button>

      {instance && (
        <GoalDialog
          open={goalDialogOpen}
          onOpenChange={setGoalDialogOpen}
          instanceId={instance._id}
          goal={editingGoal}
        />
      )}
    </Card>
  );
}
