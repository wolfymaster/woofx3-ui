import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { newBackend } from "./lib/convexTest.testing";
import { PLACEHOLDER_NAME, REQUEST_IN_FLIGHT_MS, slugCandidates } from "./lib/firstRun";
import { hashOpaqueToken } from "./lib/oauthHandoff";

type Backend = ReturnType<typeof newBackend>;

const CODE = "a".repeat(43);

async function newUser(t: Backend): Promise<Id<"users">> {
  return t.run((ctx) => ctx.db.insert("users", { email: "new@example.com" }));
}

/** What the OAuth callback leaves, then what the page claiming it does. */
async function linkTwitch(t: Backend, userId: Id<"users">, instanceId: Id<"instances">) {
  const codeHash = await hashOpaqueToken(CODE);
  await t.mutation(internal.oauthConnectHandoff.store, {
    codeHash,
    provider: "twitch",
    userId,
    instanceId,
    redirectTo: "/setup/connect",
    twitch: {
      platformUserId: "T1",
      platformUsername: "Wolfy_Master",
      login: "wolfy_master",
      sealedAccessToken: "sealed",
      sealedRefreshToken: "sealed",
      expiresAt: 1,
      scopes: [],
    },
  });
  return t.mutation(internal.twitchIntegration.completeConnect, { codeHash, userId });
}

const TWITCH_CONSENT = { marketplaceModuleId: "woofx3_twitch", approvedPermissions: ["chat:read"] };

/** What the connect screen holds on the row `ensureFirstRun` made, as Connect is pressed. */
async function chooseTwitchFor(t: Backend, instanceId: Id<"instances">) {
  await t.run(async (ctx) => {
    const row = await ctx.db
      .query("instanceSetup")
      .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
      .first();
    if (!row) {
      throw new Error("ensureFirstRun should make the setup row");
    }
    await ctx.db.patch(row._id, { pendingPlatforms: [TWITCH_CONSENT] });
  });
}

describe("first run", () => {
  const ENV_NAMES = ["MAINTENANCE_API_URL", "MAINTENANCE_API_KEY", "CONVEX_SITE_URL"] as const;
  const saved = ENV_NAMES.map((name) => [name, process.env[name]] as const);
  const realFetch = globalThis.fetch;
  /** Create calls the fake maintenance API saw. */
  let creates: { slug: string; key: string | null; twitchChannel?: string; registrationToken: string }[] = [];
  /** Slugs whose next create commits and then loses its response, as a dropped connection would. */
  let lostResponses: string[] = [];
  /** Slugs the availability check clears but the create call refuses, as when another signup wins the race. */
  let lostRaces: string[] = [];
  let unavailable: string[] = [];

  beforeEach(() => {
    process.env.MAINTENANCE_API_URL = "https://maintenance.test";
    process.env.MAINTENANCE_API_KEY = "key";
    process.env.CONVEX_SITE_URL = "https://site.test";
    creates = [];
    lostRaces = [];
    unavailable = [];
    lostResponses = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/v1/slugs/")) {
        const slug = decodeURIComponent(url.split("/v1/slugs/")[1].split("?")[0]);
        return Response.json({ available: !unavailable.includes(slug) });
      }
      const body = JSON.parse(String(init?.body));
      creates.push({
        slug: body.slug,
        key: new Headers(init?.headers).get("Idempotency-Key"),
        twitchChannel: body.twitchChannel,
        registrationToken: body.registrationToken,
      });
      if (lostResponses.includes(body.slug)) {
        lostResponses = lostResponses.filter((slug) => slug !== body.slug);
        throw new Error("connection lost");
      }
      if (lostRaces.includes(body.slug)) {
        return Response.json({ error: { code: "slug_taken", message: "taken" } }, { status: 409 });
      }
      return Response.json(
        { engine: { id: "engine-1", publicUrl: null }, run: { id: "run-1", steps: [] } },
        { status: 202 }
      );
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    for (const [name, value] of saved) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  });

  /** Scheduling goes through a zero timer, so scheduled work has only started once one has fired. */
  async function settleScheduled(t: Backend) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await t.finishInProgressScheduledFunctions();
  }

  async function linkedInstance(t: Backend) {
    const userId = await newUser(t);
    const asUser = t.withIdentity({ subject: `${userId}|session` });
    const instanceId = await asUser.mutation(api.setup.ensureFirstRun, {});
    await chooseTwitchFor(t, instanceId);
    await linkTwitch(t, userId, instanceId);
    await settleScheduled(t);
    return instanceId;
  }

  test("the engine starts on link under the login, with the login as its channel", async () => {
    const t = newBackend();
    const instanceId = await linkedInstance(t);

    expect(creates.map(({ slug, twitchChannel }) => ({ slug, twitchChannel }))).toEqual([
      { slug: "wolfy-master", twitchChannel: "wolfy_master" },
    ]);
    const row = await t.query(internal.provisioningInternal.forInstanceInternal, { instanceId });
    expect(row?.status).toBe("provisioning");
  });

  test("a candidate lost to a race moves to the next under a new idempotency key", async () => {
    lostRaces = ["wolfy-master"];
    const t = newBackend();
    const instanceId = await linkedInstance(t);

    expect(creates.map((create) => create.slug)).toEqual(["wolfy-master", "wolfy-master-tv"]);
    expect(creates[0].key).not.toBe(creates[1].key);
    const row = await t.query(internal.provisioningInternal.forInstanceInternal, { instanceId });
    expect(row?.slug).toBe("wolfy-master-tv");
    expect(row?.status).toBe("provisioning");
  });

  test("with every candidate gone the connect screen asks, and naming one clears that", async () => {
    unavailable = slugCandidates("wolfy_master");
    const t = newBackend();
    const instanceId = await linkedInstance(t);

    expect(creates).toEqual([]);
    const setup = await t.run((ctx) =>
      ctx.db
        .query("instanceSetup")
        .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
        .first()
    );
    expect(setup?.usernameNeededAt).toBeDefined();

    const ownerId = await t.run(async (ctx) => {
      const instance = await ctx.db.get(instanceId);
      const account = instance ? await ctx.db.get(instance.accountId) : null;
      return account?.ownerId;
    });
    await t
      .withIdentity({ subject: `${ownerId}|session` })
      .action(api.provisioning.startManagedEngine, { instanceId, slug: "my-pick" });

    expect(creates.map((create) => create.slug)).toEqual(["my-pick"]);
    const after = await t.run((ctx) =>
      ctx.db
        .query("instanceSetup")
        .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
        .first()
    );
    expect(after?.usernameNeededAt).toBeUndefined();
  });

  test("rows exist before Twitch, once however often it is asked", async () => {
    const t = newBackend();
    const userId = await newUser(t);
    const asUser = t.withIdentity({ subject: `${userId}|session` });

    const first = await asUser.mutation(api.setup.ensureFirstRun, {});
    const second = await asUser.mutation(api.setup.ensureFirstRun, {});

    expect(second).toBe(first);
    const instance = await t.run((ctx) => ctx.db.get(first));
    expect(instance?.name).toBe(PLACEHOLDER_NAME);
    expect(instance?.hosting).toBe("managed");
  });

  test("linking names everything and finishes setup, so leaving afterwards strands nothing", async () => {
    const t = newBackend();
    const userId = await newUser(t);
    const asUser = t.withIdentity({ subject: `${userId}|session` });
    const instanceId = await asUser.mutation(api.setup.ensureFirstRun, {});
    await chooseTwitchFor(t, instanceId);

    expect((await linkTwitch(t, userId, instanceId)).ok).toBe(true);

    const facts = await t.run(async (ctx) => {
      const instance = await ctx.db.get(instanceId);
      return {
        instance: instance?.name,
        account: instance ? (await ctx.db.get(instance.accountId))?.name : null,
        user: (await ctx.db.get(userId))?.name,
        setup: await ctx.db
          .query("instanceSetup")
          .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
          .first(),
        link: await ctx.db
          .query("platformLinks")
          .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
          .first(),
      };
    });
    expect(facts.instance).toBe("Wolfy_Master's Instance");
    expect(facts.account).toBe("Wolfy_Master");
    expect(facts.user).toBe("Wolfy_Master");
    expect(facts.setup?.completedAt).toBeDefined();
    expect(facts.link?.platformLogin).toBe("wolfy_master");
    await settleScheduled(t);
  });

  test("the user's own engine form takes over the empty managed row", async () => {
    const t = newBackend();
    const userId = await newUser(t);
    const asUser = t.withIdentity({ subject: `${userId}|session` });
    const instanceId = await asUser.mutation(api.setup.ensureFirstRun, {});
    const accountId = await asUser.mutation(api.accounts.ensureMyAccount, {});

    const created = await asUser.mutation(api.instances.create, {
      accountId,
      name: PLACEHOLDER_NAME,
      url: "engine.example.com",
    });

    expect(created).toBe(instanceId);
    const instance = await t.run((ctx) => ctx.db.get(instanceId));
    expect(instance?.hosting).toBe("external");
  });

  /** A long-running engine whose setup was never finished: the row an abandoned wizard left. */
  async function establishedInstance(t: Backend, setup: { platformsChosenAt?: number } = { platformsChosenAt: 1 }) {
    return t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", { email: "streamer@example.com", name: "Streamer" });
      const accountId = await ctx.db.insert("accounts", { name: "Streamer", ownerId: userId, createdAt: 1 });
      const instanceId = await ctx.db.insert("instances", {
        accountId,
        name: "Streamer's Instance",
        url: "https://engine.example",
        hosting: "managed",
        clientId: "client",
        clientSecret: "secret",
        createdAt: 1,
      });
      await ctx.db.insert("instanceMembers", { instanceId, userId, role: "owner" });
      await ctx.db.insert("instanceSetup", { instanceId, platforms: [], updatedAt: 1, ...setup });
      return { userId, instanceId };
    });
  }

  function setupOf(t: Backend, instanceId: Id<"instances">) {
    return t.run((ctx) =>
      ctx.db
        .query("instanceSetup")
        .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
        .first()
    );
  }

  test("reconnecting Twitch on an established instance leaves setup unfinished and unseeded", async () => {
    const t = newBackend();
    const { userId, instanceId } = await establishedInstance(t);

    expect((await linkTwitch(t, userId, instanceId)).ok).toBe(true);

    expect((await setupOf(t, instanceId))?.completedAt).toBeUndefined();
    const status = await t.withIdentity({ subject: `${userId}|session` }).query(api.setup.status, { instanceId });
    expect(status?.overlayPending).toBe(false);
  });

  test("finishing an established instance's setup by hand neither seeds nor owes the overlay page", async () => {
    const t = newBackend();
    const { userId, instanceId } = await establishedInstance(t);
    await linkTwitch(t, userId, instanceId);
    const asUser = t.withIdentity({ subject: `${userId}|session` });

    await asUser.mutation(api.setup.complete, { instanceId, platforms: [] });

    expect((await asUser.query(api.setup.status, { instanceId }))?.overlayPending).toBe(false);
    expect((await t.mutation(internal.setupApply.claim, { instanceId }))?.seedsDefaults).toBe(false);
  });

  test("a new managed instance seeds and owes the overlay page once it finishes", async () => {
    const t = newBackend();
    const userId = await newUser(t);
    const asUser = t.withIdentity({ subject: `${userId}|session` });
    const instanceId = await asUser.mutation(api.setup.ensureFirstRun, {});
    await chooseTwitchFor(t, instanceId);

    await linkTwitch(t, userId, instanceId);
    await t.run((ctx) => ctx.db.patch(instanceId, { clientId: "client", clientSecret: "secret" }));

    expect((await asUser.query(api.setup.status, { instanceId }))?.overlayPending).toBe(true);
    expect((await t.mutation(internal.setupApply.claim, { instanceId }))?.seedsDefaults).toBe(true);
    await settleScheduled(t);
  });

  test("an account's first engine through the form is a first run, as a preview's paired engine is", async () => {
    const t = newBackend();
    const userId = await newUser(t);
    const asUser = t.withIdentity({ subject: `${userId}|session` });
    const accountId = await asUser.mutation(api.accounts.ensureMyAccount, {});

    const instanceId = await asUser.mutation(api.instances.create, { accountId, name: "Mine", url: "engine.test" });

    expect((await setupOf(t, instanceId))?.firstRunAt).toBeDefined();
  });

  test("the form's takeover of the managed placeholder stays a first run", async () => {
    const t = newBackend();
    const userId = await newUser(t);
    const asUser = t.withIdentity({ subject: `${userId}|session` });
    const placeholder = await asUser.mutation(api.setup.ensureFirstRun, {});
    const accountId = await asUser.mutation(api.accounts.ensureMyAccount, {});

    const instanceId = await asUser.mutation(api.instances.create, { accountId, name: "Mine", url: "engine.test" });

    expect(instanceId).toBe(placeholder);
    expect((await setupOf(t, instanceId))?.firstRunAt).toBeDefined();
  });

  test("another instance beside a registered one is not a first run", async () => {
    const t = newBackend();
    const { userId, instanceId: established } = await establishedInstance(t);
    const account = await t.run(async (ctx) => (await ctx.db.get(established))?.accountId);
    if (!account) {
      throw new Error("the established instance should have an account");
    }

    const instanceId = await t
      .withIdentity({ subject: `${userId}|session` })
      .mutation(api.instances.create, { accountId: account, name: "Second", url: "second.test" });

    expect(await setupOf(t, instanceId)).toBeNull();
    expect((await setupOf(t, established))?.firstRunAt).toBeUndefined();
  });

  describe("consent", () => {
    test("pressing Connect records nothing until Twitch approves", async () => {
      const t = newBackend();
      const userId = await newUser(t);
      const instanceId = await t.withIdentity({ subject: `${userId}|session` }).mutation(api.setup.ensureFirstRun, {});

      await chooseTwitchFor(t, instanceId);
      const denied = await setupOf(t, instanceId);
      expect(denied?.platformsChosenAt).toBeUndefined();
      expect(denied?.platforms).toEqual([]);

      await linkTwitch(t, userId, instanceId);
      const approved = await setupOf(t, instanceId);
      expect(approved?.platforms).toEqual([TWITCH_CONSENT]);
      expect(approved?.platformsChosenAt).toBeDefined();
      expect(approved?.pendingPlatforms).toBeUndefined();
      await settleScheduled(t);
    });

    test("reconnecting a finished setup keeps every chosen platform and applies nothing", async () => {
      const t = newBackend();
      const { userId, instanceId } = await establishedInstance(t);
      const platforms = [TWITCH_CONSENT, { marketplaceModuleId: "other", approvedPermissions: [] }];
      await t.run(async (ctx) => {
        const row = await ctx.db
          .query("instanceSetup")
          .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
          .first();
        await ctx.db.patch(row?._id as Id<"instanceSetup">, { platforms, completedAt: 1, moduleInstalls: [] });
      });
      const asUser = t.withIdentity({ subject: `${userId}|session` });

      await asUser.mutation(api.setup.prepareConnect, { instanceId, platforms: [TWITCH_CONSENT] });
      await linkTwitch(t, userId, instanceId);

      expect((await setupOf(t, instanceId))?.platforms).toEqual(platforms);
      const scheduled = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
      expect(scheduled.filter((job) => job.name.includes("setupApply"))).toEqual([]);
    });

    test("a setup that waited on the link applies when it comes back", async () => {
      const t = newBackend();
      const { userId, instanceId } = await establishedInstance(t);
      await t.run(async (ctx) => {
        const row = await ctx.db
          .query("instanceSetup")
          .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
          .first();
        await ctx.db.patch(row?._id as Id<"instanceSetup">, { completedAt: 1 });
      });

      await linkTwitch(t, userId, instanceId);

      const scheduled = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
      expect(scheduled.filter((job) => job.name.includes("setupApply")).length).toBe(1);
    });

    test("nothing applies without the link, by retry or by claim", async () => {
      const t = newBackend();
      const { userId, instanceId } = await establishedInstance(t);

      await expect(
        t.withIdentity({ subject: `${userId}|session` }).mutation(api.setup.retryApply, { instanceId })
      ).rejects.toThrow("Connect Twitch");
      expect(await t.mutation(internal.setupApply.claim, { instanceId })).toBeNull();
    });

    test("a preview's skip applies without a link and keeps a choice already made", async () => {
      process.env.PREVIEW_DEPLOYMENT = "true";
      try {
        const t = newBackend();
        const { userId, instanceId } = await establishedInstance(t);
        const platforms = [TWITCH_CONSENT];
        await t.run(async (ctx) => {
          const row = await ctx.db
            .query("instanceSetup")
            .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
            .first();
          await ctx.db.patch(row?._id as Id<"instanceSetup">, { platforms });
        });

        await t
          .withIdentity({ subject: `${userId}|session` })
          .mutation(api.setup.skipTwitch, { instanceId, platforms: [] });

        expect((await setupOf(t, instanceId))?.platforms).toEqual(platforms);
        expect(await t.mutation(internal.setupApply.claim, { instanceId })).not.toBeNull();
      } finally {
        delete process.env.PREVIEW_DEPLOYMENT;
      }
    });
  });

  describe("a first engine request that died", () => {
    async function ownerWithInstance(t: Backend) {
      const userId = await newUser(t);
      const asUser = t.withIdentity({ subject: `${userId}|session` });
      const instanceId = await asUser.mutation(api.setup.ensureFirstRun, {});
      await t.run((ctx) =>
        ctx.db.insert("platformLinks", {
          instanceId,
          platform: "twitch",
          platformUserId: "T1",
          platformUsername: "Wolfy_Master",
          platformLogin: "wolfy_master",
          channelId: "T1",
          sealedAccessToken: "sealed",
          sealedRefreshToken: "sealed",
          expiresAt: 1,
          scopes: [],
        })
      );
      return { asUser, instanceId };
    }

    test("with no row, Try again makes one", async () => {
      const t = newBackend();
      const { asUser, instanceId } = await ownerWithInstance(t);

      await asUser.action(api.provisioning.retry, { instanceId });

      const row = await t.query(internal.provisioningInternal.forInstanceInternal, { instanceId });
      expect(row?.status).toBe("provisioning");
      expect(creates.map((create) => create.slug)).toEqual(["wolfy-master"]);
    });

    test("with a stale requested row, Try again takes it over; a fresh one is still in flight", async () => {
      const t = newBackend();
      const { asUser, instanceId } = await ownerWithInstance(t);
      const insertRequested = (updatedAt: number) =>
        t.run(async (ctx) => {
          const instance = await ctx.db.get(instanceId);
          if (!instance) {
            throw new Error("the instance should exist");
          }
          await ctx.db.insert("engineProvisioning", {
            instanceId,
            accountId: instance.accountId,
            requestedBy: (await ctx.db.get(instance.accountId))?.ownerId as Id<"users">,
            slug: "wolfy-master",
            status: "requested",
            steps: [],
            registrationToken: "token",
            registrationAttempts: 0,
            createdAt: updatedAt,
            updatedAt,
          });
        });

      await insertRequested(Date.now());
      await expect(asUser.action(api.provisioning.retry, { instanceId })).rejects.toThrow("already being created");
      await t.run(async (ctx) => {
        const row = await ctx.db
          .query("engineProvisioning")
          .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
          .first();
        await ctx.db.patch(row?._id as Id<"engineProvisioning">, { updatedAt: Date.now() - REQUEST_IN_FLIGHT_MS });
      });

      await asUser.action(api.provisioning.retry, { instanceId });

      const row = await t.query(internal.provisioningInternal.forInstanceInternal, { instanceId });
      expect(row?.status).toBe("provisioning");
    });

    test("an engine the user runs has its registration tried again, with the reason it failed", async () => {
      const t = newBackend();
      const { asUser, instanceId } = await ownerWithInstance(t);
      await t.run((ctx) => ctx.db.patch(instanceId, { hosting: "external" }));

      await expect(asUser.action(api.provisioning.retry, { instanceId })).rejects.toThrow("The engine has no URL yet");
    });
  });

  describe("a create response that was lost", () => {
    async function linkedAfterLoss(t: Backend) {
      lostResponses = ["wolfy-master"];
      const instanceId = await linkedInstance(t).catch(() => undefined);
      if (!instanceId) {
        throw new Error("the failure belongs on the row, not the link");
      }
      const ownerId = await t.run(async (ctx) => {
        const instance = await ctx.db.get(instanceId);
        return instance ? (await ctx.db.get(instance.accountId))?.ownerId : undefined;
      });
      return { instanceId, owner: t.withIdentity({ subject: `${ownerId}|session` }) };
    }

    test("Try again asks with the same key and body, though the slug now reads as taken", async () => {
      const t = newBackend();
      const { instanceId, owner } = await linkedAfterLoss(t);
      expect((await t.query(internal.provisioningInternal.forInstanceInternal, { instanceId }))?.status).toBe("failed");
      unavailable = ["wolfy-master"];

      await owner.action(api.provisioning.retry, { instanceId });

      expect(creates.map((create) => create.slug)).toEqual(["wolfy-master", "wolfy-master"]);
      expect(creates[1].key).toBe(creates[0].key);
      expect(creates[1].registrationToken).toBe(creates[0].registrationToken);
      const row = await t.query(internal.provisioningInternal.forInstanceInternal, { instanceId });
      expect(row?.status).toBe("provisioning");
      expect(row?.registrationToken).toBe(creates[0].registrationToken);
    });

    test("a refusal on asking again moves to the next candidate under a new key", async () => {
      const t = newBackend();
      const { instanceId, owner } = await linkedAfterLoss(t);
      lostRaces = ["wolfy-master"];

      await owner.action(api.provisioning.retry, { instanceId });

      expect(creates.map((create) => create.slug)).toEqual(["wolfy-master", "wolfy-master", "wolfy-master-tv"]);
      expect(creates[2].key).not.toBe(creates[0].key);
    });

    test("a slug refused earlier can be asked for afresh, since the refusal closed its request", async () => {
      const t = newBackend();
      lostRaces = ["wolfy-master"];
      unavailable = slugCandidates("wolfy_master").slice(1);
      const instanceId = await linkedInstance(t);
      lostRaces = [];
      const ownerId = await t.run(async (ctx) => {
        const instance = await ctx.db.get(instanceId);
        return instance ? (await ctx.db.get(instance.accountId))?.ownerId : undefined;
      });

      await t
        .withIdentity({ subject: `${ownerId}|session` })
        .action(api.provisioning.startManagedEngine, { instanceId, slug: "wolfy-master" });

      expect(creates.map((create) => create.slug)).toEqual(["wolfy-master", "wolfy-master"]);
      expect(creates[1].key).not.toBe(creates[0].key);
    });

    test("the engine's own callback finds the row without any retry", async () => {
      const t = newBackend();
      const { instanceId } = await linkedAfterLoss(t);

      await t.mutation(internal.provisioningInternal.applyCallbackEvent, {
        eventId: "event-1",
        eventType: "engine.run.step",
        maintenanceEngineId: "engine-lost",
        externalRef: instanceId,
        runKind: "provision",
        step: "database",
        stepStatus: "running",
      });

      const row = await t.query(internal.provisioningInternal.forInstanceInternal, { instanceId });
      expect(row?.maintenanceEngineId).toBe("engine-lost");
      expect(row?.status).toBe("provisioning");
      expect(row?.steps.map((step) => step.key)).toEqual(["database"]);
    });

    test("a teardown of some older engine is not taken for the open request's", async () => {
      const t = newBackend();
      const { instanceId } = await linkedAfterLoss(t);

      await t.mutation(internal.provisioningInternal.applyCallbackEvent, {
        eventId: "event-1",
        eventType: "engine.deleted",
        maintenanceEngineId: "engine-old",
        externalRef: instanceId,
        runKind: "deprovision",
      });

      const row = await t.query(internal.provisioningInternal.forInstanceInternal, { instanceId });
      expect(row?.maintenanceEngineId).toBeUndefined();
      expect(row?.status).toBe("failed");
    });
  });

  describe("an apply run that died holding its claim", () => {
    async function claimed(t: Backend, applyAttempts: number) {
      const userId = await newUser(t);
      const instanceId = await t.withIdentity({ subject: `${userId}|session` }).mutation(api.setup.ensureFirstRun, {});
      await t.run(async (ctx) => {
        const row = await ctx.db
          .query("instanceSetup")
          .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
          .first();
        await ctx.db.patch(row?._id as Id<"instanceSetup">, { applyClaimedAt: 5, applyAttempts });
      });
      return instanceId;
    }

    const scheduledRuns = (t: Backend) =>
      t.run(async (ctx) =>
        (await ctx.db.system.query("_scheduled_functions").collect()).filter((job) => job.name.includes("setupApply"))
      );

    test("another run is scheduled while tries remain", async () => {
      const t = newBackend();
      const instanceId = await claimed(t, 1);

      await t.mutation(internal.setupApply.recoverDiedRun, { instanceId, claimedAt: 5 });

      expect((await scheduledRuns(t)).length).toBe(1);
    });

    test("with no tries left the seed fails, so the overlay page offers Try again", async () => {
      const t = newBackend();
      const instanceId = await claimed(t, 99);

      await t.mutation(internal.setupApply.recoverDiedRun, { instanceId, claimedAt: 5 });

      const setup = await t.run((ctx) =>
        ctx.db
          .query("instanceSetup")
          .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
          .first()
      );
      expect(setup?.defaultSeed?.scene.status).toBe("failed");
      expect(setup?.applyClaimedAt).toBeUndefined();
    });

    test("a run that finished, or a later claim, is left alone", async () => {
      const t = newBackend();
      const instanceId = await claimed(t, 1);

      await t.mutation(internal.setupApply.recoverDiedRun, { instanceId, claimedAt: 4 });

      expect((await scheduledRuns(t)).length).toBe(0);
    });
  });

  test("skipping Twitch is refused outside a preview", async () => {
    const t = newBackend();
    const userId = await newUser(t);
    const asUser = t.withIdentity({ subject: `${userId}|session` });
    const instanceId = await asUser.mutation(api.setup.ensureFirstRun, {});

    await expect(asUser.mutation(api.setup.skipTwitch, { instanceId, platforms: [] })).rejects.toThrow(
      "Twitch cannot be skipped here"
    );
  });
});
