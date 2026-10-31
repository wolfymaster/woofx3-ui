import { USER_PAGE_LIMITS } from "@shared/user-pages";
import type { UserPageSubmissionDelivery } from "@woofx3/api";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { PageViewer } from "./sectionAccess";

/**
 * The outbox of form answers from public pages (pageSubmissions) and the queue
 * row that paces each instance's delivery (pageSubmissionQueues).
 *
 * A submit writes its row and the pending count in one transaction, before
 * anything is sent. Delivery then happens from a pass (lib/userPageFormDelivery.ts),
 * woken on insert and by a sweep. Only the engine's receipt marks a row
 * delivered, and the engine treats a resend as a duplicate, so a pass that dies
 * halfway costs a resend and never an answer.
 */

export const SUBMISSION_DELIVERY = {
  /** The first retry's delay, doubling per consecutive failure. */
  backoffBaseMs: 30_000,
  backoffMaxMs: 60 * 60_000,
  /** Sent per pass; a full batch leaves the rest to a follow-up pass, in a fresh action. */
  batchSize: 25,
  /** Outlasts a full batch of answered calls. A pass stops at the first engine timeout. */
  leaseMs: 5 * 60_000,
  engineCallTimeoutMs: 15_000,
  /** Queues woken per sweep; the oldest due go first and the rest wait for the next one. */
  sweepBatchSize: 100,
  deliveredRetentionMs: 30 * 24 * 60 * 60_000,
  /**
   * Rows deleted per transaction. A row is bounded by the submit request's
   * size limit, which keeps a batch within the transaction's read limit.
   */
  deleteBatchSize: 100,
  /** Longest engine message kept on a row. */
  reasonLength: 500,
} as const;

/**
 * Exponential in the consecutive failures, staying at the cap once reached,
 * with up to half of the delay as jitter so engines that went down together do
 * not retry together. `random` is in [0, 1).
 */
export function backoffDelayMs(failures: number, random: number): number {
  const exponent = Math.max(0, failures - 1);
  const ceiling = Math.min(SUBMISSION_DELIVERY.backoffMaxMs, SUBMISSION_DELIVERY.backoffBaseMs * 2 ** exponent);
  return ceiling / 2 + (ceiling / 2) * random;
}

export function boundedReason(reason: string): string {
  return reason.slice(0, SUBMISSION_DELIVERY.reasonLength);
}

/**
 * What a viewer's roles were at submit time, as delivered to the engine.
 * Roles that are unknown or uncheckable are listed as none.
 */
export function viewerRoleNames(viewer: PageViewer): string[] {
  if (viewer.kind === "anonymous" || viewer.roles.kind !== "known") {
    return [];
  }
  const { follower, subscriberTier } = viewer.roles;
  return [
    ...(follower ? ["follower"] : []),
    ...(subscriberTier !== null ? ["subscriber", `subscriber_tier_${subscriberTier}`] : []),
  ];
}

export function toSubmissionDelivery(row: Doc<"pageSubmissions">): UserPageSubmissionDelivery {
  return {
    submissionId: row._id,
    pageId: row.pageId,
    formId: row.formId,
    ...(row.formTitle !== undefined ? { formTitle: row.formTitle } : {}),
    submittedAt: new Date(row.submittedAt).toISOString(),
    viewer: row.viewer,
    fields: row.fields,
  };
}

export async function submissionQueueFor(
  ctx: QueryCtx,
  instanceId: Id<"instances">
): Promise<Doc<"pageSubmissionQueues"> | null> {
  return ctx.db
    .query("pageSubmissionQueues")
    .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
    .unique();
}

/** Keeps the flag the public read shows in step with the count, writing the page only when it flips. */
async function syncPageCapacity(ctx: MutationCtx, pageId: Id<"userPages">, pendingCount: number): Promise<void> {
  const page = await ctx.db.get(pageId);
  if (!page) {
    return;
  }
  const atCapacity = pendingCount >= USER_PAGE_LIMITS.pendingSubmissionsPerPage;
  if ((page.formsAtCapacity === true) !== atCapacity) {
    await ctx.db.patch(pageId, { formsAtCapacity: atCapacity });
  }
}

/** Starts a pass now, unless one is running (it picks up new rows) or the engine is still backing off. */
async function wakeIfDue(ctx: MutationCtx, queue: Doc<"pageSubmissionQueues">, now: number): Promise<void> {
  if ((queue.nextAttemptAt ?? Number.POSITIVE_INFINITY) <= now && (queue.leaseUntil ?? 0) <= now) {
    await ctx.scheduler.runAfter(0, internal.userPageForms.deliverInstance, { instanceId: queue.instanceId });
  }
}

/** Counts one more pending submission for the page and wakes delivery. */
export async function addPendingSubmission(
  ctx: MutationCtx,
  instanceId: Id<"instances">,
  pageId: Id<"userPages">,
  now: number,
  { retryNow }: { retryNow: boolean }
): Promise<void> {
  const queue = await submissionQueueFor(ctx, instanceId);
  const engineRetryAt = retryNow ? undefined : queue?.engineRetryAt;
  const nextAttemptAt = Math.max(now, engineRetryAt ?? 0);
  if (!queue) {
    await ctx.db.insert("pageSubmissionQueues", {
      instanceId,
      pageId,
      pendingCount: 1,
      nextAttemptAt,
      consecutiveFailures: 0,
    });
    await syncPageCapacity(ctx, pageId, 1);
    await ctx.scheduler.runAfter(0, internal.userPageForms.deliverInstance, { instanceId });
    return;
  }
  const pendingCount = queue.pendingCount + 1;
  await ctx.db.patch(queue._id, { pendingCount, nextAttemptAt, engineRetryAt });
  await syncPageCapacity(ctx, pageId, pendingCount);
  await wakeIfDue(ctx, { ...queue, nextAttemptAt }, now);
}

/** Counts one pending submission as settled. Its queue is missing only if the instance is being deleted. */
export async function settlePendingSubmission(ctx: MutationCtx, instanceId: Id<"instances">): Promise<void> {
  const queue = await submissionQueueFor(ctx, instanceId);
  if (!queue) {
    return;
  }
  const pendingCount = Math.max(0, queue.pendingCount - 1);
  await ctx.db.patch(queue._id, { pendingCount });
  await syncPageCapacity(ctx, queue.pageId, pendingCount);
}

/** The earliest moment any pending row wants another attempt, or null when none is pending. */
export async function earliestPendingAttempt(ctx: QueryCtx, instanceId: Id<"instances">): Promise<number | null> {
  const row = await ctx.db
    .query("pageSubmissions")
    .withIndex("by_instance_and_status_and_next_attempt_at", (q) =>
      q.eq("instanceId", instanceId).eq("status", "pending")
    )
    .first();
  return row?.nextAttemptAt ?? null;
}

/**
 * Removes the queue row now and the submissions in batches, for instance
 * deletion, since an instance can hold more than one transaction can read.
 */
export async function deletePageSubmissions(ctx: MutationCtx, instanceId: Id<"instances">): Promise<void> {
  const queue = await submissionQueueFor(ctx, instanceId);
  if (queue) {
    await ctx.db.delete(queue._id);
    await ctx.scheduler.runAfter(0, internal.userPageForms.deleteInstanceSubmissions, { instanceId });
  }
}
