import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import { httpAction } from "../_generated/server";
import { authenticateOps, OPS_SECRET_ENV, OPS_SECRET_NEXT_ENV } from "../lib/ops/auth";
import { matchOpsRoute } from "../lib/ops/routes";
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
    case "engines.byMaintenanceId": {
      const engine = await ctx.runQuery(internal.ops.reads.engineByMaintenanceId, { engineId: route.engineId });
      return engine === null ? error(404, "not_found", "No such engine") : ok(engine);
    }
    case "instances.health": {
      const health = await ctx.runQuery(internal.ops.reads.instanceHealth, { instanceId: route.instanceId });
      return health === null ? error(404, "not_found", "No such instance") : ok(health);
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
