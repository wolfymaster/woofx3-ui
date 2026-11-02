import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { newBackend } from "./lib/convexTest.testing";
import { PLACEHOLDER_NAME, slugCandidates } from "./lib/firstRun";
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

describe("first run", () => {
  const ENV_NAMES = ["MAINTENANCE_API_URL", "MAINTENANCE_API_KEY", "CONVEX_SITE_URL"] as const;
  const saved = ENV_NAMES.map((name) => [name, process.env[name]] as const);
  const realFetch = globalThis.fetch;
  /** Create calls the fake maintenance API saw. */
  let creates: { slug: string; key: string | null; twitchChannel?: string }[] = [];
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
      });
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
    await t.run((ctx) =>
      ctx.db.insert("instanceSetup", { instanceId, platforms: [], platformsChosenAt: 1, updatedAt: 1 })
    );
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
    await t.run((ctx) =>
      ctx.db.insert("instanceSetup", { instanceId, platforms: [], platformsChosenAt: 1, updatedAt: 1 })
    );

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
