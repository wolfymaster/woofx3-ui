import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { newBackend } from "../lib/convexTest.testing";
import { buildOpsOpenApi, OPS_ROUTES, type OpsRouteSpec } from "../lib/ops/contract";

/**
 * Every route is called over HTTP against seeded data, and each 200 answer is
 * parsed with the response schema the contract publishes, so the document
 * cannot drift from what the handler sends.
 */

/**
 * What a consumer does with the published document: each answer is validated against the route's own schema in it, so
 * a document that refuses an answer the handler really gives (a nullable enum without null, say) fails here and not in
 * the backoffice.
 */
const document = buildOpsOpenApi() as {
  paths: Record<
    string,
    Record<string, { operationId: string; responses: Record<string, { content?: Record<string, { schema: object }> }> }>
  >;
  components: object;
};
const ajv = addFormats(new Ajv2020({ strict: false }));

function answerProblems(name: string, answer: unknown): string[] {
  const operation = Object.values(document.paths)
    .flatMap((methods) => Object.values(methods))
    .find((candidate) => candidate.operationId === name);
  const schema =
    operation?.responses["200"]?.content?.["application/json"]?.schema ??
    operation?.responses["201"]?.content?.["application/json"]?.schema;
  if (schema === undefined) {
    return [`${name} publishes no success body`];
  }
  const validate = ajv.compile({ ...schema, components: document.components });
  return validate(answer) ? [] : (validate.errors ?? []).map((error) => `${error.instancePath} ${error.message}`);
}

const SECRET = "l".repeat(43);
const SECRET_ENV = "OPS_API_SECRET";

/** Routes with no case here: the maintenance API answers them, and tests of the action stub it. */
const NOT_EXERCISED: readonly string[] = ["engines.act"];

let saved: string | undefined;
beforeEach(() => {
  saved = process.env[SECRET_ENV];
  process.env[SECRET_ENV] = SECRET;
});
afterEach(() => {
  if (saved === undefined) {
    delete process.env[SECRET_ENV];
  } else {
    process.env[SECRET_ENV] = saved;
  }
});

function spec(name: string): OpsRouteSpec {
  const found = (OPS_ROUTES as readonly OpsRouteSpec[]).find((route) => route.name === name);
  if (found === undefined) {
    throw new Error(`no route ${name}`);
  }
  return found;
}

async function seed(t: ReturnType<typeof newBackend>) {
  return t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { name: "Ada", email: "ada@example.com" });
    const accountId = await ctx.db.insert("accounts", { name: "Acme", ownerId: userId, createdAt: 1 });
    await ctx.db.insert("accountMembers", { accountId, userId, role: "owner", createdAt: 1 });
    const instanceId = await ctx.db.insert("instances", {
      accountId,
      name: "Main",
      url: "https://engine.example.com",
      clientId: "c",
      hosting: "managed",
      createdAt: 1,
    });
    await ctx.db.insert("invitations", {
      accountId,
      email: "bo@example.com",
      role: "member",
      instanceId,
      engineRole: "member",
      token: "t",
      invitedByUserId: userId,
      status: "pending",
      expiresAt: 9,
      createdAt: 1,
    });
    await ctx.db.insert("engineProvisioning", {
      instanceId,
      accountId,
      requestedBy: userId,
      maintenanceEngineId: "eng-1",
      slug: "main",
      status: "registered",
      steps: [{ key: "boot", label: "Boot", status: "succeeded" }],
      registrationToken: "r",
      updatedAt: 1,
      createdAt: 1,
    });
    await ctx.db.insert("instanceLiveState", {
      instanceId,
      isLive: true,
      lastUpdateSource: "poll",
      lastUpdatedAt: 5,
    });
    await ctx.db.insert("instanceSync", {
      instanceId,
      lastSyncedAt: 1,
      nextEligibleAt: 2,
      status: "idle",
      lastError: "",
      lastDurationMs: 3,
      consecutiveErrorCount: 0,
      syncIntervalMs: 10,
    });
    await ctx.db.insert("engineAlerts", {
      instanceId,
      engineAlertId: "al1",
      status: "completed",
      createdAt: 1,
    });
    await ctx.db.insert("workflowHealth", {
      instanceId,
      engineWorkflowId: "wf1",
      status: "error",
      since: "2026-01-01T00:00:00Z",
      sinceMs: 1,
      receivedAt: 1,
    });
    const referrerId = await ctx.db.insert("users", { name: "Bo", email: "bo@example.com" });
    await ctx.db.insert("referrals", {
      referredUserId: userId,
      referredAccountId: accountId,
      referrerUserId: referrerId,
      code: "abc",
      rewardCents: 500,
      capturedAt: 1,
      status: "org_created",
    });
    return { userId, accountId, instanceId };
  });
}

describe("the ops API answers what its contract says", () => {
  test("every route's 200 answer parses with its response schema", async () => {
    const t = newBackend();
    const { userId, accountId, instanceId } = await seed(t);
    const exercised = new Set<string>();

    async function call(name: string, path: string, body?: unknown, expectedStatus = 200) {
      const route = spec(name);
      const response = await t.fetch(path, {
        method: route.method,
        headers: {
          Authorization: `Bearer ${SECRET}`,
          "X-Woofx3-Actor": "ops@example.com",
          "X-Woofx3-Reason": "test",
          "Content-Type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const json = (await response.json()) as { data?: unknown; error?: unknown };
      expect({ name, status: response.status, error: json.error }).toEqual({
        name,
        status: expectedStatus,
        error: undefined,
      });
      const parsed = route.response.safeParse(json.data);
      expect({ name, ok: parsed.success, issues: parsed.success ? [] : parsed.error.issues }).toEqual({
        name,
        ok: true,
        issues: [],
      });
      expect({ name, problems: answerProblems(name, json) }).toEqual({ name, problems: [] });
      exercised.add(name);
      return json.data;
    }

    await call("users.list", "/api/ops/users");
    await call("users.get", `/api/ops/users/${userId}`);
    await call("accounts.list", "/api/ops/accounts");
    await call("accounts.get", `/api/ops/accounts/${accountId}`);
    await call("engines.list", "/api/ops/engines?status=registered");
    await call("engines.moduleStorageLimits", "/api/ops/engines/module-storage-limits");
    await call("engines.eventPath", "/api/ops/engines/event-path");
    await call("engines.byMaintenanceId", "/api/ops/engines/by-maintenance-id/eng-1");
    await call("instances.health", `/api/ops/instances/${instanceId}/health`);
    await call("audit.list", "/api/ops/audit");
    await call("instances.setStorageLimits", `/api/ops/instances/${instanceId}/storage-limits`, { fileBytes: 10 });
    const notification = (await call("notifications.create", "/api/ops/notifications", {
      requestId: "r1",
      heading: "Hello",
      description: "World",
      link: "/admin",
      actionLabel: "Go",
      audience: { kind: "account", accountId },
    })) as { id: string };
    await call("notifications.list", "/api/ops/notifications");
    await call("notifications.delete", `/api/ops/notifications/${notification.id}/delete`, {});
    const flag = {
      key: "scenes.newToolbar",
      description: "The new scene toolbar",
      owner: "ops@woofx3.tv",
      removeBy: "2026-12-31",
      state: "rules",
      rules: { percent: 10, users: [userId], hosting: "managed" },
    };
    await call("featureFlags.create", "/api/ops/feature-flags", flag);
    await call("featureFlags.update", "/api/ops/feature-flags", { ...flag, state: "on", rules: undefined });
    await call("featureFlags.list", "/api/ops/feature-flags");
    await call("featureFlags.remove", "/api/ops/feature-flags/delete", { key: flag.key });
    await call("accounts.referral", `/api/ops/accounts/${accountId}/referral`);
    const issued = (await call(
      "referralCodes.issue",
      "/api/ops/referral-codes",
      { email: "ada@example.com", rewardCents: 500, actor: "ops@example.com" },
      201
    )) as { code: string };
    await call("referralCodes.list", "/api/ops/referral-codes");
    await call("referralCodes.update", `/api/ops/referral-codes/${issued.code}`, {
      rewardCents: 700,
      actor: "ops@example.com",
    });
    await call("referralCodes.revoke", `/api/ops/referral-codes/${issued.code}/revoke`, { actor: "ops@example.com" });
    const projection = {
      accountId,
      version: 1,
      tier: "pro",
      addOns: [],
      standing: "active",
      reason: null,
      trialEndsAt: null,
      graceEndsAt: null,
      periodEnd: 1_800_000_000_000,
      interval: null,
      exemptUntil: null,
      spinDownAt: null,
      hasProviderSubscription: false,
      discount: null,
      overrides: { addFeatures: [], removeFeatures: [], limits: {} },
    };
    await call("accounts.billingProjection", `/api/ops/accounts/${accountId}/billing-projection`, projection);
    await call("accounts.billingProjectionReset", `/api/ops/accounts/${accountId}/billing-projection-reset`, {});

    const missed = (OPS_ROUTES as readonly OpsRouteSpec[])
      .map((route) => route.name)
      .filter((name) => !exercised.has(name) && !NOT_EXERCISED.includes(name));
    expect(missed).toEqual([]);
  });
});
