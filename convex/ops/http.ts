import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import { httpAction } from "../_generated/server";
import { MIN_SUPPORTED_ENGINE_VERSION } from "../lib/engineVersion";
import { authenticateOps, OPS_SECRET_ENV, OPS_SECRET_NEXT_ENV } from "../lib/ops/auth";
import { type EngineReportRow, parseActiveDays, tallyEngineCapabilities } from "../lib/ops/engineCapabilityCounts";
import { parseNotificationRequest } from "../lib/ops/notificationRequest";
import { type AssignmentRow, tallyPlanAccounts } from "../lib/ops/planCounts";
import { matchOpsRoute } from "../lib/ops/routes";
import { parseStorageLimitsRequest } from "../lib/ops/storageLimitsRequest";
import { logger } from "../logger";

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
      return ok(await ctx.runQuery(internal.ops.reads.searchAccounts, { q, cursor }));
    case "accounts.get": {
      const account = await ctx.runQuery(internal.ops.reads.getAccount, { accountId: route.accountId });
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
    case "engines.capabilities": {
      const days = parseActiveDays(url.searchParams.get("days"));
      if (days === null) {
        return error(400, "invalid_days", "days must be a whole number from 1 to 365");
      }
      // Active instances are read a page per query; see ops/reads.ts.
      const nowMs = Date.now();
      const activeSince = nowMs - days * 24 * 60 * 60 * 1000;
      const rows: EngineReportRow[] = [];
      let reportCursor: string | null = null;
      do {
        const page: { rows: EngineReportRow[]; cursor: string | null } = await ctx.runQuery(
          internal.ops.reads.engineReportPage,
          { since: activeSince, cursor: reportCursor }
        );
        rows.push(...page.rows);
        reportCursor = page.cursor;
      } while (reportCursor !== null);
      return ok(
        tallyEngineCapabilities(rows, {
          days,
          activeSince,
          nowMs,
          minimumSupportedVersion: MIN_SUPPORTED_ENGINE_VERSION,
        })
      );
    }
    case "engines.byMaintenanceId": {
      const engine = await ctx.runQuery(internal.ops.reads.engineByMaintenanceId, { engineId: route.engineId });
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
