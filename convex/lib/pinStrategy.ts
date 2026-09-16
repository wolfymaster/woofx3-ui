/**
 * Deciding how to re-pin something from pin history.
 *
 * Twitch pins an existing chat message by id, and a message id stops being
 * pinnable once its stream is over. Re-pinning across streams — the whole point
 * of keeping a history — therefore cannot always reuse the original message: the
 * text has to be posted again and the new message pinned instead.
 *
 * Choosing between those two is pure, so it is decided here and tested. The
 * runtime fallback (try the id, re-post on refusal) still exists underneath, but
 * it costs a wasted API call and a two-step failure path, and it is the part
 * that cannot be exercised without a live channel. Getting the obvious cases
 * right here keeps that path rare.
 */

export interface PinHistoryEntry {
  /** Set only for entries this app pinned itself; absent for hand-written ones. */
  twitchMessageId?: string;
  /** When the entry was created — the moment its message id was minted. */
  createdAt: number;
  content: string;
}

export type RepinPlan =
  /** Pin the original message again; it should still exist. */
  | { kind: "repin"; messageId: string }
  /** Post the text as a fresh message and pin that. */
  | { kind: "resend"; text: string };

/**
 * How to re-pin `entry`.
 *
 * `streamStartedAt` is the current broadcast's start, or undefined when the
 * channel is offline or its live state is not yet known.
 *
 * An entry created before the current stream began keeps an id from a previous
 * broadcast, which Twitch will refuse, so it goes straight to re-posting rather
 * than spending a call to learn that. When the stream boundary is unknown the
 * id is tried anyway: the runtime fallback catches a refusal, and guessing
 * "stale" would needlessly duplicate a message that was pinnable all along.
 */
export function planRepin(entry: PinHistoryEntry, streamStartedAt: number | undefined): RepinPlan {
  if (!entry.twitchMessageId) {
    return { kind: "resend", text: entry.content };
  }
  if (streamStartedAt !== undefined && entry.createdAt < streamStartedAt) {
    return { kind: "resend", text: entry.content };
  }
  return { kind: "repin", messageId: entry.twitchMessageId };
}
