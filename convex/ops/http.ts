import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import { type ActionCtx, httpAction } from "../_generated/server";
import { authenticateOps, OPS_SECRET_ENV, OPS_SECRET_NEXT_ENV } from "../lib/ops/auth";
import { parseBillingProjectionRequest } from "../lib/ops/billingProjectionRequest";
import {
  parseDiscountRequest,
  parseExemptionRequest,
  parsePlanRequest,
  parseSuspendRequest,
} from "../lib/ops/billingRequests";
import { parseIdempotencyKey } from "../lib/ops/idempotency";
import { parseNotificationRequest } from "../lib/ops/notificationRequest";
import { type AssignmentRow, tallyPlanAccounts } from "../lib/ops/planCounts";
import { type AccountBillingWrite, matchOpsRoute, PAGE_LIMIT, parsePageLimit } from "../lib/ops/routes";
import { parseStorageLimitsRequest } from "../lib/ops/storageLimitsRequest";
import { logger } from "../logger";
import type { BillingWriteResult } from "./billing";
import { projectionIdempotencyKey } from "./billingProjection";

/**
 * The ops API: what the internal backoffice reads about users, accounts and
 * engines. Only the backoffice server calls it, with a secret no browser
 * holds; see lib/ops/auth.ts. It sends no CORS headers, so no page can call
 * it from a browser. Every route authenticates before anything else, so an
 * unauthenticated caller cannot even tell which routes exist.
 */
export const opsHandler = httpAction(async (ctx, request) => {
  const configured = [process.env[OPS_SECRET_ENV], process.env[OPS_SECRET_NEXT_ENV]];
  if (!configured.some((secret) => secret)) {
    logger.warn(`ops api: ${OPS_SECRET_ENV} is not configured; refusing`);
  }
  const auth = await authenticateOps(request.headers, configured, { requireReason: request.method !== "GET" });
  if (!auth.ok) {
    return error(auth.status, auth.code, auth.message);
  }

  const url = new URL(request.url);
  const route = matchOpsRoute(request.method, url.pathname);
  if (route === null) {
    return error(404, "not_found", "No such ops route");
  }
  const cursor = url.searchParams.get("cursor");
  const q = url.searchParams.get("q") ?? undefined;

  switch (route.name) {
    case "users.list":
      return ok(await ctx.runQuery(internal.ops.reads.searchUsers, { q, cursor }));
    case "users.get": {
      const user = await ctx.runQuery(internal.ops.reads.getUser, { userId: route.userId });
      if (user === null) {
        return error(404, "not_found", "No such user");
      }
      await ctx.runMutation(internal.ops.audit.recordRead, {
        actor: auth.actor,
        action: "users.get",
        target: route.userId,
        reason: auth.reason,
      });
      return ok(user);
    }
    case "accounts.list":
      return ok(await ctx.runQuery(internal.ops.reads.searchAccounts, { q, cursor, now: Date.now() }));
    case "accounts.get": {
      const account = await ctx.runQuery(internal.ops.reads.getAccount, {
        accountId: route.accountId,
        now: Date.now(),
      });
      if (account === null) {
        return error(404, "not_found", "No such account");
      }
      await ctx.runMutation(internal.ops.audit.recordRead, {
        actor: auth.actor,
        action: "accounts.get",
        target: route.accountId,
        reason: auth.reason,
      });
      return ok(account);
    }
    case "engines.list": {
      const status = url.searchParams.get("status") ?? undefined;
      if (status !== undefined && !isProvisioningStatus(status)) {
        return error(400, "invalid_status", `Unknown status "${status}"`);
      }
      return ok(await ctx.runQuery(internal.ops.reads.listEngines, { status, cursor }));
    }
    case "engines.moduleStorageLimits": {
      return ok(await ctx.runQuery(internal.ops.reads.moduleStorageLimits, { cursor, now: Date.now() }));
    }
    case "engines.eventPath": {
      return ok(await ctx.runQuery(internal.ops.reads.engineEventPaths, { cursor }));
    }
    case "engines.byMaintenanceId": {
      const engine = await ctx.runQuery(internal.ops.reads.engineByMaintenanceId, {
        engineId: route.engineId,
        now: Date.now(),
      });
      return engine === null ? error(404, "not_found", "No such engine") : ok(engine);
    }
    case "instances.health": {
      const health = await ctx.runQuery(internal.ops.reads.instanceHealth, { instanceId: route.instanceId });
      return health === null ? error(404, "not_found", "No such instance") : ok(health);
    }
    case "engines.act": {
      // authenticateOps required a reason for this write.
      const outcome = await ctx.runAction(internal.ops.engines.act, {
        instanceId: route.instanceId,
        action: route.action,
        actor: auth.actor,
        reason: auth.reason ?? "",
      });
      return outcome.ok ? ok(outcome.result) : error(outcome.status, outcome.code, outcome.message);
    }
    case "instances.setStorageLimits": {
      const body = await request.json().catch(() => null);
      const parsed = parseStorageLimitsRequest(body);
      if (!parsed.ok) {
        return error(400, "invalid_storage_limits", parsed.message);
      }
      // authenticateOps required a reason for this write.
      const outcome = await ctx.runMutation(internal.ops.storageLimits.set, {
        instanceId: route.instanceId,
        limits: parsed.value,
        actor: auth.actor,
        reason: auth.reason ?? "",
      });
      return outcome.ok ? ok(outcome.result) : error(outcome.status, outcome.code, outcome.message);
    }
    case "plans.list": {
      // Accounts and assignments are read a page per query; see ops/reads.ts.
      const plans = await ctx.runQuery(internal.ops.reads.plansForCount, {});
      let totalAccounts = 0;
      let accountCursor: string | null = null;
      do {
        const page: { count: number; cursor: string | null } = await ctx.runQuery(internal.ops.reads.accountCountPage, {
          cursor: accountCursor,
        });
        totalAccounts += page.count;
        accountCursor = page.cursor;
      } while (accountCursor !== null);
      const assignments: AssignmentRow[] = [];
      let assignmentCursor: string | null = null;
      do {
        const page: { assignments: AssignmentRow[]; cursor: string | null } = await ctx.runQuery(
          internal.ops.reads.assignmentPage,
          { cursor: assignmentCursor }
        );
        assignments.push(...page.assignments);
        assignmentCursor = page.cursor;
      } while (assignmentCursor !== null);
      return ok(tallyPlanAccounts(plans, assignments, totalAccounts, Date.now()));
    }
    case "notifications.list":
      return ok(await ctx.runQuery(internal.ops.notifications.list, { cursor }));
    case "payments.strays": {
      const limit = parsePageLimit(url.searchParams.get("limit"));
      if (limit === null) {
        return error(400, "invalid_limit", `limit must be a whole number from 1 to ${PAGE_LIMIT.max}`);
      }
      return ok(await ctx.runQuery(internal.ops.reads.listStrayPayments, { cursor, limit }));
    }
    case "notifications.create": {
      const body = await request.json().catch(() => null);
      const parsed = parseNotificationRequest(body);
      if (!parsed.ok) {
        return error(400, "invalid_notification", parsed.message);
      }
      // authenticateOps required a reason for this write.
      const outcome = await ctx.runMutation(internal.ops.notifications.create, {
        ...parsed.value,
        actor: auth.actor,
        reason: auth.reason ?? "",
      });
      return outcome.ok ? ok(outcome.result) : error(outcome.status, outcome.code, outcome.message);
    }
    case "notifications.delete": {
      const outcome = await ctx.runMutation(internal.ops.notifications.remove, {
        notificationId: route.notificationId,
        actor: auth.actor,
        reason: auth.reason ?? "",
      });
      return outcome.ok ? ok(outcome.result) : error(outcome.status, outcome.code, outcome.message);
    }
    case "accounts.billing": {
      const idempotencyKey = parseIdempotencyKey(request.headers);
      if (!idempotencyKey.ok) {
        return error(400, "invalid_idempotency_key", idempotencyKey.message);
      }
      const body = await request.json().catch(() => null);
      // authenticateOps required a reason for this write.
      const operator = {
        accountId: route.accountId,
        actor: auth.actor,
        reason: auth.reason ?? "",
        idempotencyKey: idempotencyKey.value,
      };
      const outcome = await accountBillingWrite(ctx, route.write, body, operator);
      return outcome.ok ? ok(outcome.result) : error(outcome.status, outcome.code, outcome.message);
    }
    case "accounts.billingProjection": {
      const parsed = parseBillingProjectionRequest(await request.json().catch(() => null));
      if (!parsed.ok) {
        return error(400, "invalid_billing_projection", parsed.message);
      }
      if (parsed.value.accountId !== route.accountId) {
        return error(400, "invalid_billing_projection", "accountId must match the account in the path");
      }
      const idempotencyKey = parseIdempotencyKey(request.headers);
      if (!idempotencyKey.ok) {
        return error(400, "invalid_idempotency_key", idempotencyKey.message);
      }
      if (idempotencyKey.value !== projectionIdempotencyKey(route.accountId, parsed.value.version)) {
        return error(400, "invalid_idempotency_key", "Idempotency-Key must be {accountId}:{version}");
      }
      const outcome = await ctx.runMutation(internal.ops.billingProjection.applyBillingProjection, {
        ...parsed.value,
        actor: auth.actor,
        // authenticateOps required a reason for this write.
        auditReason: auth.reason ?? "",
      });
      return outcome.ok ? ok(outcome.result) : error(outcome.status, outcome.code, outcome.message);
    }
    case "audit.list": {
      const actor = url.searchParams.get("actor") ?? undefined;
      const target = url.searchParams.get("target") ?? undefined;
      if (actor !== undefined && target !== undefined) {
        return error(400, "one_filter", "Filter by actor or by target, not both");
      }
      return ok(await ctx.runQuery(internal.ops.reads.listAudit, { actor, target, cursor }));
    }
  }
});

type Operator = { accountId: string; actor: string; reason: string; idempotencyKey: string };

/** One subscription write, its body parsed first: a malformed one is a 400 and changes nothing. */
async function accountBillingWrite(
  ctx: ActionCtx,
  write: AccountBillingWrite,
  body: unknown,
  operator: Operator
): Promise<BillingWriteResult> {
  const invalid = (message: string): BillingWriteResult => ({
    ok: false,
    status: 400,
    code: `invalid_${write}`,
    message,
  });
  switch (write) {
    case "plan": {
      const parsed = parsePlanRequest(body);
      return parsed.ok
        ? ctx.runMutation(internal.ops.billing.setPlan, { ...operator, plan: parsed.value.plan })
        : invalid(parsed.message);
    }
    case "exemption": {
      const parsed = parseExemptionRequest(body);
      return parsed.ok
        ? ctx.runMutation(internal.ops.billing.setExemption, { ...operator, exemption: parsed.value })
        : invalid(parsed.message);
    }
    case "suspend": {
      const parsed = parseSuspendRequest(body);
      return parsed.ok
        ? ctx.runMutation(internal.ops.billing.suspend, { ...operator, suspendReason: parsed.value.reason })
        : invalid(parsed.message);
    }
    case "discount": {
      const parsed = parseDiscountRequest(body);
      return parsed.ok
        ? ctx.runAction(internal.ops.billing.applyDiscount, { ...operator, ...parsed.value })
        : invalid(parsed.message);
    }
  }
}

type ProvisioningStatus = Doc<"engineProvisioning">["status"];

const PROVISIONING_STATUSES: ReadonlySet<string> = new Set<ProvisioningStatus>([
  "requested",
  "provisioning",
  "ready",
  "registering",
  "registered",
  "upgrading",
  "failed",
  "deprovisioning",
  "deleted",
  "stopping",
  "stopped",
  "starting",
]);

function isProvisioningStatus(status: string): status is ProvisioningStatus {
  return PROVISIONING_STATUSES.has(status);
}

function ok(data: unknown): Response {
  return json(200, { data });
}

function error(status: number, code: string, message: string): Response {
  return json(status, { error: { code, message } });
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
