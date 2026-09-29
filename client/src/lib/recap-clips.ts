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

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * A chat line sharing one clip: "Clip: <title> (clipped by <name>) <url>".
 * The title and name are written by viewers, so the line always opens with the
 * fixed "Clip" label rather than their text (a title starting with "/" must
 * never read as a chat command), and any newlines in them collapse to spaces.
 * The title is cut short by code points, never the link, when the line would
 * exceed `maxLength`.
 */
export function buildClipShareMessage(
  clip: Pick<RecapClip, "title" | "creatorName" | "url">,
  maxLength: number = MAX_CHAT_MESSAGE_LENGTH
): string {
  const creator = collapseWhitespace(clip.creatorName);
  const tail = `${creator === "" ? "" : ` (clipped by ${creator})`} ${clip.url}`;
  const title = Array.from(collapseWhitespace(clip.title));
  if (title.length === 0) {
    return `Clip${tail}`;
  }
  const room = maxLength - "Clip: ".length - tail.length;
  if (title.length <= room) {
    return `Clip: ${title.join("")}${tail}`;
  }
  if (room <= 1) {
    return `Clip${tail}`;
  }
  return `Clip: ${title.slice(0, room - 1).join("")}\u2026${tail}`;
}
