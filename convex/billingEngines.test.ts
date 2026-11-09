import { describe, expect, spyOn, test } from "bun:test";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { ENGINE_EFFECT_RETRY, ENGINE_STOP_RETRY, engineRetryDelay } from "./billing";
import { newBackend } from "./lib/convexTest.testing";
import { stubFetch } from "./lib/twitchEngineHelix.fakes";
import { logger } from "./logger";

type Backend = ReturnType<typeof newBackend>;
type ProvisioningStatus = Doc<"engineProvisioning">["status"];

const T0 = Date.UTC(2026, 10, 1);
const MAINTENANCE = { MAINTENANCE_API_URL: "https://maintenance.example", MAINTENANCE_API_KEY: "key" };

interface Seeded {
  accountId: Id<"accounts">;
  transitionId: Id<"subscriptionTransitions">;
  provisioningId: Id<"engineProvisioning">;
}

async function seed(
  t: Backend,
  state: "suspended" | "active",
  engineStatus: ProvisioningStatus,
  spinDownAt?: number
): Promise<Seeded> {
  return t.run(async (ctx) => {
    const ownerId = await ctx.db.insert("users", { name: "Owner" });
    const accountId = await ctx.db.insert("accounts", { name: "Org", ownerId, createdAt: 1 });
    const engine = (hosting: "managed" | "external") =>
      ctx.db.insert("instances", { accountId, name: hosting, url: "https://e", hosting, createdAt: 1 });
    const managedId = await engine("managed");
    await engine("external");
    const provisioningId = await ctx.db.insert("engineProvisioning", {
      instanceId: managedId,
      accountId,
      requestedBy: ownerId,
      slug: "org",
      status: engineStatus,
      steps: [],
      registrationToken: "token",
      registrationAttempts: 0,
      maintenanceEngineId: "eng_1",
      createdAt: 1,
      updatedAt: 1,
    });
    await ctx.db.insert("subscriptions", {
      accountId,
      plan: "starter",
      state,
      stateReason: state === "suspended" ? "payment_failed" : undefined,
      stateSince: T0,
      spinDownAt,
      nextCheckAt: spinDownAt,
      addOns: [],
      origin: "signup",
      updatedAt: T0,
      updatedBy: "test",
    });
    const transitionId = await ctx.db.insert("subscriptionTransitions", {
      accountId,
      from: "past_due",
      to: state,
      event: state === "suspended" ? "SpinDownDue" : "PaymentSucceeded",
      actor: "test",
      at: T0,
    });
    return { accountId, transitionId, provisioningId };
  });
}

/** Runs `fn` against a stubbed maintenance API, restoring the environment and fetch after. */
async function withMaintenance<T>(respond: (url: string) => Response | Promise<Response>, fn: () => Promise<T>) {
  const saved = Object.fromEntries(Object.keys(MAINTENANCE).map((key) => [key, process.env[key]]));
  Object.assign(process.env, MAINTENANCE);
  const fetchStub = stubFetch((call) => respond(call.url));
  const muted = spyOn(logger, "warn").mockImplementation(() => {});
  try {
    const result = await fn();
    return { result, calls: fetchStub.calls };
  } finally {
    fetchStub.restore();
    muted.mockRestore();
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

const ACCEPTED = () => Response.json({ engine: { id: "eng_1" }, run: { id: "run_1" } }, { status: 202 });

function run(t: Backend, s: Seeded, effect: "stopEngines" | "resumeEngines") {
  return t.action(internal.billing.runEngineEffect, { accountId: s.accountId, transitionId: s.transitionId, effect });
}

function effectRetries(t: Backend) {
  return t.run(async (ctx) =>
    (await ctx.db.system.query("_scheduled_functions").collect()).filter(
      (job) => job.name === "billing:runEngineEffect"
    )
  );
}

async function status(t: Backend, s: Seeded) {
  return (await t.run((ctx) => ctx.db.get(s.provisioningId)))?.status;
}

describe("stopping engines", () => {
  test("stops the managed engine, keyed by transition and engine, and skips the self-hosted one", async () => {
    const t = newBackend();
    const s = await seed(t, "suspended", "registered");
    const { result, calls } = await withMaintenance(ACCEPTED, () => run(t, s, "stopEngines"));
    expect(result).toEqual({ acted: 1, pending: 0 });
    expect(calls.map((call) => call.url)).toEqual(["https://maintenance.example/v1/engines/eng_1/stop"]);
    expect(new Headers(calls[0]?.init?.headers).get("Idempotency-Key")).toBe(`${s.transitionId}:eng_1`);
    expect(await status(t, s)).toBe("stopping");
  });

  test("a stopped engine is not stopped twice", async () => {
    const t = newBackend();
    const s = await seed(t, "suspended", "stopped");
    const { calls } = await withMaintenance(ACCEPTED, () => run(t, s, "stopEngines"));
    expect(calls).toEqual([]);
  });

  test("the row says stopping before the maintenance API is called, so a failed call is retried from there", async () => {
    const t = newBackend();
    const s = await seed(t, "suspended", "registered");
    const seenAtCall: Array<ProvisioningStatus | undefined> = [];
    const outage = async () => {
      seenAtCall.push(await status(t, s));
      return new Response("bad gateway", { status: 502 });
    };
    const first = await withMaintenance(outage, () => run(t, s, "stopEngines"));
    expect(first.result).toEqual({ acted: 0, pending: 1 });
    expect(seenAtCall).toEqual(["stopping"]);
    expect(await status(t, s)).toBe("stopping");
    const second = await withMaintenance(ACCEPTED, () => run(t, s, "stopEngines"));
    expect(second.result).toEqual({ acted: 1, pending: 0 });
    expect(second.calls.map((call) => call.url)).toEqual(["https://maintenance.example/v1/engines/eng_1/stop"]);
  });

  test("an upgrade in progress is retried later", async () => {
    const t = newBackend();
    const s = await seed(t, "suspended", "upgrading");
    const busy = () => Response.json({ error: { code: "run_in_progress", message: "upgrading" } }, { status: 409 });
    const { result } = await withMaintenance(busy, () => run(t, s, "stopEngines"));
    expect(result).toEqual({ acted: 0, pending: 1 });
    const retries = await t.run(async (ctx) =>
      (await ctx.db.system.query("_scheduled_functions").collect()).filter(
        (job) => job.name === "billing:runEngineEffect"
      )
    );
    expect(retries.map((job) => (job.args[0] as { attempt: number }).attempt)).toEqual([1]);
    expect(await status(t, s)).toBe("upgrading");
  });

  for (const code of ["engine_not_ready", "not_customer_engine"]) {
    test(`a stop refused with ${code} is failed with the reason, not retried`, async () => {
      const t = newBackend();
      const s = await seed(t, "suspended", "registered");
      const refused = () => Response.json({ error: { code, message: "no" } }, { status: 409 });
      const { result } = await withMaintenance(refused, () => run(t, s, "stopEngines"));
      expect(result).toEqual({ acted: 0, pending: 0 });
      expect(await t.run((ctx) => ctx.db.get(s.provisioningId))).toMatchObject({
        status: "failed",
        error: expect.stringContaining(code),
      });
      const retries = await t.run(async (ctx) =>
        (await ctx.db.system.query("_scheduled_functions").collect()).filter(
          (job) => job.name === "billing:runEngineEffect"
        )
      );
      expect(retries).toEqual([]);
    });
  }

  test("a run that throws part-way is retried, not lost", async () => {
    const t = newBackend();
    const s = await seed(t, "suspended", "registered");
    // A second row for the org makes its subscription lookup throw.
    await t.run(async (ctx) => {
      const row = await ctx.db
        .query("subscriptions")
        .withIndex("by_account", (q) => q.eq("accountId", s.accountId))
        .first();
      if (row === null) {
        throw new Error("seeded subscription missing");
      }
      const { _id, _creationTime, ...copy } = row;
      await ctx.db.insert("subscriptions", copy);
    });
    const muted = spyOn(logger, "error").mockImplementation(() => {});
    try {
      const { result } = await withMaintenance(ACCEPTED, () => run(t, s, "stopEngines"));
      expect(result).toBeNull();
    } finally {
      muted.mockRestore();
    }
    expect((await effectRetries(t)).map((job) => (job.args[0] as { attempt: number }).attempt)).toEqual([1]);
  });

  test("a stop that a recheck issued again stands down for the newer one", async () => {
    const t = newBackend();
    const s = await seed(t, "suspended", "registered");
    await t.run((ctx) =>
      ctx.db.insert("subscriptionTransitions", {
        accountId: s.accountId,
        from: "suspended",
        to: "suspended",
        event: "RetryDue",
        actor: "evaluator",
        at: T0 + 1,
      })
    );
    const { result, calls } = await withMaintenance(ACCEPTED, () => run(t, s, "stopEngines"));
    expect(result).toEqual({ acted: 0, pending: 0 });
    expect(calls).toEqual([]);
  });

  test("a stop that no longer fits the subscription does nothing", async () => {
    const t = newBackend();
    const s = await seed(t, "active", "registered");
    const { result, calls } = await withMaintenance(ACCEPTED, () => run(t, s, "stopEngines"));
    expect(result).toEqual({ acted: 0, pending: 0 });
    expect(calls).toEqual([]);
  });
});

describe("resuming engines", () => {
  test("starts only stopped engines", async () => {
    const t = newBackend();
    const s = await seed(t, "active", "stopped");
    const { calls } = await withMaintenance(ACCEPTED, () => run(t, s, "resumeEngines"));
    expect(calls.map((call) => call.url)).toEqual(["https://maintenance.example/v1/engines/eng_1/start"]);
    expect(await status(t, s)).toBe("starting");
  });

  test("reactivating before spin-down calls nothing", async () => {
    const t = newBackend();
    const s = await seed(t, "active", "registered");
    const { calls } = await withMaintenance(ACCEPTED, () => run(t, s, "resumeEngines"));
    expect(calls).toEqual([]);
    expect(await status(t, s)).toBe("registered");
  });

  /** Refuses the start as not stopped, and reports the engine in `engineStatus`. */
  const notStopped = (engineStatus: string) => (url: string) =>
    url.endsWith("/start")
      ? Response.json({ error: { code: "engine_not_stopped", message: engineStatus } }, { status: 409 })
      : Response.json({ engine: { id: "eng_1", status: engineStatus } });

  test("an engine the API refuses to start and reports ready is taken as running", async () => {
    const t = newBackend();
    const s = await seed(t, "active", "stopped");
    const { calls } = await withMaintenance(notStopped("ready"), () => run(t, s, "resumeEngines"));
    expect(calls.map((call) => call.url)).toEqual([
      "https://maintenance.example/v1/engines/eng_1/start",
      "https://maintenance.example/v1/engines/eng_1",
    ]);
    expect(await status(t, s)).toBe("registered");
  });

  test("an engine the API refuses to start and reports failed is failed, not running", async () => {
    const t = newBackend();
    const s = await seed(t, "active", "stopped");
    const { result } = await withMaintenance(notStopped("failed"), () => run(t, s, "resumeEngines"));
    expect(result).toEqual({ acted: 0, pending: 0 });
    expect(await t.run((ctx) => ctx.db.get(s.provisioningId))).toMatchObject({
      status: "failed",
      error: expect.stringContaining("failed"),
    });
  });

  test("a payment while a stop is running starts the engine once the stop settles", async () => {
    const t = newBackend();
    const s = await seed(t, "active", "stopping");
    const first = await withMaintenance(ACCEPTED, () => run(t, s, "resumeEngines"));
    expect(first.result).toEqual({ acted: 0, pending: 1 });
    expect(first.calls).toEqual([]);
    const retry = await t.run(async (ctx) =>
      (await ctx.db.system.query("_scheduled_functions").collect()).find(
        (job) => job.name === "billing:runEngineEffect"
      )
    );
    expect(retry?.args[0]).toMatchObject({ effect: "resumeEngines", attempt: 1 });
    await t.mutation(internal.provisioningInternal.applyCallbackEvent, {
      eventId: "e_stopped",
      eventType: "engine.stopped",
      maintenanceEngineId: "eng_1",
    });
    expect(await status(t, s)).toBe("stopped");
    const second = await withMaintenance(ACCEPTED, () =>
      t.action(
        internal.billing.runEngineEffect,
        retry?.args[0] as {
          accountId: Id<"accounts">;
          transitionId: Id<"subscriptionTransitions">;
          effect: "resumeEngines";
          attempt: number;
        }
      )
    );
    expect(second.calls.map((call) => call.url)).toEqual(["https://maintenance.example/v1/engines/eng_1/start"]);
    expect(await status(t, s)).toBe("starting");
  });
});

describe("maintenance callbacks", () => {
  function callback(t: Backend, eventId: string, eventType: string, runKind?: "stop" | "start") {
    return t.mutation(internal.provisioningInternal.applyCallbackEvent, {
      eventId,
      eventType,
      maintenanceEngineId: "eng_1",
      runKind,
      step: runKind ? "deploy" : undefined,
      error: eventType === "engine.failed" ? "health check timed out" : undefined,
    });
  }

  test("a stop settles as stopped and a start as registered", async () => {
    const t = newBackend();
    const s = await seed(t, "suspended", "stopping");
    await callback(t, "e1", "engine.stopped");
    expect(await status(t, s)).toBe("stopped");
    await callback(t, "e2", "engine.started");
    expect(await status(t, s)).toBe("registered");
  });

  test("a start failure reaches failed, for provisioning.retry to resume", async () => {
    const t = newBackend();
    const s = await seed(t, "active", "starting");
    await callback(t, "e1", "engine.failed", "start");
    const row = await t.run((ctx) => ctx.db.get(s.provisioningId));
    expect(row).toMatchObject({ status: "failed", error: "deploy: health check timed out" });
  });
});

describe("failed stops of a suspended org", () => {
  function stopFailed(t: Backend, eventId: string) {
    return t.mutation(internal.provisioningInternal.applyCallbackEvent, {
      eventId,
      eventType: "engine.failed",
      maintenanceEngineId: "eng_1",
      runKind: "stop",
      step: "host-stop",
      error: "host timed out",
    });
  }

  function stopRetries(t: Backend) {
    return t.run(async (ctx) =>
      (await ctx.db.system.query("_scheduled_functions").collect()).filter(
        (job) => job.name === "billing:retryEngineStop"
      )
    );
  }

  test("are retried with a new run each time, until the engine stops", async () => {
    const t = newBackend();
    const s = await seed(t, "suspended", "stopping");
    await stopFailed(t, "e1");
    expect(await t.run((ctx) => ctx.db.get(s.provisioningId))).toMatchObject({ status: "failed", stopRetries: 1 });
    const [retry] = await stopRetries(t);
    expect(retry?.args[0]).toEqual({ provisioningId: s.provisioningId, attempt: 0 });
    const delay = (retry?.scheduledTime ?? 0) - (retry?._creationTime ?? 0);
    expect(delay).toBeGreaterThanOrEqual(ENGINE_EFFECT_RETRY.baseDelayMs / 2 - 1000);
    expect(delay).toBeLessThanOrEqual(ENGINE_EFFECT_RETRY.baseDelayMs + 1000);

    const { calls } = await withMaintenance(ACCEPTED, () =>
      t.action(internal.billing.retryEngineStop, { provisioningId: s.provisioningId, attempt: 0 })
    );
    expect(calls.map((call) => call.url)).toEqual(["https://maintenance.example/v1/engines/eng_1/stop"]);
    expect(new Headers(calls[0]?.init?.headers).get("Idempotency-Key")).toBe(`stop-retry:${s.provisioningId}:0`);
    expect(await status(t, s)).toBe("stopping");

    await t.mutation(internal.provisioningInternal.applyCallbackEvent, {
      eventId: "e2",
      eventType: "engine.stopped",
      maintenanceEngineId: "eng_1",
    });
    const stopped = await t.run((ctx) => ctx.db.get(s.provisioningId));
    expect(stopped?.status).toBe("stopped");
    expect(stopped?.stopRetries).toBeUndefined();
  });

  test("give up at the cap and say the engine needs an operator; the recheck leaves it alone too", async () => {
    const t = newBackend();
    const s = await seed(t, "suspended", "stopping");
    await t.run((ctx) => ctx.db.patch(s.provisioningId, { stopRetries: ENGINE_STOP_RETRY.maxAttempts }));
    const muted = spyOn(logger, "error").mockImplementation(() => {});
    try {
      await stopFailed(t, "e1");
    } finally {
      muted.mockRestore();
    }
    expect(await stopRetries(t)).toEqual([]);
    expect(await t.run((ctx) => ctx.db.get(s.provisioningId))).toMatchObject({
      status: "failed",
      error: expect.stringContaining("gave up after 5 retries"),
    });
    const { calls } = await withMaintenance(ACCEPTED, () => run(t, s, "stopEngines"));
    expect(calls).toEqual([]);
  });

  test("are not retried once the org no longer wants its engines stopped", async () => {
    const t = newBackend();
    await seed(t, "active", "stopping");
    await stopFailed(t, "e1");
    expect(await stopRetries(t)).toEqual([]);
  });
});

describe("engineRetryDelay", () => {
  test("doubles, stays at the cap, and jitters within half of it", () => {
    expect(engineRetryDelay(0, 1)).toBe(ENGINE_EFFECT_RETRY.baseDelayMs);
    expect(engineRetryDelay(1, 1)).toBe(ENGINE_EFFECT_RETRY.baseDelayMs * 2);
    expect(engineRetryDelay(30, 1)).toBe(ENGINE_EFFECT_RETRY.maxDelayMs);
    expect(engineRetryDelay(30, 0)).toBe(ENGINE_EFFECT_RETRY.maxDelayMs / 2);
  });
});
