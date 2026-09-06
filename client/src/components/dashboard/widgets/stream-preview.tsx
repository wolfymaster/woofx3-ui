import { api } from "@convex/_generated/api";
import { useQuery } from "convex/react";
import { Maximize2, Radio } from "lucide-react";
import { useEffect, useState } from "react";
import { StreamPlayerDialog } from "@/components/dashboard/stream-player-dialog";
import { useInstance } from "@/hooks/use-instance";
import { useLiveState } from "@/hooks/use-live-state";

// Twitch's live-preview CDN image, refreshed periodically via a cache-busting
// query param (Twitch itself only regenerates the underlying image every few
// minutes, so a 60s poll on our side is plenty). No auth/token needed — it's
// a public static image, unlike the EventSub layer in lib/platforms/.
const THUMBNAIL_REFRESH_MS = 60_000;

export function StreamPreviewWidget() {
  const { instance } = useInstance();
  const liveState = useLiveState();
  const platformLinks = useQuery(api.instances.getPlatformLinks, instance ? { instanceId: instance._id } : "skip");
  const [enlarged, setEnlarged] = useState(false);
  const [thumbnailTick, setThumbnailTick] = useState(0);

  const twitchLink = platformLinks?.find((link) => link.platform === "twitch");
  const isLive = liveState?.isLive ?? false;

  useEffect(() => {
    if (!isLive) {
      return;
    }
    const interval = setInterval(() => setThumbnailTick((tick) => tick + 1), THUMBNAIL_REFRESH_MS);
    return () => clearInterval(interval);
  }, [isLive]);

  if (!twitchLink) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-4 text-center">
        <Radio className="h-8 w-8 text-muted-foreground/50 mb-3" />
        <p className="text-sm text-muted-foreground">Connect Twitch in Settings to preview your stream</p>
      </div>
    );
  }

  const login = twitchLink.platformUsername.toLowerCase();

  return (
    <>
      <div className="h-full flex flex-col">
        <button
          type="button"
          disabled={!isLive}
          onClick={() => setEnlarged(true)}
          className="relative flex-1 min-h-0 w-full group overflow-hidden bg-black disabled:cursor-default"
          data-testid="button-enlarge-stream-preview"
        >
          {isLive ? (
            <>
              <img
                src={`https://static-cdn.jtvnw.net/previews-ttv/live_user_${login}-440x248.jpg?ts=${thumbnailTick}`}
                alt={liveState?.streamTitle ?? "Stream preview"}
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/40 transition-colors">
                <Maximize2 className="h-6 w-6 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
              <div className="absolute top-2 left-2 flex items-center gap-1.5 px-2 py-0.5 rounded bg-black/60">
                <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" />
                <span className="text-[10px] font-bold text-white uppercase tracking-wider">Live</span>
              </div>
            </>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-center p-4">
              <Radio className="h-8 w-8 text-muted-foreground/50 mb-2" />
              <p className="text-sm text-muted-foreground">Stream is offline</p>
            </div>
          )}
        </button>

        {isLive && liveState?.streamTitle && (
          <p className="px-2 py-1.5 text-xs text-muted-foreground truncate shrink-0 border-t border-border">
            {liveState.streamTitle}
          </p>
        )}
      </div>

      <StreamPlayerDialog open={enlarged} onOpenChange={setEnlarged} channel={login} title={liveState?.streamTitle} />
    </>
  );
}
