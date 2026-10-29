import { describe, expect, test } from "bun:test";
import { defaultPageContent, type PageContent, type PageSection, type PublicPageLookup } from "@shared/user-pages";
import { api, internal } from "./_generated/api";
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

async function lookup(f: Fixture, slug = "wolfy"): Promise<PublicPageLookup> {
  return f.t.query(api.userPagesPublic.bySlug, { slug });
}

async function shownPage(f: Fixture): Promise<Extract<PublicPageLookup, { kind: "page" }>> {
  const result = await lookup(f);
  if (result.kind !== "page") {
    throw new Error(`expected a page, got ${result.kind}`);
  }
  return result;
}

function counterState(page: Extract<PublicPageLookup, { kind: "page" }>) {
  const widget = page.sections[0]?.widgets[0];
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

  test("leaves out sections that are not public, and the values only they bind", async () => {
    const f = await seeded();
    await publishContent(f, content([PUBLIC_COUNTER, SUBSCRIBER_SECRET]));
    const page = await shownPage(f);
    expect(page.sections.map((section) => section.id)).toEqual(["stats"]);
    const json = JSON.stringify(page);
    expect(json).not.toContain("4242");
    expect(json).not.toContain("subs only");
    expect(json).not.toContain("For subs");
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
    expect(page.sections[0]?.widgets[0]).toMatchObject({ live: { isLive: true, title: "Deathless run" } });
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
    expect((await shownPage(f)).sections[0]?.widgets[0]).toEqual({
      id: "break",
      type: "timer",
      config: {},
      state: { kind: "woofx3:timer", value: running, settings: { duration: 300 } },
    });
  });
});
