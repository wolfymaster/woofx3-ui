import { describe, expect, test } from "bun:test";
import {
  defaultPageContent,
  type PageContent,
  type PageSection,
  type PublicPageLookup,
  type SectionVisibility,
} from "@shared/user-pages";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { generateOpaqueToken, hashOpaqueToken } from "./lib/oauthHandoff";
import { COUNTER, type Fixture, type FixtureOptions, fixture } from "./lib/userPages.fixtures";

const SECRET = "woofx3:counter:secret";

const counterWidget = (id: string, resource: string) =>
  ({ id, type: "counter", config: { resource, label: "Deaths", showGoals: true } }) as const;

function content(sections: PageSection[]): PageContent {
  return { ...defaultPageContent(), sections };
}

const PUBLIC_COUNTER: PageSection = {
  id: "stats",
  region: "main",
  visibility: { kind: "public" },
  widgets: [counterWidget("deaths", COUNTER)],
};

const SUBSCRIBER_SECRET: PageSection = {
  id: "subs",
  region: "main",
  title: "For subs",
  visibility: { kind: "subscriber" },
  widgets: [counterWidget("secret", SECRET), { id: "note", type: "text", config: { markdown: "subs only" } }],
};

/** A fixture with a second counter, `SECRET`, and stored values for both counters. */
async function seeded(options: FixtureOptions = {}): Promise<Fixture> {
  const f = await fixture(options);
  await f.t.run(async (ctx) => {
    const module = await ctx.db.query("moduleRepository").first();
    if (!module) {
      throw new Error("fixture has no module");
    }
    await ctx.db.insert("moduleResourceInstances", {
      instanceId: f.instanceId,
      moduleId: module._id,
      engineInstanceId: "uuid-2",
      resourceInstanceId: "secret",
      moduleName: "woofx3",
      kind: "counter",
      displayName: "Secret",
      canonicalId: SECRET,
      settings: { initialValue: 7, lifetime: "session" },
    });
  });
  await f.t.mutation(internal.resourceValues.upsertMany, {
    instanceId: f.instanceId,
    values: { [COUNTER]: { value: 3, reached: {} }, [SECRET]: 4242 },
  });
  return f;
}

async function publishContent(f: Fixture, page: PageContent): Promise<void> {
  const before = await f.owner.query(api.userPages.forEditing, { instanceId: f.instanceId });
  const { revision } = await f.owner.mutation(api.userPages.saveDraft, {
    instanceId: f.instanceId,
    baseRevision: before?.draft.revision ?? 0,
    content: page,
  });
  await f.owner.mutation(api.userPages.publish, { instanceId: f.instanceId, revision });
}

async function lookup(f: Fixture, slug = "wolfy", sessionToken?: string): Promise<PublicPageLookup> {
  return f.t.query(api.userPagesPublic.bySlug, sessionToken === undefined ? { slug } : { slug, sessionToken });
}

async function shownPage(f: Fixture, sessionToken?: string): Promise<Extract<PublicPageLookup, { kind: "page" }>> {
  const result = await lookup(f, "wolfy", sessionToken);
  if (result.kind !== "page") {
    throw new Error(`expected a page, got ${result.kind}`);
  }
  return result;
}

/** The first widget of the page's first section, which the test expects to be open. */
function firstWidget(page: Extract<PublicPageLookup, { kind: "page" }>) {
  const section = page.sections[0];
  if (section?.kind !== "open") {
    throw new Error("expected the first section to be open");
  }
  return section.widgets[0];
}

function counterState(page: Extract<PublicPageLookup, { kind: "page" }>) {
  const widget = firstWidget(page);
  if (widget?.type !== "counter") {
    throw new Error("expected the first widget to be the counter");
  }
  return widget.state;
}

describe("bySlug", () => {
  test("serves the published page by its slug, in any case", async () => {
    const f = await seeded();
    await publishContent(f, content([PUBLIC_COUNTER]));
    for (const slug of ["wolfy", " Wolfy "]) {
      const result = await lookup(f, slug);
      expect(result).toMatchObject({
        kind: "page",
        slug: "wolfy",
        layout: "single",
        theme: { accent: "violet" },
        sections: [
          {
            id: "stats",
            widgets: [
              {
                id: "deaths",
                type: "counter",
                config: { label: "Deaths", showGoals: true },
                state: { kind: "woofx3:counter", value: { value: 3, reached: {} }, settings: {} },
              },
            ],
          },
        ],
      });
    }
  });

  test.each([
    ["a slug no engine has", "nobody"],
    ["an empty slug", "  "],
    ["a slug too long to be one", "x".repeat(64)],
  ])("answers %s as unclaimed", async (_name, slug) => {
    const f = await seeded();
    expect(await lookup(f, slug)).toEqual({ kind: "unclaimed" });
  });

  test("answers a slug whose engine was deleted as unclaimed", async () => {
    const f = await seeded();
    await publishContent(f, content([PUBLIC_COUNTER]));
    await f.t.run(async (ctx) => {
      const row = await ctx.db.query("engineProvisioning").first();
      if (row) {
        await ctx.db.patch(row._id, { status: "deleted" });
      }
    });
    expect(await lookup(f)).toEqual({ kind: "unclaimed" });
  });

  test("answers an engine that never published as unavailable", async () => {
    const f = await seeded();
    expect(await lookup(f)).toEqual({ kind: "unavailable" });
  });

  test("answers an unpublished page as unavailable, and keeps its draft", async () => {
    const f = await seeded();
    await publishContent(f, content([PUBLIC_COUNTER]));
    await f.owner.mutation(api.userPages.unpublish, { instanceId: f.instanceId });
    expect(await lookup(f)).toEqual({ kind: "unavailable" });
    const editing = await f.owner.query(api.userPages.forEditing, { instanceId: f.instanceId });
    expect(editing?.draft.content).toEqual(content([PUBLIC_COUNTER]));
  });

  test("answers an external engine whose plan lapsed as unavailable, and serves it again once renewed", async () => {
    const f = await seeded({ hosting: "external", entitled: true });
    await publishContent(f, content([PUBLIC_COUNTER]));
    const setFeatures = (features: string[]) =>
      f.t.run(async (ctx) => {
        const plan = await ctx.db.query("plans").first();
        if (plan) {
          await ctx.db.patch(plan._id, { features });
        }
      });
    await setFeatures([]);
    expect(await lookup(f)).toEqual({ kind: "unavailable" });
    await setFeatures(["userPages"]);
    expect((await lookup(f)).kind).toBe("page");
  });

  test("serves a managed engine's page whatever its plan", async () => {
    const f = await seeded({ hosting: "managed", entitled: false });
    await publishContent(f, content([PUBLIC_COUNTER]));
    expect((await lookup(f)).kind).toBe("page");
  });

  test("shows an anonymous visitor a gated section only as its requirement, and none of what it binds", async () => {
    const f = await seeded();
    await publishContent(f, content([PUBLIC_COUNTER, SUBSCRIBER_SECRET]));
    const page = await shownPage(f);
    expect(page.sections).toMatchObject([
      { kind: "open", id: "stats" },
      { kind: "locked", region: "main", requirement: { kind: "subscriber" }, reason: "sign_in" },
    ]);
    expect(Object.keys(page.sections[1] ?? {}).sort()).toEqual(["kind", "reason", "region", "requirement"]);
    expect(page.rolesStale).toBe(false);
    const json = JSON.stringify(page);
    expect(json).not.toContain("4242");
    expect(json).not.toContain("subs only");
    expect(json).not.toContain("For subs");
    expect(json).not.toContain('"subs"');
  });

  test("never names the account, the instance or a resource", async () => {
    const f = await seeded();
    await publishContent(f, content([PUBLIC_COUNTER]));
    const json = JSON.stringify(await shownPage(f));
    expect(json).not.toContain(f.instanceId);
    expect(json).not.toContain(f.accountId);
    expect(json).not.toContain("woofx3:counter:");
    expect(json).not.toContain("eng_1");
  });

  test("shows only the live facts the widget is set to show", async () => {
    const f = await seeded();
    await publishContent(
      f,
      content([
        {
          id: "live",
          region: "main",
          visibility: { kind: "public" },
          widgets: [
            { id: "status", type: "live-status", config: { showTitle: true, showGame: false, showViewerCount: false } },
          ],
        },
      ])
    );
    await f.t.run(async (ctx) => {
      await ctx.db.insert("instanceLiveState", {
        instanceId: f.instanceId,
        isLive: true,
        streamTitle: "Deathless run",
        gameName: "Elden Ring",
        viewerCount: 50,
        lastUpdateSource: "webhook",
        lastUpdatedAt: 1,
      });
    });
    const page = await shownPage(f);
    expect(firstWidget(page)).toMatchObject({ live: { isLive: true, title: "Deathless run" } });
    expect(JSON.stringify(page)).not.toContain("Elden Ring");
  });
});

describe("the published values", () => {
  async function stateRows(f: Fixture) {
    return f.t.run(async (ctx) => ctx.db.query("userPageState").take(100));
  }

  test("hold a row for each resource the published page binds, and no other", async () => {
    const f = await seeded();
    await publishContent(f, content([PUBLIC_COUNTER]));
    expect((await stateRows(f)).map((row) => row.canonicalId)).toEqual([COUNTER]);
  });

  test("follow the storage-changed webhook for a bound resource", async () => {
    const f = await seeded();
    await publishContent(f, content([PUBLIC_COUNTER]));
    await f.t.mutation(internal.resourceValues.upsert, {
      instanceId: f.instanceId,
      canonicalId: COUNTER,
      value: { value: 9, reached: {} },
    });
    expect(counterState(await shownPage(f))?.value).toEqual({ value: 9, reached: {} });
  });

  test("ignore the webhook for a resource no published page binds", async () => {
    const f = await seeded();
    await publishContent(f, content([PUBLIC_COUNTER]));
    await f.t.mutation(internal.resourceValues.upsert, { instanceId: f.instanceId, canonicalId: SECRET, value: 1 });
    expect((await stateRows(f)).map((row) => row.canonicalId)).toEqual([COUNTER]);
  });

  test("follow a resource's settings, keeping only those a visitor needs", async () => {
    const f = await seeded();
    await publishContent(f, content([PUBLIC_COUNTER]));
    await f.t.mutation(internal.moduleResourceInstances.upsertFromWebhook, {
      instanceId: f.instanceId,
      instance: {
        id: "uuid-1",
        moduleId: "engine-module",
        moduleName: "woofx3",
        kind: "counter",
        instanceId: "deaths",
        displayName: "Deaths",
        canonicalId: COUNTER,
        moduleKey: "woofx3:1:abc",
        settings: { initialValue: 10, goals: [{ value: 50, name: "Fifty" }], lifetime: "session" },
      },
    });
    expect(counterState(await shownPage(f))?.settings).toEqual({
      initialValue: 10,
      goals: [{ value: 50, name: "Fifty" }],
    });
  });

  test("are rebuilt on publish and dropped when the page goes offline", async () => {
    const f = await seeded();
    await publishContent(f, content([PUBLIC_COUNTER, SUBSCRIBER_SECRET]));
    expect((await stateRows(f)).map((row) => row.canonicalId).sort()).toEqual([COUNTER, SECRET].sort());
    await publishContent(f, content([SUBSCRIBER_SECRET]));
    expect((await stateRows(f)).map((row) => row.canonicalId)).toEqual([SECRET]);
    await f.owner.mutation(api.userPages.unpublish, { instanceId: f.instanceId });
    expect(await stateRows(f)).toEqual([]);
  });

  test("pass a timer's stored shape through untouched", async () => {
    const f = await seeded();
    const TIMER = "woofx3:timer:break";
    await f.t.run(async (ctx) => {
      const module = await ctx.db.query("moduleRepository").first();
      if (!module) {
        throw new Error("fixture has no module");
      }
      await ctx.db.insert("moduleResourceInstances", {
        instanceId: f.instanceId,
        moduleId: module._id,
        engineInstanceId: "uuid-3",
        resourceInstanceId: "break",
        moduleName: "woofx3",
        kind: "timer",
        displayName: "Break",
        canonicalId: TIMER,
        settings: { duration: 300, lifetime: "forever" },
      });
    });
    await publishContent(
      f,
      content([
        {
          id: "t",
          region: "main",
          visibility: { kind: "public" },
          widgets: [{ id: "break", type: "timer", config: { resource: TIMER } }],
        },
      ])
    );
    const running = { running: true, endsAt: 1_900_000_000_000 };
    await f.t.mutation(internal.resourceValues.upsert, {
      instanceId: f.instanceId,
      canonicalId: TIMER,
      value: running,
    });
    expect(firstWidget(await shownPage(f))).toEqual({
      id: "break",
      type: "timer",
      config: {},
      state: { kind: "woofx3:timer", value: running, settings: { duration: 300 } },
    });
  });
});

const BROADCASTER = "B1";

/** Links the fixture's instance to a Twitch channel, as onboarding does. */
async function linkChannel(f: Fixture, platform = "twitch"): Promise<void> {
  await f.t.run(async (ctx) => {
    await ctx.db.insert("platformLinks", {
      instanceId: f.instanceId,
      platform,
      platformUserId: BROADCASTER,
      platformUsername: "wolfy",
      channelId: BROADCASTER,
      accessToken: "streamer-access",
      refreshToken: "streamer-refresh",
      expiresAt: 1,
      scopes: [],
    });
  });
}

interface SignedInViewer {
  viewerId: Id<"viewers">;
  sessionToken: string;
}

async function signInViewer(f: Fixture): Promise<SignedInViewer> {
  const sessionToken = generateOpaqueToken();
  const tokenHash = await hashOpaqueToken(sessionToken);
  const viewerId = await f.t.run(async (ctx) => {
    const id = await ctx.db.insert("viewers", {
      platform: "twitch",
      platformUserId: "V1",
      login: "viewer",
      displayName: "Viewer",
      updatedAt: 1,
    });
    await ctx.db.insert("viewerSessions", { tokenHash, viewerId: id, origin: "https://woofx3.tv", expiresAt: 1 });
    return id;
  });
  return { viewerId, sessionToken };
}

async function cacheRoles(
  f: Fixture,
  viewer: SignedInViewer,
  roles: { follower: boolean; subscriberTier: 1 | 2 | 3 | null }
): Promise<Id<"viewerRoles">> {
  return f.t.run(async (ctx) =>
    ctx.db.insert("viewerRoles", {
      viewerId: viewer.viewerId,
      platform: "twitch",
      broadcasterPlatformUserId: BROADCASTER,
      checkedAt: 1,
      ...roles,
    })
  );
}

function gated(visibility: SectionVisibility): PageSection {
  return {
    id: "secret-giveaway",
    region: "main",
    title: "Secret giveaway code",
    visibility,
    widgets: [counterWidget("secret", SECRET), { id: "note", type: "text", config: { markdown: "the code is HOWL" } }],
  };
}

/** Everything a gated section holds that must not reach a viewer who may not see it. */
const GATED_CONTENT = ["4242", "HOWL", "Secret giveaway code", "secret-giveaway", '"note"'];

function expectNoGatedContent(page: Extract<PublicPageLookup, { kind: "page" }>): void {
  const json = JSON.stringify(page);
  for (const fragment of GATED_CONTENT) {
    expect(json).not.toContain(fragment);
  }
}

type ViewerState =
  | "anonymous"
  | "invalid token"
  | "signed out"
  | "signed in, no roles cached"
  | "signed in, channel not linked"
  | "not following"
  | "follower"
  | "tier 1"
  | "tier 2"
  | "tier 3";

/** Sets up `state` on a fixture whose page is already published, returning the token to read with. */
async function arrange(f: Fixture, state: ViewerState): Promise<string | undefined> {
  if (state === "anonymous") {
    return undefined;
  }
  if (state === "invalid token") {
    return generateOpaqueToken();
  }
  if (state !== "signed in, channel not linked") {
    await linkChannel(f);
  }
  const viewer = await signInViewer(f);
  switch (state) {
    case "signed out":
      await f.t.mutation(api.viewerSession.signOut, { sessionToken: viewer.sessionToken });
      break;
    case "signed in, no roles cached":
    case "signed in, channel not linked":
      break;
    case "not following":
      await cacheRoles(f, viewer, { follower: false, subscriberTier: null });
      break;
    case "follower":
      await cacheRoles(f, viewer, { follower: true, subscriberTier: null });
      break;
    case "tier 1":
      await cacheRoles(f, viewer, { follower: false, subscriberTier: 1 });
      break;
    case "tier 2":
      await cacheRoles(f, viewer, { follower: true, subscriberTier: 2 });
      break;
    case "tier 3":
      await cacheRoles(f, viewer, { follower: true, subscriberTier: 3 });
      break;
  }
  return viewer.sessionToken;
}

type Outcome = "open" | "sign_in" | "roles_unknown" | "not_eligible" | "unverifiable";

const VISIBILITIES: [string, SectionVisibility][] = [
  ["signed_in", { kind: "signed_in" }],
  ["follower", { kind: "follower" }],
  ["subscriber", { kind: "subscriber" }],
  ["tier 2", { kind: "tier", level: 2 }],
];

// Columns follow VISIBILITIES: signed_in, follower, subscriber, tier 2.
const OUTCOMES: Record<ViewerState, Outcome[]> = {
  anonymous: ["sign_in", "sign_in", "sign_in", "sign_in"],
  "invalid token": ["sign_in", "sign_in", "sign_in", "sign_in"],
  "signed out": ["sign_in", "sign_in", "sign_in", "sign_in"],
  "signed in, no roles cached": ["open", "roles_unknown", "roles_unknown", "roles_unknown"],
  "signed in, channel not linked": ["open", "unverifiable", "unverifiable", "unverifiable"],
  "not following": ["open", "not_eligible", "not_eligible", "not_eligible"],
  follower: ["open", "open", "not_eligible", "not_eligible"],
  "tier 1": ["open", "not_eligible", "open", "not_eligible"],
  "tier 2": ["open", "open", "open", "open"],
  "tier 3": ["open", "open", "open", "open"],
};

describe("bySlug for a viewer", () => {
  for (const [state, outcomes] of Object.entries(OUTCOMES) as [ViewerState, Outcome[]][]) {
    VISIBILITIES.forEach(([visibilityName, visibility], column) => {
      const outcome = outcomes[column];
      test(`a ${visibilityName} section for ${state} is ${outcome}`, async () => {
        const f = await seeded();
        await publishContent(f, content([PUBLIC_COUNTER, gated(visibility)]));
        const page = await shownPage(f, await arrange(f, state));
        expect(page.sections[0]).toMatchObject({ kind: "open", id: "stats" });
        if (outcome === "open") {
          expect(page.sections[1]).toMatchObject({
            kind: "open",
            id: "secret-giveaway",
            title: "Secret giveaway code",
            widgets: [{ id: "secret", state: { value: 4242 } }, { id: "note" }],
          });
        } else {
          expect(page.sections[1]).toEqual({
            kind: "locked",
            region: "main",
            requirement: visibility,
            reason: outcome,
          });
          expectNoGatedContent(page);
        }
        expect(page.rolesStale).toBe(outcome === "roles_unknown");
      });
    });
  }

  test("a public section is open in every viewer state", async () => {
    for (const state of Object.keys(OUTCOMES) as ViewerState[]) {
      const f = await seeded();
      await publishContent(f, content([PUBLIC_COUNTER]));
      const page = await shownPage(f, await arrange(f, state));
      expect(page.sections).toMatchObject([{ kind: "open", id: "stats" }]);
      expect(page.rolesStale).toBe(false);
    }
  });

  test("roles on a channel on another platform do not count", async () => {
    const f = await seeded();
    await publishContent(f, content([gated({ kind: "follower" })]));
    await linkChannel(f, "youtube");
    const viewer = await signInViewer(f);
    await cacheRoles(f, viewer, { follower: true, subscriberTier: 3 });
    const page = await shownPage(f, viewer.sessionToken);
    expect(page.sections).toEqual([
      { kind: "locked", region: "main", requirement: { kind: "follower" }, reason: "unverifiable" },
    ]);
    expectNoGatedContent(page);
  });

  test("locks a section again once its viewer's roles expire, and asks for a refresh", async () => {
    const f = await seeded();
    await publishContent(f, content([gated({ kind: "follower" })]));
    await linkChannel(f);
    const viewer = await signInViewer(f);
    const rolesId = await cacheRoles(f, viewer, { follower: true, subscriberTier: null });
    expect((await shownPage(f, viewer.sessionToken)).sections[0]?.kind).toBe("open");
    await f.t.mutation(internal.viewerRoles.expireRoles, { id: rolesId, checkedAt: 1 });
    const page = await shownPage(f, viewer.sessionToken);
    expect(page.rolesStale).toBe(true);
    expect(page.sections[0]).toMatchObject({ kind: "locked", reason: "roles_unknown" });
    expectNoGatedContent(page);
  });

  test("keeps the position of a locked section among open ones", async () => {
    const f = await seeded();
    const after: PageSection = { ...PUBLIC_COUNTER, id: "after", widgets: [] };
    await publishContent(f, content([PUBLIC_COUNTER, gated({ kind: "subscriber" }), after]));
    const page = await shownPage(f);
    expect(page.sections.map((section) => (section.kind === "open" ? section.id : "locked"))).toEqual([
      "stats",
      "locked",
      "after",
    ]);
  });

  test("does not load live facts for a live-status widget the viewer may not see", async () => {
    const f = await seeded();
    await publishContent(
      f,
      content([
        {
          id: "live",
          region: "main",
          visibility: { kind: "follower" },
          widgets: [
            { id: "status", type: "live-status", config: { showTitle: true, showGame: true, showViewerCount: true } },
          ],
        },
      ])
    );
    await f.t.run(async (ctx) => {
      await ctx.db.insert("instanceLiveState", {
        instanceId: f.instanceId,
        isLive: true,
        streamTitle: "Members-only stream",
        lastUpdateSource: "webhook",
        lastUpdatedAt: 1,
      });
    });
    expect(JSON.stringify(await shownPage(f))).not.toContain("Members-only stream");
  });
});
