import {
  changedFields,
  diffStreamInfo,
  isEmptyPatch,
  type StreamInfo,
  tagsProblem,
  titleProblem,
} from "@convex/lib/streamInfo";

// Editing state for the Stream info widget. Twitch pushes nothing when a title
// changes from its own dashboard, so the widget polls, and a poll must never
// throw away what someone is halfway through typing.

export function isDirty(saved: StreamInfo, draft: StreamInfo): boolean {
  return !isEmptyPatch(diffStreamInfo(saved, draft));
}

/**
 * The draft to show after a fresh read from Twitch. An untouched draft follows
 * Twitch; an edited one is kept as it is, since overwriting it would lose
 * typing to a background refresh.
 */
export function rebaseDraft(previousSaved: StreamInfo, draft: StreamInfo, freshSaved: StreamInfo): StreamInfo {
  return isDirty(previousSaved, draft) ? draft : freshSaved;
}

/** Why the draft cannot be saved, or null. Mirrors what `updateChannelInfo` refuses. */
export function draftProblem(draft: StreamInfo): string | null {
  return titleProblem(draft.title) ?? tagsProblem(draft.tags);
}

const FIELD_LABELS = { title: "title", category: "category", tags: "tags" } as const;

export interface PresetComparison {
  /** Applying the preset would change nothing. */
  active: boolean;
  /** Human list of what applying would change, e.g. "title and category". */
  summary: string;
}

export function comparePreset(current: StreamInfo, preset: StreamInfo): PresetComparison {
  const fields = changedFields(diffStreamInfo(current, preset)).map((field) => FIELD_LABELS[field]);
  if (fields.length === 0) {
    return { active: true, summary: "Already applied" };
  }
  const list = fields.length === 1 ? fields[0] : `${fields.slice(0, -1).join(", ")} and ${fields[fields.length - 1]}`;
  return { active: false, summary: `Changes ${list}` };
}

/** A VOD offset as Twitch shows it: `m:ss` under an hour, `h:mm:ss` after. */
export function formatStreamPosition(totalSeconds: number): string {
  if (!(Number.isFinite(totalSeconds) && totalSeconds >= 0)) {
    throw new Error(`formatStreamPosition: expected a non-negative number, got ${totalSeconds}`);
  }
  const seconds = Math.floor(totalSeconds);
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const ss = String(s).padStart(2, "0");
  if (h === 0) {
    return `${m}:${ss}`;
  }
  return `${h}:${String(m).padStart(2, "0")}:${ss}`;
}
