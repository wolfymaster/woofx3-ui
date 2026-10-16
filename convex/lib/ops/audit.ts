import type { MutationCtx } from "../../_generated/server";

export interface OpsAuditEntry {
  actor: string;
  action: string;
  /** The user, account, instance or maintenance engine id acted on. */
  target: string;
  reason: string | null;
  /** The request's arguments; must never hold a secret. */
  request?: Record<string, unknown>;
  /** "ok", or the error code the request failed with. */
  result: string;
}

/** Records an ops action. A write calls this in the same mutation as its change, so neither lands without the other. */
export async function recordOpsAudit(ctx: MutationCtx, entry: OpsAuditEntry): Promise<void> {
  await ctx.db.insert("opsAuditLog", {
    actor: entry.actor,
    action: entry.action,
    target: entry.target,
    reason: entry.reason ?? undefined,
    request: entry.request === undefined ? undefined : JSON.stringify(entry.request),
    result: entry.result,
    at: Date.now(),
  });
}
