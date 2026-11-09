import { v } from "convex/values";
import type { MutationCtx } from "../../_generated/server";
import type { ParseResult } from "../notifications";
import type { SubscriptionDto } from "./dto";
import type { AccountBillingWrite } from "./routes";

// The ops API's billing writes run once per caller-chosen Idempotency-Key, so
// the backoffice can retry after a timeout or a 5xx without writing twice.
// A key is claimed (pending), then settled: a success is kept and replayed to
// every repeat; a refusal releases the key, so the same request can be sent
// again once the organization allows it.

export const IDEMPOTENCY_KEY_HEADER = "Idempotency-Key";

// The backoffice's keys are 8 to 100 characters; a UUID fits.
const IDEMPOTENCY_KEY = /^[A-Za-z0-9_.:-]{8,100}$/;

export const OPS_REQUESTS = {
  /** How long a settled key is remembered; far longer than any backoffice retry. */
  retentionMs: 30 * 24 * 60 * 60_000,
  /**
   * A pending claim older than this belongs to a call that died between its
   * steps. Convex ends an action after 10 minutes, so the call that claimed it
   * can no longer settle it, and a repeat takes the claim over.
   */
  staleClaimMs: 15 * 60_000,
  /** Rows one cleanup pass deletes; a full batch schedules the next pass. */
  cleanupBatch: 200,
  /** Passes one daily cleanup chains at most; the next day's run picks up the rest. */
  maxCleanupPasses: 50,
} as const;

export const accountBillingWriteValidator = v.union(
  v.literal("plan"),
  v.literal("exemption"),
  v.literal("suspend"),
  v.literal("discount")
);

/** One write's identity: the route, the organization it changes and the caller's key. */
export interface OpsRequestId {
  write: AccountBillingWrite;
  accountId: string;
  key: string;
}

type Answer =
  | { ok: true; result: SubscriptionDto }
  | { ok: false; status: 409; code: "idempotency_mismatch" | "in_progress"; message: string };

export type OpsRequestClaim = { kind: "claimed" } | { kind: "answered"; outcome: Answer };

/** The request's `Idempotency-Key`, or why it is missing or malformed. */
export function parseIdempotencyKey(headers: Headers): ParseResult<string> {
  const key = headers.get(IDEMPOTENCY_KEY_HEADER);
  if (key === null) {
    return { ok: false, message: `${IDEMPOTENCY_KEY_HEADER} header is required` };
  }
  return IDEMPOTENCY_KEY.test(key)
    ? { ok: true, value: key }
    : {
        ok: false,
        message: `${IDEMPOTENCY_KEY_HEADER} must be 8-100 letters, digits, dots, colons, dashes or underscores`,
      };
}

/** Canonical JSON of a validated request: object keys sorted, so equal requests always match. */
export function requestFingerprint(request: unknown): string {
  return JSON.stringify(request, (_key, value: unknown) =>
    typeof value === "object" && value !== null && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : value
  );
}

async function findRequest(ctx: MutationCtx, id: OpsRequestId) {
  return ctx.db
    .query("opsRequests")
    .withIndex("by_key", (q) => q.eq("write", id.write).eq("accountId", id.accountId).eq("key", id.key))
    .unique();
}

/**
 * Claims `id` for a request, or answers it from an earlier one: the stored
 * success for the same request, 409 `idempotency_mismatch` for a different one
 * under the same key, and 409 `in_progress` while the first is still running.
 */
export async function claimOpsRequest(
  ctx: MutationCtx,
  id: OpsRequestId,
  fingerprint: string,
  now: number
): Promise<OpsRequestClaim> {
  const row = await findRequest(ctx, id);
  if (row === null) {
    await ctx.db.insert("opsRequests", { ...id, fingerprint, state: "pending", claimedAt: now });
    return { kind: "claimed" };
  }
  if (row.fingerprint !== fingerprint) {
    return {
      kind: "answered",
      outcome: {
        ok: false,
        status: 409,
        code: "idempotency_mismatch",
        message: "This idempotency key was used for a different request",
      },
    };
  }
  if (row.state === "done") {
    if (row.result === undefined) {
      throw new Error(`claimOpsRequest: settled request ${row._id} has no stored result`);
    }
    return { kind: "answered", outcome: { ok: true, result: JSON.parse(row.result) as SubscriptionDto } };
  }
  if (now - row.claimedAt < OPS_REQUESTS.staleClaimMs) {
    return {
      kind: "answered",
      outcome: { ok: false, status: 409, code: "in_progress", message: "This request is still being processed" },
    };
  }
  await ctx.db.patch(row._id, { claimedAt: now });
  return { kind: "claimed" };
}

/** Settles a claimed request: a success is kept for replay, a refusal releases the key. */
export async function settleOpsRequest(
  ctx: MutationCtx,
  id: OpsRequestId,
  outcome: { ok: true; result: SubscriptionDto } | { ok: false },
  now: number
): Promise<void> {
  const row = await findRequest(ctx, id);
  if (row === null || row.state !== "pending") {
    throw new Error(`settleOpsRequest: ${id.write} ${id.key} for ${id.accountId} is not claimed`);
  }
  if (outcome.ok) {
    await ctx.db.patch(row._id, { state: "done", result: JSON.stringify(outcome.result), claimedAt: now });
  } else {
    await ctx.db.delete(row._id);
  }
}
