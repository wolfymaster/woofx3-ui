import { atom, onMount } from "nanostores";
import { $documentVisible } from "@/lib/stores";
import { startVisibleInterval } from "@/lib/visible-interval";

// Twitch regenerates its live-preview image only every few minutes, so a 60s
// cache-bust on our side is plenty.
const THUMBNAIL_REFRESH_MS = 60_000;

/**
 * One cache-busting counter for every live stream thumbnail on screen, so the
 * command bar and the preview widget reload together instead of each on its
 * own timer. It ticks only while something renders a thumbnail and the tab is
 * visible.
 */
export const $thumbnailTick = atom<number>(0);

onMount($thumbnailTick, () =>
  startVisibleInterval(
    () => {
      $thumbnailTick.set($thumbnailTick.get() + 1);
    },
    THUMBNAIL_REFRESH_MS,
    $documentVisible
  )
);

export function liveThumbnailUrl(login: string, tick: number): string {
  return `https://static-cdn.jtvnw.net/previews-ttv/live_user_${login}-440x248.jpg?ts=${tick}`;
}
