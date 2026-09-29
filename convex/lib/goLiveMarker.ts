import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

// A "Stream start" marker asked for from the Go live checklist before the
// stream is live. Twitch only marks a live broadcast, so the request waits on
// the goLiveChecklists row until instanceLiveState flips to live.

/**
 * How long a request waits for the stream to start. The checklist is run just
 * before going live; a request older than this belongs to a stream that never
 * happened, and marking a much later one "Stream start" would be wrong.
 */
export const MARKER_REQUEST_WINDOW_MS = 2 * 60 * 60 * 1000;

export function isMarkerRequestPending(requestedAt: number | undefined, now: number): boolean {
  if (requestedAt === undefined) {
    return false;
  }
  return now - requestedAt <= MARKER_REQUEST_WINDOW_MS;
}

/**
 * Called by every writer that flips instanceLiveState from offline to live.
 * Clears the request in the same transaction that schedules the marker, so a
 * webhook and a poll both noticing the stream start drop it once.
 */
export async function claimPendingStreamStartMarker(
  ctx: MutationCtx,
  instanceId: Id<"instances">,
  now: number
): Promise<void> {
  const row = await ctx.db
    .query("goLiveChecklists")
    .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
    .first();
  if (row?.pendingMarkerRequestedAt === undefined) {
    return;
  }
  const pending = isMarkerRequestPending(row.pendingMarkerRequestedAt, now);
  await ctx.db.patch(row._id, { pendingMarkerRequestedAt: undefined });
  if (pending) {
    await ctx.scheduler.runAfter(0, internal.goLive.dropStreamStartMarker, { instanceId });
  }
}
