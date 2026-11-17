import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import { httpAction } from "../_generated/server";
import { authenticateOps } from "../lib/ops/auth";
import { parseBillingProjectionRequest } from "../lib/ops/billingProjectionRequest";
import { callerMayUse, nextSecretEnv, OPS_CALLERS } from "../lib/ops/callers";
import { parseIdempotencyKey } from "../lib/ops/idempotency";
import { parseNotificationRequest } from "../lib/ops/notificationRequest";
import { matchOpsRoute } from "../lib/ops/routes";
import { parseStorageLimitsRequest } from "../lib/ops/storageLimitsRequest";
import { logger } from "../logger";
import { projectionIdempotencyKey } from "./billingProjection";

/**
 * The ops API: what the internal backoffice reads about users, accounts and
 * engines, and what the maintenance billing process pushes. Servers call it
 * with a per-caller secret no browser holds, and each caller may use only the
 * routes in its scope; see lib/ops/callers.ts and lib/ops/auth.ts. It sends no CORS headers, so no page can call
 * it from a browser. Every route authenticates before anything else, so an
 * unauthenticated caller cannot even tell which routes exist.
 */
export const opsHandler = httpAction(async (ctx, request) => {
  const configured = OPS_CALLERS.map((caller) => ({
    caller,
    secrets: [process.env[caller.envPrefix], process.env[nextSecretEnv(caller.envPrefix)]],
  }));
  if (!configured.some((entry) => entry.secrets.some((secret) => secret))) {
    logger.warn("ops api: no caller secret is configured; refusing");
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
  if (!callerMayUse(auth.caller, route.name)) {
    return error(403, "forbidden_route", `Caller "${auth.caller.name}" may not use ${route.name}`);
  }
  if (auth.caller.deprecated) {
    logger.warn(`ops api: deprecated caller "${auth.caller.name}" used ${route.name}; give it its own secret`);
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
        caller: auth.caller.name,
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
        caller: auth.caller.name,
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
        caller: auth.caller.name,
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
        caller: auth.caller.name,
        actor: auth.actor,
        reason: auth.reason ?? "",
      });
      return outcome.ok ? ok(outcome.result) : error(outcome.status, outcome.code, outcome.message);
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
        caller: auth.caller.name,
        actor: auth.actor,
        reason: auth.reason ?? "",
      });
      return outcome.ok ? ok(outcome.result) : error(outcome.status, outcome.code, outcome.message);
    }
    case "notifications.delete": {
      const outcome = await ctx.runMutation(internal.ops.notifications.remove, {
        notificationId: route.notificationId,
        caller: auth.caller.name,
        actor: auth.actor,
        reason: auth.reason ?? "",
      });
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
        caller: auth.caller.name,
        actor: auth.actor,
        // authenticateOps required a reason for this write.
        auditReason: auth.reason ?? "",
      });
      return outcome.ok ? ok(outcome.result) : error(outcome.status, outcome.code, outcome.message);
    }
    case "accounts.billingProjectionReset": {
      const outcome = await ctx.runMutation(internal.ops.billingProjection.resetBillingProjection, {
        accountId: route.accountId,
        caller: auth.caller.name,
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
