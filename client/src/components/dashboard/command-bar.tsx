import { api } from "@convex/_generated/api";
import { useAction, useMutation, useQuery } from "convex/react";
import { Check, Clapperboard, Loader2, Maximize2, Plus, Radio, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { StreamPlayerDialog } from "@/components/dashboard/stream-player-dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useInstance } from "@/hooks/use-instance";
import { useLiveState } from "@/hooks/use-live-state";
import { useToast } from "@/hooks/use-toast";
import { type ResourceInstanceDoc, resourceName, resourceSettings } from "@/lib/resource-instance";
import { counterGoals, counterValue, goalProgress } from "@/lib/resource-values";
import { cn } from "@/lib/utils";

// Same public preview CDN and refresh cadence the stream-preview widget uses —
// Twitch only regenerates the underlying image every few minutes.
const THUMBNAIL_REFRESH_MS = 60_000;

/** The resource kind the bar's cards are drawn from; must match the woofx3 module's counter kind. */
const COUNTER_KIND = "counter";

const COUNTERS_PATH = "/stream/counters";

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

/**
 * What one card shows about a counter. All of it is derived — the number, the
 * name and the goals live on the counter resource itself, so a card can never
 * disagree with the counter's own page.
 */
interface CounterCardData {
  canonicalId: string;
  name: string;
  /** The counter's own page, where its goals are set. */
  href: string;
  value: number;
  /** The goal being worked toward: the smallest above the value. Null with no goals, or all of them passed. */
  goal: number | null;
  /** How far along a bar running from where the counter starts to its largest goal, 0 to 1. Null with no goals. */
  fraction: number | null;
}

function toCardData(row: ResourceInstanceDoc, value: unknown): CounterCardData {
  const settings = resourceSettings(row);
  const current = counterValue(value, settings);
  const goals = counterGoals(value, settings);
  const progress = goals.length > 0 ? goalProgress(current, counterValue(null, settings), goals) : null;

  return {
    canonicalId: row.canonicalId,
    name: resourceName(row),
    href: `${COUNTERS_PATH}/${row.resourceInstanceId}`,
    value: current,
    goal: progress?.next?.goal ?? null,
    fraction: progress?.fraction ?? null,
  };
}

function CounterCard({
  counter,
  showRemaining,
  onToggleDisplay,
  onRemove,
}: {
  counter: CounterCardData;
  showRemaining: boolean;
  onToggleDisplay: () => void;
  onRemove: () => void;
}) {
  const remaining = counter.goal === null ? null : Math.max(0, counter.goal - counter.value);

  return (
    <div
      className="shrink-0 w-[150px] rounded-lg border border-border bg-card/60 px-3 py-2"
      data-testid={`counter-card-${counter.canonicalId}`}
    >
      <div className="flex items-center justify-between gap-1">
        <Link
          href={counter.href}
          className="text-[10px] uppercase tracking-wider text-muted-foreground truncate hover:text-foreground"
          data-testid={`link-counter-${counter.canonicalId}`}
        >
          {counter.name}
        </Link>
        <button
          type="button"
          className="shrink-0 text-muted-foreground hover:text-foreground"
          onClick={onRemove}
          aria-label={`Take ${counter.name} off the command bar`}
          data-testid={`button-unpin-counter-${counter.canonicalId}`}
        >
          <X className="h-3 w-3" />
        </button>
      </div>
      {/* Clicking any card flips every card at once — one shared display mode, not per-card. */}
      <button
        type="button"
        className="w-full text-left"
        onClick={onToggleDisplay}
        data-testid={`button-toggle-counter-display-${counter.canonicalId}`}
      >
        <div className="text-sm font-bold tabular-nums">
          {showRemaining && remaining !== null ? (
            `${remaining.toLocaleString()} to go`
          ) : (
            <>
              {counter.value.toLocaleString()}
              {counter.goal !== null && (
                <span className="text-muted-foreground font-medium"> / {counter.goal.toLocaleString()}</span>
              )}
            </>
          )}
        </div>
        {/* The track stays even with no goal to fill it, so every card is the same height. */}
        <div
          className={cn(
            "mt-1 h-1 w-full rounded-full overflow-hidden",
            counter.fraction === null ? "bg-transparent" : "bg-muted"
          )}
        >
          {counter.fraction !== null && (
            <div
              className="h-full rounded-full bg-primary transition-[width]"
              style={{ width: `${counter.fraction * 100}%` }}
            />
          )}
        </div>
      </button>
    </div>
  );
}

/** Every counter the instance has, each one on or off the bar. */
function CounterPicker({
  counters,
  pinnedIds,
  onToggle,
}: {
  counters: ResourceInstanceDoc[];
  pinnedIds: Set<string>;
  onToggle: (canonicalId: string, pinned: boolean) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="shrink-0 h-[58px] w-[92px] rounded-lg border border-dashed border-border text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors flex items-center justify-center gap-1"
          data-testid="button-add-counter"
        >
          <Plus className="h-3.5 w-3.5" />
          Add
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-60 p-0">
        {counters.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground" data-testid="text-no-counters">
            No counters yet.{" "}
            <Link href={COUNTERS_PATH} className="underline hover:text-foreground" onClick={() => setOpen(false)}>
              Make one
            </Link>{" "}
            and it can go here.
          </p>
        ) : (
          <ScrollArea className="max-h-64">
            <ul className="p-1" aria-label="Counters">
              {counters.map((row) => {
                const pinned = pinnedIds.has(row.canonicalId);
                return (
                  <li key={row.canonicalId}>
                    <button
                      type="button"
                      className="w-full flex items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-muted"
                      aria-pressed={pinned}
                      onClick={() => onToggle(row.canonicalId, pinned)}
                      data-testid={`button-toggle-counter-${row.resourceInstanceId}`}
                    >
                      <Check className={cn("h-4 w-4 shrink-0", pinned ? "opacity-100" : "opacity-0")} aria-hidden />
                      <span className="truncate">{resourceName(row)}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </ScrollArea>
        )}
      </PopoverContent>
    </Popover>
  );
}

interface CommandBarProps {
  /** Hides the bar for this browser — see $commandBarHidden in lib/stores.ts. */
  onDismiss: () => void;
}

/**
 * Full-width strip above the dashboard panels: stream preview, live pill,
 * counters, and a Clip button. Everything here reads the same
 * `instanceLiveState` row the stream-status and stream-preview widgets do —
 * Convex dedupes the subscription, so this is one data path, not a second.
 */
export function CommandBar({ onDismiss }: CommandBarProps) {
  const { instance } = useInstance();
  const { toast } = useToast();
  const instanceId = instance?._id;

  const liveState = useLiveState();
  const platformLinks = useQuery(api.instances.getPlatformLinks, instanceId ? { instanceId } : "skip");
  const counters = useQuery(
    api.moduleResourceInstances.listByKind,
    instanceId ? { instanceId, kind: COUNTER_KIND } : "skip"
  );
  const values = useQuery(api.resourceValues.listForInstance, instanceId ? { instanceId } : "skip");
  const pinnedRows = useQuery(api.dashboardCounters.list, instanceId ? { instanceId } : "skip");
  const pinCounter = useMutation(api.dashboardCounters.add);
  const unpinCounter = useMutation(api.dashboardCounters.remove);
  const refreshValues = useAction(api.moduleResourceActions.refreshResourceValues);
  const createClip = useAction(api.twitchClips.createClip);

  const [showRemaining, setShowRemaining] = useState(false);
  const [clipping, setClipping] = useState(false);

  const isLive = liveState?.isLive ?? false;
  const twitchLink = platformLinks?.find((link) => link.platform === "twitch");
  const login = twitchLink ? twitchLink.platformUsername.toLowerCase() : null;

  // Counter values arrive by webhook while the dashboard is open; this fills in
  // any written before it was, or while a webhook went missing.
  useEffect(() => {
    if (!instanceId) {
      return;
    }
    refreshValues({ instanceId, kind: COUNTER_KIND }).catch(() => {
      // The mirror still shows the last known numbers; the next change updates it.
    });
  }, [instanceId, refreshValues]);

  const sortedCounters = useMemo(
    () => [...(counters ?? [])].sort((a, b) => resourceName(a).localeCompare(resourceName(b))),
    [counters]
  );

  // A pin whose counter has since been deleted resolves to nothing and is dropped.
  const cards = useMemo(() => {
    const byCanonicalId = new Map((counters ?? []).map((row) => [row.canonicalId, row]));
    return (pinnedRows ?? []).flatMap((pin) => {
      const counter = byCanonicalId.get(pin.canonicalId);
      return counter ? [toCardData(counter, values?.[counter.canonicalId] ?? null)] : [];
    });
  }, [counters, pinnedRows, values]);

  const pinnedIds = useMemo(() => new Set(cards.map((card) => card.canonicalId)), [cards]);

  const togglePinned = async (canonicalId: string, pinned: boolean) => {
    if (!instanceId) {
      return;
    }
    try {
      await (pinned ? unpinCounter({ instanceId, canonicalId }) : pinCounter({ instanceId, canonicalId }));
    } catch (error) {
      toast({
        title: pinned ? "Couldn't take that counter off the bar" : "Couldn't put that counter on the bar",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    }
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
        {cards.map((card) => (
          <CounterCard
            key={card.canonicalId}
            counter={card}
            showRemaining={showRemaining}
            onToggleDisplay={() => setShowRemaining((prev) => !prev)}
            onRemove={() => void togglePinned(card.canonicalId, true)}
          />
        ))}
        {instanceId && (
          <CounterPicker
            counters={sortedCounters}
            pinnedIds={pinnedIds}
            onToggle={(canonicalId, pinned) => void togglePinned(canonicalId, pinned)}
          />
        )}
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
    </Card>
  );
}
