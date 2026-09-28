import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { RecapClip } from "@convex/lib/recapClips";
import { useAction } from "convex/react";
import { Clapperboard, Copy, ExternalLink, Eye, Loader2, MessageSquare, RefreshCw } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { RecapClipsState } from "@/hooks/use-recap-clips";
import { useToast } from "@/hooks/use-toast";
import { buildClipShareMessage, formatClipDuration, formatStreamOffset } from "@/lib/recap-clips";

const CREATED_FORMAT: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" };

function viewLabel(count: number): string {
  return count === 1 ? "1 view" : `${count.toLocaleString()} views`;
}

function ClipRow({
  instanceId,
  clip,
  canAnnounce,
}: {
  instanceId: Id<"instances">;
  clip: RecapClip;
  canAnnounce: boolean;
}) {
  const { toast } = useToast();
  const sendAnnouncement = useAction(api.twitchBroadcast.sendAnnouncement);
  const [sending, setSending] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(clip.url);
      toast({ title: "Clip link copied" });
    } catch {
      toast({ title: "Couldn't copy to the clipboard", variant: "destructive" });
    }
  };

  const handleShare = async () => {
    setSending(true);
    try {
      await sendAnnouncement({ instanceId, message: buildClipShareMessage(clip), color: "primary" });
      toast({ title: "Clip shared to chat" });
    } catch (error) {
      toast({
        title: "Couldn't share to chat",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <li className="flex flex-col gap-3 sm:flex-row" data-testid={`recap-clip-${clip.id}`}>
      <a href={clip.url} target="_blank" rel="noreferrer" className="relative shrink-0 sm:w-40">
        <img
          src={clip.thumbnailUrl}
          alt=""
          loading="lazy"
          decoding="async"
          className="aspect-video w-full rounded-md bg-muted object-cover"
        />
        <span className="absolute bottom-1 right-1 rounded bg-black/75 px-1 text-xs text-white tabular-nums">
          {formatClipDuration(clip.durationSeconds)}
        </span>
      </a>
      <div className="min-w-0 flex-1 space-y-1">
        <p className="truncate text-sm font-medium" title={clip.title}>
          {clip.title || "Untitled clip"}
        </p>
        <p className="text-xs text-muted-foreground tabular-nums">
          {clip.creatorName ? `by ${clip.creatorName} · ` : ""}
          {viewLabel(clip.viewCount)} · {formatStreamOffset(clip.offsetMs)} into the stream ·{" "}
          {new Date(clip.createdAt).toLocaleTimeString(undefined, CREATED_FORMAT)}
        </p>
        <div className="flex flex-wrap gap-2 pt-1">
          <Button variant="outline" size="sm" onClick={handleCopy} data-testid={`button-copy-clip-${clip.id}`}>
            <Copy className="h-4 w-4 mr-2" />
            Copy link
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleShare}
            disabled={!canAnnounce || sending}
            title={canAnnounce ? undefined : "Connect Twitch with chat announcement access in Settings"}
            data-testid={`button-share-clip-${clip.id}`}
          >
            {sending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <MessageSquare className="h-4 w-4 mr-2" />}
            Share to chat
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <a href={clip.url} target="_blank" rel="noreferrer">
              <ExternalLink className="h-4 w-4 mr-2" />
              Open on Twitch
            </a>
          </Button>
        </div>
      </div>
    </li>
  );
}

function ClipsBody({
  instanceId,
  state,
  canAnnounce,
}: {
  instanceId: Id<"instances">;
  state: RecapClipsState;
  canAnnounce: boolean;
}) {
  switch (state.kind) {
    case "loading":
      return (
        <div className="flex justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      );
    case "error":
      return (
        <p className="py-6 text-center text-sm text-muted-foreground" data-testid="recap-clips-error">
          Couldn't load clips from Twitch. {state.message}
        </p>
      );
    case "never_live":
      return <p className="py-6 text-center text-sm text-muted-foreground">This session never went live.</p>;
    case "loaded":
      if (state.clips.length === 0) {
        return (
          <div className="flex flex-col items-center gap-2 py-8 text-center" data-testid="recap-clips-empty">
            <Clapperboard className="h-6 w-6 text-muted-foreground/60" />
            <p className="max-w-sm text-sm text-muted-foreground">
              No clips from this stream yet. Twitch takes a minute or two to list a new clip, so refresh shortly if
              someone just made one.
            </p>
          </div>
        );
      }
      return (
        <ol className="space-y-4">
          {state.clips.map((clip) => (
            <ClipRow key={clip.id} instanceId={instanceId} clip={clip} canAnnounce={canAnnounce} />
          ))}
        </ol>
      );
  }
}

export function ClipsCard({
  instanceId,
  state,
  onReload,
  canAnnounce,
}: {
  instanceId: Id<"instances">;
  state: RecapClipsState;
  onReload: () => void;
  canAnnounce: boolean;
}) {
  return (
    <Card data-testid="recap-clips">
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div className="space-y-1.5">
          <CardTitle className="text-base">Clips</CardTitle>
          <CardDescription>Clips viewers and mods made during this stream, most viewed first.</CardDescription>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onReload}
          disabled={state.kind === "loading"}
          data-testid="button-reload-clips"
        >
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </CardHeader>
      <CardContent>
        <ClipsBody instanceId={instanceId} state={state} canAnnounce={canAnnounce} />
      </CardContent>
    </Card>
  );
}

/** The most viewed clip, linked out to Twitch; renders nothing until there is one. */
export function TopClipTile({ state }: { state: RecapClipsState }) {
  if (state.kind !== "loaded" || state.clips.length === 0) {
    return null;
  }
  const clip = state.clips[0];
  return (
    <a
      href={clip.url}
      target="_blank"
      rel="noreferrer"
      className="flex max-w-xs items-center gap-3 rounded-md border border-border p-2 hover:bg-muted"
      data-testid="recap-top-clip"
    >
      <img
        src={clip.thumbnailUrl}
        alt=""
        loading="lazy"
        decoding="async"
        className="aspect-video w-20 shrink-0 rounded bg-muted object-cover"
      />
      <span className="min-w-0">
        <span className="block text-xs text-muted-foreground">Top clip</span>
        <span className="block truncate text-sm font-medium">{clip.title || "Untitled clip"}</span>
        <span className="flex items-center gap-1 text-xs text-muted-foreground tabular-nums">
          <Eye className="h-3 w-3" />
          {viewLabel(clip.viewCount)}
        </span>
      </span>
    </a>
  );
}
