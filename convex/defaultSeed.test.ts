import { afterEach, describe, expect, test } from "bun:test";
import {
  DEFAULT_ALERT_ITEMS,
  DEFAULT_ALERTS_PACK_ID,
  DEFAULT_DASHBOARD_WIDGETS,
  DEFAULT_OVERLAY_SCENE_NAME,
} from "@shared/default-seed";
import { escapeDollarKeys } from "@shared/dollar-keys";
import { newHttpBatchRpcResponse, RpcTarget } from "capnweb";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { newBackend } from "./lib/convexTest.testing";

const ITEM = { packId: DEFAULT_ALERTS_PACK_ID, itemId: "follow", kind: "workflow" as const };

async function instanceWithOwner(t: ReturnType<typeof newBackend>) {
  return t.run(async (ctx) => {
    const ownerId = await ctx.db.insert("users", { name: "Owner" });
    const accountId = await ctx.db.insert("accounts", { name: "Acct", ownerId, createdAt: 1 });
    const instanceId = await ctx.db.insert("instances", {
      accountId,
      name: "Main",
      url: "https://engine.example",
      hosting: "managed",
      createdAt: 1,
    });
    await ctx.db.insert("instanceMembers", { instanceId, userId: ownerId, role: "owner" });
    await ctx.db.insert("platformLinks", {
      instanceId,
      platform: "twitch",
      platformUserId: "1",
      platformUsername: "owner",
      channelId: "1",
      sealedAccessToken: "sealed",
      sealedRefreshToken: "sealed",
      expiresAt: 1,
      scopes: [],
    });
    await ctx.db.insert("instanceSetup", { instanceId, platforms: [], platformsChosenAt: 1, updatedAt: 1 });
    return { instanceId, ownerId };
  });
}

describe("the seed-once ledger", () => {
  test("an alert whose workflow was deleted stays seeded, where a normal pack item may be installed again", async () => {
    const t = newBackend();
    const { instanceId } = await instanceWithOwner(t);
    const first = await t.mutation(internal.starterPacks.claimItem, { instanceId, ...ITEM, seedOnce: true });
    if (first.state !== "claimed") {
      throw new Error("the first claim should reserve the item");
    }
    await t.mutation(internal.starterPacks.completeItem, { rowId: first.rowId, engineId: "deleted-workflow" });

    const seeded = await t.mutation(internal.starterPacks.claimItem, { instanceId, ...ITEM, seedOnce: true });
    expect(seeded.state).toBe("installed");

    const ordinary = await t.mutation(internal.starterPacks.claimItem, { instanceId, ...ITEM });
    expect(ordinary.state).toBe("claimed");
  });
});

describe("the status read", () => {
  test("names the workflow from the ledger, so a confirmation after the run gave up still counts", async () => {
    const t = newBackend();
    const { instanceId, ownerId } = await instanceWithOwner(t);
    await t.run(async (ctx) => {
      const row = await ctx.db
        .query("instanceSetup")
        .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
        .first();
      if (row === null) {
        throw new Error("no setup row");
      }
      await ctx.db.patch(row._id, {
        defaultSeed: {
          scene: { status: "installed", engineSceneId: "scene-1" },
          alerts: [{ itemId: "follow", status: "pending", error: "waiting" }],
          alertImages: "omitted",
        },
      });
      await ctx.db.insert("starterPackItems", {
        instanceId,
        ...ITEM,
        status: "installed",
        engineId: "workflow-1",
        claimedAt: 1,
      });
    });
    const status = await t
      .withIdentity({ subject: `${ownerId}|session` })
      .query(api.defaultSeed.status, { instanceId });
    expect(status?.scene.engineSceneId).toBe("scene-1");
    expect(status?.alertImagesOmitted).toBe(true);
    expect(status?.alerts[0]).toEqual({
      itemId: "follow",
      event: "channel.follow",
      status: "installed",
      engineWorkflowId: "workflow-1",
      error: undefined,
    });
    expect(status?.alerts[1]?.status).toBe("pending");
  });
});

describe("the first dashboard panel", () => {
  async function completedPanels() {
    const t = newBackend();
    const { instanceId, ownerId } = await instanceWithOwner(t);
    await t.withIdentity({ subject: `${ownerId}|session` }).mutation(api.setup.complete, { instanceId, platforms: [] });
    return t.run(async (ctx) => {
      const layout = await ctx.db
        .query("dashboardLayouts")
        .withIndex("by_instance_user", (q) => q.eq("instanceId", instanceId).eq("userId", ownerId))
        .first();
      return layout?.panels ?? [];
    });
  }

  test("is the default panel", async () => {
    const [panel] = await completedPanels();
    expect(panel?.layoutId).toBe("dock-activity-controls");
    expect(panel?.widgets).toEqual(DEFAULT_DASHBOARD_WIDGETS.map((widget) => ({ ...widget })));
  });

  test("a finish outranks a skip either way round, and needs an admin", async () => {
    const t = newBackend();
    const { instanceId, ownerId } = await instanceWithOwner(t);
    const owner = t.withIdentity({ subject: `${ownerId}|session` });
    await owner.mutation(api.defaultSeed.markOverlayDone, { instanceId, outcome: "skipped" });
    expect((await owner.query(api.defaultSeed.status, { instanceId }))?.overlayDone).toEqual({ outcome: "skipped" });
    await owner.mutation(api.defaultSeed.markOverlayDone, { instanceId, outcome: "finished" });
    await owner.mutation(api.defaultSeed.markOverlayDone, { instanceId, outcome: "skipped" });
    expect((await owner.query(api.defaultSeed.status, { instanceId }))?.overlayDone).toEqual({ outcome: "finished" });
    await expect(t.mutation(api.defaultSeed.markOverlayDone, { instanceId, outcome: "skipped" })).rejects.toThrow();
  });
});

type Backend = ReturnType<typeof newBackend>;

/**
 * Answers through capnweb's real HTTP batch handling, so a session used past its
 * first await fails here as it does in production, with "Batch RPC request ended".
 */
class FakeEngine extends RpcTarget {
  readonly scenes: { id: string; name: string; widgetsJson: string }[] = [];
  readonly workflows = new Map<string, boolean>();
  readonly enableCalls: string[] = [];
  createsFailing = 0;
  enablesFailing = 0;
  modulesFailing = false;

  constructor(
    private readonly t: Backend,
    private readonly instanceId: Id<"instances">
  ) {
    super();
  }

  authenticate(): FakeEngine {
    return this;
  }

  getEngineCapabilities() {
    return { schema: 1, capabilities: ["alerts.compositionLayout"] };
  }

  getEngineInfo() {
    return { overlayPublicUrl: "https://engine.example" };
  }

  listEngineModules() {
    if (this.modulesFailing) {
      throw new Error("the engine is restarting");
    }
    return [{ moduleId: "woofx3", moduleKey: "woofx3:0.45.0:abc1234" }];
  }

  getAvailableWidgets() {
    return {
      widgets: [
        {
          id: "cae7619f-41f4-4a6e-9f3a-0d5be1c7a2d1",
          manifestId: "alert",
          createdByRef: "woofx3:0.45.0:abc1234",
          name: "Alert",
          hostsSurface: "alert",
        },
      ],
    };
  }

  /** As the engine's: the stored JSON columns, verbatim. */
  listSceneSnapshots() {
    return { scenes: this.scenes };
  }

  /** The refusal is the db service's requireUniqueName. */
  createScene(scene: { name: string; widgetsJson: string }) {
    if (this.scenes.some((existing) => existing.name === scene.name)) {
      throw new Error(`a scene named ${JSON.stringify(scene.name)} already exists`);
    }
    const id = `scene-${this.scenes.length + 1}`;
    this.scenes.push({ id, name: scene.name, widgetsJson: scene.widgetsJson });
    return { id };
  }

  /** Created off, echoed with the caller's key, as the engine's create path does. */
  async createWorkflow(input: { definition: { name: string }; correlationKey: string }) {
    if (this.createsFailing > 0) {
      this.createsFailing -= 1;
      throw new Error("the database is busy");
    }
    const id = `workflow-${this.workflows.size + 1}`;
    this.workflows.set(id, false);
    await this.echo(id, input.definition, false, input.correlationKey, "create");
    return { id, definition: input.definition, isEnabled: false };
  }

  async setWorkflowEnabled(id: string, isEnabled: boolean, correlationKey: string) {
    this.enableCalls.push(id);
    if (this.enablesFailing > 0) {
      this.enablesFailing -= 1;
      throw new Error("the engine is restarting");
    }
    this.workflows.set(id, isEnabled);
    await this.echo(id, { name: id }, isEnabled, correlationKey, "update");
    return { id, isEnabled };
  }

  private async echo(
    engineWorkflowId: string,
    definition: unknown,
    isEnabled: boolean,
    correlationKey: string,
    op: "create" | "update"
  ) {
    await this.t.mutation(internal.workflowInternal.upsertFromWebhook, {
      instanceId: this.instanceId,
      engineWorkflowId,
      definition: escapeDollarKeys(definition),
      isEnabled,
    });
    await this.t.mutation(internal.workflowInternal.resolveCorrelation, { correlationKey, engineWorkflowId, op });
  }
}

/** Gives up before bun's own test timeout, so a condition that never holds says which it was. */
async function until(condition: () => boolean | Promise<boolean>, what: string): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!(await condition())) {
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting until ${what}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("applying the seed on a real engine connection", () => {
  const realFetch = globalThis.fetch;

  async function firstRunEngine() {
    const t = newBackend();
    const { instanceId, ownerId } = await instanceWithOwner(t);
    await t.run(async (ctx) => {
      await ctx.db.patch(instanceId, { clientId: "client", clientSecret: "secret" });
      const row = await ctx.db
        .query("instanceSetup")
        .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
        .first();
      if (row === null) {
        throw new Error("no setup row");
      }
      await ctx.db.patch(row._id, { firstRunAt: 1 });
      await ctx.db.insert("actionDefinitions", {
        slug: "alert",
        name: "Alert",
        description: "",
        category: "",
        color: "",
        icon: "",
        handlerType: "alert",
        projectionKey: "woofx3:action:alert",
      });
      await ctx.db.insert("instanceActions", { instanceId, actionId: "alert" });
      for (const item of DEFAULT_ALERT_ITEMS) {
        const slug = `twitch.${item.trigger.event}`;
        await ctx.db.insert("triggerDefinitions", {
          slug,
          name: item.trigger.label,
          description: "",
          category: "",
          color: "",
          icon: "",
          event: item.trigger.event,
        });
        await ctx.db.insert("instanceTriggers", { instanceId, triggerId: slug });
      }
    });
    const engine = new FakeEngine(t, instanceId);
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
      newHttpBatchRpcResponse(new Request(input, init), engine)) as typeof fetch;
    const status = () =>
      t.withIdentity({ subject: `${ownerId}|session` }).query(api.defaultSeed.status, { instanceId });
    return { t, instanceId, ownerId, engine, status };
  }

  /** Lets the enables a run scheduled finish here, not on the next test's fake engine. */
  async function enablesSettled(t: Backend, engine: FakeEngine) {
    await until(() => engine.enableCalls.length === DEFAULT_ALERT_ITEMS.length, "every alert is enabled");
    await t.finishInProgressScheduledFunctions();
  }

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  test("seeds the scene and every alert, each call on its own session", async () => {
    const { t, instanceId, engine, status } = await firstRunEngine();

    await t.action(internal.setupApply.run, { instanceId });

    const seeded = await status();
    expect(seeded?.scene).toEqual({ status: "installed", engineSceneId: "scene-1" });
    expect(seeded?.alerts.map((alert) => alert.status)).toEqual(DEFAULT_ALERT_ITEMS.map(() => "installed"));
    expect(seeded?.alertImagesOmitted).toBe(false);
    expect(engine.workflows.size).toBe(DEFAULT_ALERT_ITEMS.length);
    await enablesSettled(t, engine);
  });

  test("adopts the scene of a run that died before recording its id, rather than wedging on its name", async () => {
    const { t, instanceId, engine, status } = await firstRunEngine();
    await t.action(internal.setupApply.run, { instanceId });
    const firstScene = (await status())?.scene.engineSceneId;
    await enablesSettled(t, engine);
    await t.run(async (ctx) => {
      const row = await ctx.db
        .query("instanceSetup")
        .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
        .first();
      if (row === null || row.defaultSeed === undefined) {
        throw new Error("no seed recorded");
      }
      await ctx.db.patch(row._id, { defaultSeed: { ...row.defaultSeed, scene: { status: "pending" } } });
    });

    await t.action(internal.setupApply.run, { instanceId });

    expect((await status())?.scene).toEqual({ status: "installed", engineSceneId: firstScene });
    expect(engine.scenes.length).toBe(1);
  });

  test("works around a streamer's own scene holding the name, with no widget to adopt", async () => {
    const { t, instanceId, engine, status } = await firstRunEngine();
    engine.scenes.push({ id: "theirs", name: DEFAULT_OVERLAY_SCENE_NAME, widgetsJson: "[]" });

    await t.action(internal.setupApply.run, { instanceId });

    expect((await status())?.scene).toEqual({ status: "installed", engineSceneId: "scene-2" });
    expect(engine.scenes[1]?.name).toBe(`${DEFAULT_OVERLAY_SCENE_NAME} 2`);
    await enablesSettled(t, engine);
  });

  const scheduledEnables = (t: Backend) =>
    t.run(async (ctx) =>
      (await ctx.db.system.query("_scheduled_functions").collect()).filter((job) =>
        job.name.includes("applyEnabledAfterCreate")
      )
    );

  test("switches on each seeded alert once, and never one the streamer paused", async () => {
    const { t, instanceId, engine } = await firstRunEngine();
    await t.action(internal.setupApply.run, { instanceId });
    const alertCount = DEFAULT_ALERT_ITEMS.length;
    await until(() => engine.enableCalls.length === alertCount, "every alert is enabled");
    await until(
      async () =>
        await t.run(async (ctx) => {
          const rows = await ctx.db
            .query("workflows")
            .withIndex("by_engine_id", (q) => q.eq("instanceId", instanceId))
            .collect();
          return rows.length === alertCount && rows.every((row) => row.isEnabled);
        }),
      "the mirror shows every alert on"
    );

    engine.workflows.set("workflow-1", false);
    await t.action(internal.setupApply.run, { instanceId });
    const correlationKey = await t.run(async (ctx) => {
      const row = await ctx.db
        .query("starterPackItems")
        .withIndex("by_instance_item", (q) =>
          q.eq("instanceId", instanceId).eq("packId", DEFAULT_ALERTS_PACK_ID).eq("itemId", "follow")
        )
        .first();
      return row?.correlationKey ?? "";
    });
    await t.mutation(internal.workflowInternal.resolveCorrelation, {
      correlationKey,
      engineWorkflowId: "workflow-1",
      op: "create",
    });

    expect((await scheduledEnables(t)).length).toBe(alertCount);
    expect(engine.enableCalls.length).toBe(alertCount);
    expect(engine.workflows.get("workflow-1")).toBe(false);
  });

  test("an enable the engine refuses is asked again, then given up on", async () => {
    const { t, instanceId, engine } = await firstRunEngine();
    engine.workflows.set("w", false);
    engine.enablesFailing = 4;
    const enable = (failedAttempts: number) =>
      t.action(internal.workflowActions.applyEnabledAfterCreate, {
        instanceId,
        engineWorkflowId: "w",
        isEnabled: true,
        failedAttempts,
      });

    await enable(0);
    const [retry] = await scheduledEnables(t);
    expect(retry?.args[0]).toMatchObject({ engineWorkflowId: "w", isEnabled: true, failedAttempts: 1 });

    await expect(enable(3)).rejects.toThrow("the engine is restarting");
  });

  describe("Try again", () => {
    async function settledFailed() {
      const backend = await firstRunEngine();
      await backend.t.run(async (ctx) => {
        const row = await ctx.db
          .query("instanceSetup")
          .withIndex("by_instance", (q) => q.eq("instanceId", backend.instanceId))
          .first();
        if (row === null) {
          throw new Error("no setup row");
        }
        // Past the last retry delay, so the run settles and leaves no timer behind.
        await ctx.db.patch(row._id, { applyAttempts: 99 });
      });
      return backend;
    }

    test("recovers a seed that settled as failed, keeping what worked and creating nothing twice", async () => {
      const { t, instanceId, ownerId, engine, status } = await settledFailed();
      engine.createsFailing = 3;
      await t.action(internal.setupApply.run, { instanceId });
      const failed = await status();
      expect(failed?.scene.status).toBe("installed");
      expect(failed?.alerts.filter((alert) => alert.status === "failed").length).toBe(3);
      expect(failed?.alerts.filter((alert) => alert.status === "installed").length).toBe(2);
      await until(() => engine.enableCalls.length === 2, "the two that worked are enabled");

      await t.withIdentity({ subject: `${ownerId}|session` }).mutation(api.setup.retryApply, { instanceId });
      expect((await status())?.alerts.some((alert) => alert.status === "failed")).toBe(false);
      await until(
        async () => (await status())?.alerts.every((alert) => alert.status === "installed") === true,
        "every alert is installed"
      );

      expect(engine.scenes.length).toBe(1);
      expect(engine.workflows.size).toBe(DEFAULT_ALERT_ITEMS.length);
      await enablesSettled(t, engine);
    });

    test("recovers from an engine that was failing the reads, once it answers", async () => {
      const { t, instanceId, ownerId, engine, status } = await settledFailed();
      engine.modulesFailing = true;
      await t.action(internal.setupApply.run, { instanceId });
      expect((await status())?.alerts[0]?.status).toBe("failed");
      expect((await status())?.alerts[0]?.error).toBe("the engine is restarting");

      engine.modulesFailing = false;
      await t.withIdentity({ subject: `${ownerId}|session` }).mutation(api.setup.retryApply, { instanceId });
      await until(
        async () => (await status())?.alerts.every((alert) => alert.status === "installed") === true,
        "every alert is installed"
      );

      expect(engine.workflows.size).toBe(DEFAULT_ALERT_ITEMS.length);
      await enablesSettled(t, engine);
    });
  });
});
