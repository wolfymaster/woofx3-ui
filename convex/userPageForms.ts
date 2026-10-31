import { getAuthUserId } from "@convex-dev/auth/server";
import type { UserPageSubmissionDelivery } from "@woofx3/api";
import { paginationOptsValidator } from "convex/server";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { getInstanceMembership } from "./lib/teamAccess";
import { ENGINE_SUBMISSION_TRANSPORT, runDeliveryPass, type SubmissionEngine } from "./lib/userPageFormDelivery";
import { evaluateSubmission, type SubmissionEvaluation } from "./lib/userPageFormSubmit";
import {
  addPendingSubmission,
  backoffDelayMs,
  earliestPendingAttempt,
  SUBMISSION_DELIVERY,
  settlePendingSubmission,
  submissionQueueFor,
  toSubmissionDelivery,
} from "./lib/userPageSubmissions";
import { viewerRateLimiter } from "./lib/viewerRateLimits";
import { viewerFromSession } from "./lib/viewerSessionAuth";

// Form answers from public pages: what the submit route calls (userPageFormsHttp.ts),
// the delivery worker's steps (lib/userPageFormDelivery.ts runs them) and the
// streamer's view on the dashboard. lib/userPageSubmissions.ts has the design.

const attemptArgs = {
  slug: v.string(),
  formId: v.string(),
  idempotencyKey: v.string(),
  answers: v.array(v.object({ id: v.string(), value: v.union(v.string(), v.boolean()) })),
  sessionToken: v.union(v.string(), v.null()),
};

/** The submit decided without writing, so a doomed one never costs a Turnstile check. */
export const checkSubmission = internalQuery({
  args: attemptArgs,
  handler: async (ctx, attempt): Promise<SubmissionEvaluation> => evaluateSubmission(ctx, attempt),
});

export type AcceptSubmissionResult =
  | Extract<SubmissionEvaluation, { kind: "refused" | "repeat" }>
  | { kind: "accepted" };

/**
 * Queues a submission if it still passes every check. All in one transaction,
 * so the index lookup makes a repeat of `idempotencyKey` return without a
 * second row, and the cap cannot be overrun by submits racing each other.
 *
 * `humanVerified` is the route's word that Turnstile passed; a viewer whose
 * session has ended since the route looked is refused here rather than
 * queued unverified.
 */
export const acceptSubmission = internalMutation({
  args: { ...attemptArgs, humanVerified: v.boolean() },
  handler: async (ctx, { humanVerified, ...attempt }): Promise<AcceptSubmissionResult> => {
    const decided = await evaluateSubmission(ctx, attempt);
    if (decided.kind !== "fresh") {
      return decided;
    }
    if (decided.viewer === null && !humanVerified) {
      return { kind: "refused", code: "verification_failed" };
    }
    const signedIn = await viewerFromSession(ctx, attempt.sessionToken);
    if (signedIn) {
      const limit = await viewerRateLimiter.limit(ctx, "viewerFormSubmit", { key: signedIn._id });
      if (!limit.ok) {
        return { kind: "refused", code: "rate_limited" };
      }
    }
    const now = Date.now();
    await ctx.db.insert("pageSubmissions", {
      instanceId: decided.instanceId,
      pageId: decided.pageId,
      formId: attempt.formId,
      ...(decided.formTitle !== undefined ? { formTitle: decided.formTitle } : {}),
      idempotencyKey: attempt.idempotencyKey,
      submittedAt: now,
      viewer: decided.viewer,
      fields: decided.fields,
      status: "pending",
      attempts: 0,
      nextAttemptAt: now,
    });
    await addPendingSubmission(ctx, decided.instanceId, decided.pageId, now, { retryNow: false });
    return { kind: "accepted" };
  },
});

// ---------------------------------------------------------------------------
// Delivery
// ---------------------------------------------------------------------------

export const deliverInstance = internalAction({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, { instanceId }): Promise<void> => {
    await runDeliveryPass(ctx, instanceId, ENGINE_SUBMISSION_TRANSPORT);
  },
});

interface DeliveryClaim {
  engine: SubmissionEngine | null;
  batch: UserPageSubmissionDelivery[];
}

/** Takes the queue's lease and the oldest due rows. Null when it isn't due or another pass holds it. */
export const claimDeliveryPass = internalMutation({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, { instanceId }): Promise<DeliveryClaim | null> => {
    const queue = await submissionQueueFor(ctx, instanceId);
    const now = Date.now();
    if (!queue || queue.nextAttemptAt === undefined || queue.nextAttemptAt > now || (queue.leaseUntil ?? 0) > now) {
      return null;
    }
    const instance = await ctx.db.get(instanceId);
    if (!instance) {
      return null;
    }
    const rows = await ctx.db
      .query("pageSubmissions")
      .withIndex("by_instance_and_status_and_next_attempt_at", (q) =>
        q.eq("instanceId", instanceId).eq("status", "pending").lte("nextAttemptAt", now)
      )
      .take(SUBMISSION_DELIVERY.batchSize);
    await ctx.db.patch(queue._id, { leaseUntil: now + SUBMISSION_DELIVERY.leaseMs });
    const engine =
      instance.clientId && instance.clientSecret
        ? { url: instance.url, clientId: instance.clientId, clientSecret: instance.clientSecret }
        : null;
    return { engine, batch: rows.map(toSubmissionDelivery) };
  },
});

/** Saves what one call came to. A row already settled, or gone with its instance, is left as it is. */
export const recordDeliveryOutcome = internalMutation({
  args: {
    submissionId: v.id("pageSubmissions"),
    outcome: v.union(
      v.object({ kind: v.literal("delivered"), receipt: v.union(v.literal("recorded"), v.literal("duplicate")) }),
      v.object({ kind: v.literal("rejected"), reason: v.string() }),
      v.object({ kind: v.literal("retry"), reason: v.string() })
    ),
  },
  handler: async (ctx, { submissionId, outcome }): Promise<void> => {
    const row = await ctx.db.get(submissionId);
    if (!row || row.status !== "pending") {
      return;
    }
    const now = Date.now();
    const attempts = row.attempts + 1;
    switch (outcome.kind) {
      case "delivered":
        await ctx.db.patch(submissionId, {
          status: "delivered",
          attempts,
          deliveredAt: now,
          receipt: outcome.receipt,
          nextAttemptAt: undefined,
          lastError: undefined,
        });
        await settlePendingSubmission(ctx, row.instanceId);
        return;
      case "rejected":
        await ctx.db.patch(submissionId, {
          status: "failed",
          attempts,
          failureReason: outcome.reason,
          nextAttemptAt: undefined,
          lastError: undefined,
        });
        await settlePendingSubmission(ctx, row.instanceId);
        return;
      case "retry":
        await ctx.db.patch(submissionId, {
          attempts,
          lastError: outcome.reason,
          nextAttemptAt: now + backoffDelayMs(attempts, Math.random()),
        });
        return;
    }
  },
});

/**
 * Releases the lease, sets the engine's backoff from what the pass learned and
 * points the queue at its next due row, starting the next pass straight away
 * when a healthy engine still has rows waiting.
 */
export const finishDeliveryPass = internalMutation({
  args: {
    instanceId: v.id("instances"),
    engineState: v.union(
      v.literal("reached"),
      v.literal("not_contacted"),
      v.literal("not_registered"),
      v.literal("unreachable"),
      v.literal("capability_missing")
    ),
  },
  handler: async (ctx, { instanceId, engineState }): Promise<void> => {
    const queue = await submissionQueueFor(ctx, instanceId);
    if (!queue) {
      return;
    }
    const now = Date.now();
    let { consecutiveFailures, engineRetryAt, engineProblem } = queue;
    if (engineState === "reached") {
      consecutiveFailures = 0;
      engineRetryAt = undefined;
      engineProblem = undefined;
    } else if (engineState !== "not_contacted") {
      consecutiveFailures += 1;
      engineRetryAt = now + backoffDelayMs(consecutiveFailures, Math.random());
      engineProblem = engineState;
    }
    const earliest = await earliestPendingAttempt(ctx, instanceId);
    const nextAttemptAt = earliest === null ? undefined : Math.max(earliest, engineRetryAt ?? 0);
    await ctx.db.patch(queue._id, {
      leaseUntil: undefined,
      consecutiveFailures,
      engineRetryAt,
      engineProblem,
      nextAttemptAt,
    });
    if (engineState === "reached" && nextAttemptAt !== undefined && nextAttemptAt <= now) {
      await ctx.scheduler.runAfter(0, internal.userPageForms.deliverInstance, { instanceId });
    }
  },
});

/** Starts a pass for every queue that has come due. Passes refuse a queue another one holds. */
export const sweepDueQueues = internalMutation({
  args: {},
  handler: async (ctx): Promise<void> => {
    const now = Date.now();
    const due = await ctx.db
      .query("pageSubmissionQueues")
      .withIndex("by_next_attempt_at", (q) => q.gte("nextAttemptAt", 0).lte("nextAttemptAt", now))
      .take(SUBMISSION_DELIVERY.sweepBatchSize);
    for (const queue of due) {
      if ((queue.leaseUntil ?? 0) <= now) {
        await ctx.scheduler.runAfter(0, internal.userPageForms.deliverInstance, { instanceId: queue.instanceId });
      }
    }
  },
});

export const pruneDelivered = internalMutation({
  args: {},
  handler: async (ctx): Promise<void> => {
    const cutoff = Date.now() - SUBMISSION_DELIVERY.deliveredRetentionMs;
    const rows = await ctx.db
      .query("pageSubmissions")
      .withIndex("by_status_and_delivered_at", (q) => q.eq("status", "delivered").lt("deliveredAt", cutoff))
      .take(SUBMISSION_DELIVERY.deleteBatchSize);
    for (const row of rows) {
      await ctx.db.delete(row._id);
    }
    if (rows.length === SUBMISSION_DELIVERY.deleteBatchSize) {
      await ctx.scheduler.runAfter(0, internal.userPageForms.pruneDelivered, {});
    }
  },
});

export const deleteInstanceSubmissions = internalMutation({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, { instanceId }): Promise<void> => {
    const rows = await ctx.db
      .query("pageSubmissions")
      .withIndex("by_instance_and_submitted_at", (q) => q.eq("instanceId", instanceId))
      .take(SUBMISSION_DELIVERY.deleteBatchSize);
    for (const row of rows) {
      await ctx.db.delete(row._id);
    }
    if (rows.length === SUBMISSION_DELIVERY.deleteBatchSize) {
      await ctx.scheduler.runAfter(0, internal.userPageForms.deleteInstanceSubmissions, { instanceId });
    }
  },
});

// ---------------------------------------------------------------------------
// The streamer's view
// ---------------------------------------------------------------------------

export interface DashboardSubmission {
  id: Id<"pageSubmissions">;
  status: Doc<"pageSubmissions">["status"];
  formTitle: string | null;
  submittedAt: number;
  deliveredAt: number | null;
  viewer: Doc<"pageSubmissions">["viewer"];
  fields: Doc<"pageSubmissions">["fields"];
  failureReason: string | null;
  lastError: string | null;
}

function toDashboardSubmission(row: Doc<"pageSubmissions">): DashboardSubmission {
  return {
    id: row._id,
    status: row.status,
    formTitle: row.formTitle ?? null,
    submittedAt: row.submittedAt,
    deliveredAt: row.deliveredAt ?? null,
    viewer: row.viewer,
    fields: row.fields,
    failureReason: row.failureReason ?? null,
    lastError: row.lastError ?? null,
  };
}

/** The instance's submissions, newest first. A non-member gets an empty list. */
export const listSubmissions = query({
  args: { instanceId: v.id("instances"), paginationOpts: paginationOptsValidator },
  handler: async (ctx, { instanceId, paginationOpts }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId || (await getInstanceMembership(ctx, instanceId, userId)) === null) {
      return { page: [] as DashboardSubmission[], isDone: true, continueCursor: "" };
    }
    const result = await ctx.db
      .query("pageSubmissions")
      .withIndex("by_instance_and_submitted_at", (q) => q.eq("instanceId", instanceId))
      .order("desc")
      .paginate(paginationOpts);
    return { ...result, page: result.page.map(toDashboardSubmission) };
  },
});

export interface SubmissionQueueStatus {
  pendingCount: number;
  engineProblem: Doc<"pageSubmissionQueues">["engineProblem"] | null;
  atCapacity: boolean;
}

/** How the queue is doing, for the view's summary. Null for a non-member. */
export const queueStatus = query({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, { instanceId }): Promise<SubmissionQueueStatus | null> => {
    const userId = await getAuthUserId(ctx);
    if (!userId || (await getInstanceMembership(ctx, instanceId, userId)) === null) {
      return null;
    }
    const queue = await submissionQueueFor(ctx, instanceId);
    const page = queue ? await ctx.db.get(queue.pageId) : null;
    return {
      pendingCount: queue?.pendingCount ?? 0,
      engineProblem: queue?.engineProblem ?? null,
      atCapacity: page?.formsAtCapacity === true,
    };
  },
});

/**
 * Sends a failed submission again now, whatever the engine's backoff says: the
 * streamer asking is reason enough to try. A row that is no longer failed is
 * left as it is, so a double click changes nothing.
 */
export const retrySubmission = mutation({
  args: { submissionId: v.id("pageSubmissions") },
  handler: async (ctx, { submissionId }): Promise<void> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new ConvexError("Not signed in");
    }
    const row = await ctx.db.get(submissionId);
    if (!row || (await getInstanceMembership(ctx, row.instanceId, userId)) === null) {
      throw new ConvexError("That submission doesn't exist");
    }
    if (row.status !== "failed") {
      return;
    }
    const now = Date.now();
    await ctx.db.patch(submissionId, {
      status: "pending",
      attempts: 0,
      nextAttemptAt: now,
      failureReason: undefined,
    });
    await addPendingSubmission(ctx, row.instanceId, row.pageId, now, { retryNow: true });
  },
});
