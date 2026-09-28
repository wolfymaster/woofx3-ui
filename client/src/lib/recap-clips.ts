import type { RecapClip } from "@convex/lib/recapClips";
import { MAX_CHAT_MESSAGE_LENGTH } from "@/lib/stream-recap";

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/** A time into the stream as `h:mm:ss`, the way Twitch writes VOD timestamps. */
export function formatStreamOffset(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours}:${pad2(minutes)}:${pad2(seconds)}`;
}

/** A clip's length as `m:ss`; Twitch reports fractional seconds, which round to the nearest. */
export function formatClipDuration(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${pad2(whole % 60)}`;
}

/**
 * A chat line sharing one clip: its title, who clipped it, and the link. The
 * title is cut short, never the link, when the line would exceed `maxLength`.
 */
export function buildClipShareMessage(
  clip: Pick<RecapClip, "title" | "creatorName" | "url">,
  maxLength: number = MAX_CHAT_MESSAGE_LENGTH
): string {
  const credit = clip.creatorName.trim() === "" ? "" : ` (clipped by ${clip.creatorName.trim()})`;
  const suffix = `${credit}: ${clip.url}`;
  const title = clip.title.trim() === "" ? "Clip" : clip.title.trim();
  const room = maxLength - suffix.length;
  if (title.length <= room) {
    return `${title}${suffix}`;
  }
  if (room <= 1) {
    return clip.url;
  }
  return `${title.slice(0, room - 1)}…${suffix}`;
}
