import type { ClipWindow } from "./recapClips";

/**
 * Pure helpers for listing the stream markers placed during a recapped
 * session. Twitch keeps markers on the broadcast's VOD rather than on the
 * stream, so they are read per VOD, and a channel that does not save past
 * broadcasts has none to read. Nothing here is stored.
 */

/** Either scope lets Helix list markers; the dashboard's Twitch link asks for the second. */
export const MARKER_READ_SCOPES = ["user:read:broadcast", "channel:manage:broadcast"] as const;

/** Recent archives looked through for the session's VODs. A session is rarely more than a few broadcasts. */
export const RECAP_MARKER_VIDEO_LOOKBACK = 20;

/** Most VODs whose markers are read for one session. */
export const RECAP_MARKER_MAX_VIDEOS = 5;

/** Upper bound on marker pages walked per VOD, so a misbehaving cursor cannot loop forever. */
export const RECAP_MARKER_MAX_PAGES = 3;

/** The fields of a Helix `GET /videos` entry this module reads. */
export interface HelixVideo {
  id: string;
  created_at: string;
  /** Twitch's duration notation, e.g. `3h8m33s`. */
  duration: string;
}

/** The fields of one marker in a Helix `GET /streams/markers` answer this module reads. */
export interface HelixMarker {
  id: string;
  created_at: string;
  description: string;
  position_seconds: number;
}

export interface RecapMarker {
  id: string;
  /** When the marker was placed. */
  createdAt: string;
  description: string;
}

const DURATION_PATTERN = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/;

/** Milliseconds in a Helix duration such as `1h2m3s`, or null when it does not parse. */
export function parseHelixDuration(duration: string): number | null {
  const match = DURATION_PATTERN.exec(duration);
  if (!match || duration === "") {
    return null;
  }
  const [, hours, minutes, seconds] = match;
  return ((Number(hours ?? 0) * 60 + Number(minutes ?? 0)) * 60 + Number(seconds ?? 0)) * 1000;
}

/**
 * The VODs that overlap the session's window, oldest first, at most
 * `RECAP_MARKER_MAX_VIDEOS` of them. A VOD still recording reports the
 * duration so far, which is enough: it started inside the window.
 */
export function videosInWindow(videos: ReadonlyArray<HelixVideo>, window: ClipWindow): HelixVideo[] {
  const overlapping: Array<{ video: HelixVideo; start: number }> = [];
  for (const video of videos) {
    const start = Date.parse(video.created_at);
    const length = parseHelixDuration(video.duration);
    if (!Number.isFinite(start) || length === null) {
      continue;
    }
    if (start <= window.endedAtMs && start + length >= window.startedAtMs) {
      overlapping.push({ video, start });
    }
  }
  return overlapping
    .sort((a, b) => a.start - b.start)
    .slice(0, RECAP_MARKER_MAX_VIDEOS)
    .map(({ video }) => video);
}

/** The markers in one page of a Helix `GET /streams/markers` answer. */
export function markersFromHelix(body: unknown): HelixMarker[] {
  const data = (body as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) {
    throw new Error("Twitch answered the marker list in an unexpected shape.");
  }
  const markers: HelixMarker[] = [];
  for (const user of data) {
    const videos = (user as { videos?: unknown }).videos;
    if (!Array.isArray(videos)) {
      continue;
    }
    for (const video of videos) {
      const list = (video as { markers?: unknown }).markers;
      if (Array.isArray(list)) {
        markers.push(...(list as HelixMarker[]));
      }
    }
  }
  return markers;
}

/**
 * The markers placed inside the window, oldest first, each kept once. A
 * marker's `created_at` is when it was placed; one Twitch sends without a
 * readable time is placed from its VOD's start and its position instead.
 */
export function toRecapMarkers(
  entries: ReadonlyArray<{ video: HelixVideo; marker: HelixMarker }>,
  window: ClipWindow
): RecapMarker[] {
  const byId = new Map<string, { marker: RecapMarker; at: number }>();
  for (const { video, marker } of entries) {
    let at = Date.parse(marker.created_at);
    if (!Number.isFinite(at)) {
      at = Date.parse(video.created_at) + marker.position_seconds * 1000;
    }
    if (!Number.isFinite(at) || at < window.startedAtMs || at > window.endedAtMs || byId.has(marker.id)) {
      continue;
    }
    byId.set(marker.id, {
      marker: { id: marker.id, createdAt: new Date(at).toISOString(), description: marker.description ?? "" },
      at,
    });
  }
  return Array.from(byId.values())
    .sort((a, b) => a.at - b.at || a.marker.id.localeCompare(b.marker.id))
    .map(({ marker }) => marker);
}
