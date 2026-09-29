/**
 * Pure helpers for listing the Twitch clips made during a stream recap's
 * session. Nothing here is stored: clips are fetched from Helix whenever a
 * recap is opened, so view counts stay current and deleted clips disappear.
 */

/** Most clips a recap lists. Helix pages hold at most 100 each. */
export const RECAP_CLIP_LIMIT = 100;

/** Upper bound on Helix pages walked, so a misbehaving cursor cannot loop forever. */
export const RECAP_CLIP_MAX_PAGES = 5;

/**
 * How long after the stream ends clips still count toward it. Viewers and mods
 * keep clipping the last moments for a few minutes after going offline.
 */
export const CLIP_WINDOW_GRACE_MS = 10 * 60_000;

/** Helix wants `ended_at` after `started_at`; a zero-length window is widened to this. */
export const MIN_CLIP_WINDOW_MS = 60_000;

interface Segment {
  startedAt: string;
  endedAt: string | null;
}

export interface ClipWindow {
  /** When the stream first went live; clip offsets are measured from here. */
  startedAtMs: number;
  endedAtMs: number;
}

/**
 * The span to ask Twitch for clips in: from the first going-live to the last
 * going-down plus `CLIP_WINDOW_GRACE_MS`, never past `nowMs`. A segment still
 * open counts as running until `nowMs`. The window is at least
 * `MIN_CLIP_WINDOW_MS` long, even when that reaches past `nowMs`. Null when the session never went live,
 * since there was nothing to clip.
 */
export function clipWindow(segments: ReadonlyArray<Segment>, nowMs: number): ClipWindow | null {
  let start = Number.POSITIVE_INFINITY;
  let end = Number.NEGATIVE_INFINITY;
  for (const segment of segments) {
    const segmentStart = Date.parse(segment.startedAt);
    const segmentEnd = segment.endedAt === null ? nowMs : Date.parse(segment.endedAt);
    if (!Number.isFinite(segmentStart) || !Number.isFinite(segmentEnd)) {
      continue;
    }
    start = Math.min(start, segmentStart);
    end = Math.max(end, segmentEnd);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    return null;
  }
  const cappedEnd = Math.min(end + CLIP_WINDOW_GRACE_MS, nowMs);
  return { startedAtMs: start, endedAtMs: Math.max(start + MIN_CLIP_WINDOW_MS, cappedEnd) };
}

/** The fields of a Helix `GET /clips` entry this module reads. */
export interface HelixClip {
  id: string;
  url: string;
  title: string;
  creator_name: string;
  view_count: number;
  created_at: string;
  thumbnail_url: string;
  duration: number;
  /** Seconds into the VOD where the clip starts; null when there is no VOD or Twitch has not processed it yet. */
  vod_offset: number | null;
}

export interface RecapClip {
  id: string;
  url: string;
  title: string;
  creatorName: string;
  viewCount: number;
  createdAt: string;
  thumbnailUrl: string;
  durationSeconds: number;
  /**
   * Milliseconds into the stream: the clip's VOD offset when Twitch has one,
   * otherwise the time from the first going-live to the clip's creation. Never negative.
   */
  offsetMs: number;
}

export function toRecapClip(clip: HelixClip, window: ClipWindow): RecapClip {
  const created = Date.parse(clip.created_at);
  const fromCreation = Number.isFinite(created) ? created - window.startedAtMs : 0;
  const offsetMs = typeof clip.vod_offset === "number" ? clip.vod_offset * 1000 : fromCreation;
  return {
    id: clip.id,
    url: clip.url,
    title: clip.title,
    creatorName: clip.creator_name,
    viewCount: clip.view_count,
    createdAt: clip.created_at,
    thumbnailUrl: clip.thumbnail_url,
    durationSeconds: clip.duration,
    offsetMs: Math.max(0, offsetMs),
  };
}

/**
 * Most viewed first; ties go to the earlier clip, then to id, so the order is
 * stable between loads. Duplicate ids (a clip repeated across Helix pages) are
 * kept once.
 */
export function sortClipsByViews(clips: ReadonlyArray<RecapClip>): RecapClip[] {
  const unique = new Map<string, RecapClip>();
  for (const clip of clips) {
    if (!unique.has(clip.id)) {
      unique.set(clip.id, clip);
    }
  }
  return Array.from(unique.values()).sort(
    (a, b) => b.viewCount - a.viewCount || a.offsetMs - b.offsetMs || a.id.localeCompare(b.id)
  );
}
