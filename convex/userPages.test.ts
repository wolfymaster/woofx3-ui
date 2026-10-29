import { describe, expect, test } from "bun:test";
import { defaultPageContent, type PageContent } from "@shared/user-pages";
import { ConvexError } from "convex/values";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { newBackend } from "./lib/convexTest.testing";
import type { UserPageRefusal } from "./lib/userPages";

const COUNTER = "woofx3:counter:deaths";

type Backend = ReturnType<typeof newBackend>;

interface Fixture {
  t: Backend;
  instanceId: Id<"instances">;
  accountId: Id<"accounts">;
  /** The account owner, an admin of the instance. */
  owner: ReturnType<Backend["withIdentity"]>;
  /** A member who may edit but not publish. */
  member: ReturnType<Backend["withIdentity"]>;
  /** Signed in, with no access to the instance. */
  stranger: ReturnType<Backend["withIdentity"]>;
}

interface FixtureOptions {
  entitled?: boolean;
  managed?: boolean;
}

async function fixture({ entitled = true, managed = true }: FixtureOptions = {}): Promise<Fixture> {
  const t = newBackend();
  const ids = await t.run(async (ctx) => {
    const ownerId = await ctx.db.insert("users", { name: "Owner" });
    const memberId = await ctx.db.insert("users", { name: "Member" });
    const strangerId = await ctx.db.insert("users", { name: "Stranger" });
    const accountId = await ctx.db.insert("accounts", { name: "Acct", ownerId, createdAt: 1 });
    const instanceId = await ctx.db.insert("instances", {
      accountId,
      name: "Main",
      url: "https://engine.example",
      createdAt: 1,
    });
    await ctx.db.insert("instanceMembers", { instanceId, userId: ownerId, role: "owner" });
    await ctx.db.insert("instanceMembers", { instanceId, userId: memberId, role: "member" });
    if (managed) {
      await ctx.db.insert("engineProvisioning", {
        instanceId,
        accountId,
        requestedBy: ownerId,
        maintenanceEngineId: "eng_1",
        slug: "wolfy",
        status: "registered",
        steps: [],
        registrationToken: "token",
        createdAt: 1,
        updatedAt: 1,
      });
    }
    await ctx.db.insert("plans", {
      key: "free",
      name: "Free",
      features: entitled ? ["userPages"] : [],
      limits: [],
      offered: true,
      isDefault: true,
      updatedAt: 1,
      updatedBy: "test",
    });
    const moduleId = await ctx.db.insert("moduleRepository", {
      instanceId,
      name: "woofx3",
      moduleKey: "woofx3:1:abc",
      description: "",
      version: "1",
      tags: [],
    });
    await ctx.db.insert("moduleResourceInstances", {
      instanceId,
      moduleId,
      engineInstanceId: "uuid-1",
      resourceInstanceId: "deaths",
      moduleName: "woofx3",
      kind: "counter",
      displayName: "Deaths",
      canonicalId: COUNTER,
    });
    return { ownerId, memberId, strangerId, accountId, instanceId };
  });
  const as = (userId: Id<"users">) => t.withIdentity({ subject: `${userId}|session` });
  return {
    t,
    instanceId: ids.instanceId,
    accountId: ids.accountId,
    owner: as(ids.ownerId),
    member: as(ids.memberId),
    stranger: as(ids.strangerId),
  };
}

function withText(markdown: string): PageContent {
  return {
    ...defaultPageContent(),
    sections: [
      {
        id: "about",
        region: "main",
        visibility: { kind: "public" },
        widgets: [{ id: "bio", type: "text", config: { markdown } }],
      },
    ],
  };
}

function withCounter(resource: string): PageContent {
  return {
    ...defaultPageContent(),
    sections: [
      {
        id: "stats",
        region: "main",
        visibility: { kind: "public" },
        widgets: [{ id: "deaths", type: "counter", config: { resource, showGoals: true } }],
      },
    ],
  };
}

/** The refusal a mutation threw, or a failure when it threw something else or nothing. */
async function refusal(call: Promise<unknown>): Promise<UserPageRefusal> {
  try {
    await call;
  } catch (error) {
    if (error instanceof ConvexError) {
      return error.data as UserPageRefusal;
    }
    throw error;
  }
  throw new Error("expected the call to be refused");
}

describe("forEditing", () => {
  test("starts a member on a default draft, with the instance's slug", async () => {
    const f = await fixture();
    expect(await f.member.query(api.userPages.forEditing, { instanceId: f.instanceId })).toEqual({
      slug: "wolfy",
      canPublish: true,
      draft: { revision: 0, content: defaultPageContent(), savedAt: null },
      published: null,
    });
  });

  test("answers a non-member and a signed-out caller with nothing", async () => {
    const f = await fixture();
    expect(await f.stranger.query(api.userPages.forEditing, { instanceId: f.instanceId })).toBeNull();
    expect(await f.t.query(api.userPages.forEditing, { instanceId: f.instanceId })).toBeNull();
  });

  test("has no slug for an instance that is not a managed engine", async () => {
    const f = await fixture({ managed: false });
    expect((await f.owner.query(api.userPages.forEditing, { instanceId: f.instanceId }))?.slug).toBeNull();
  });
});

describe("saveDraft", () => {
  test("saves and counts revisions", async () => {
    const f = await fixture();
    const first = await f.member.mutation(api.userPages.saveDraft, {
      instanceId: f.instanceId,
      baseRevision: 0,
      content: withText("one"),
    });
    const second = await f.member.mutation(api.userPages.saveDraft, {
      instanceId: f.instanceId,
      baseRevision: first.revision,
      content: withText("two"),
    });
    expect([first.revision, second.revision]).toEqual([1, 2]);
    const page = await f.member.query(api.userPages.forEditing, { instanceId: f.instanceId });
    expect(page?.draft.content).toEqual(withText("two"));
  });

  test("refuses a save based on a draft someone else has since saved over", async () => {
    const f = await fixture();
    await f.owner.mutation(api.userPages.saveDraft, {
      instanceId: f.instanceId,
      baseRevision: 0,
      content: withText("a"),
    });
    const refused = await refusal(
      f.member.mutation(api.userPages.saveDraft, { instanceId: f.instanceId, baseRevision: 0, content: withText("b") })
    );
    expect(refused.code).toBe("stale_draft");
  });

  test("refuses invalid content with the problems", async () => {
    const f = await fixture();
    const refused = await refusal(
      f.member.mutation(api.userPages.saveDraft, {
        instanceId: f.instanceId,
        baseRevision: 0,
        content: withText("x".repeat(10_000)),
      })
    );
    expect(refused).toMatchObject({
      code: "invalid_content",
      problems: [{ path: "sections[0].widgets[0].config.markdown" }],
    });
  });

  test("binds a resource the instance has", async () => {
    const f = await fixture();
    const saved = await f.member.mutation(api.userPages.saveDraft, {
      instanceId: f.instanceId,
      baseRevision: 0,
      content: withCounter(COUNTER),
    });
    expect(saved.revision).toBe(1);
  });

  test.each([
    ["a resource the instance does not have", "woofx3:counter:nope"],
    ["a resource of another kind", "woofx3:timer:deaths"],
  ])("refuses binding %s", async (_name, resource) => {
    const f = await fixture();
    const refused = await refusal(
      f.member.mutation(api.userPages.saveDraft, {
        instanceId: f.instanceId,
        baseRevision: 0,
        content: withCounter(resource),
      })
    );
    expect(refused).toMatchObject({ code: "invalid_content", problems: [{ path: "sections[0].widgets[0].config" }] });
  });

  test("refuses an unknown widget type at the argument boundary", async () => {
    const f = await fixture();
    const content = withText("x");
    const unknown = {
      ...content,
      sections: [{ ...content.sections[0], widgets: [{ id: "w", type: "module-widget", config: {} }] }],
    } as unknown as PageContent;
    await expect(
      f.member.mutation(api.userPages.saveDraft, { instanceId: f.instanceId, baseRevision: 0, content: unknown })
    ).rejects.toThrow(/Validator/);
  });

  test("refuses a non-member", async () => {
    const f = await fixture();
    await expect(
      f.stranger.mutation(api.userPages.saveDraft, {
        instanceId: f.instanceId,
        baseRevision: 0,
        content: withText("x"),
      })
    ).rejects.toThrow("Not authorized for this instance");
  });
});

describe("publish", () => {
  async function saved(f: Fixture, markdown: string, baseRevision = 0): Promise<number> {
    const { revision } = await f.owner.mutation(api.userPages.saveDraft, {
      instanceId: f.instanceId,
      baseRevision,
      content: withText(markdown),
    });
    return revision;
  }

  async function publishedContent(f: Fixture): Promise<PageContent | null> {
    return f.t.run(async (ctx) => {
      const page = await ctx.db
        .query("userPages")
        .withIndex("by_instance", (q) => q.eq("instanceId", f.instanceId))
        .unique();
      if (!page?.publishedRevisionId) {
        return null;
      }
      return (await ctx.db.get(page.publishedRevisionId))?.content ?? null;
    });
  }

  test("puts the draft live, and later drafts do not touch it until published", async () => {
    const f = await fixture();
    const first = await saved(f, "live");
    await f.owner.mutation(api.userPages.publish, { instanceId: f.instanceId, revision: first });
    expect(await publishedContent(f)).toEqual(withText("live"));

    const second = await saved(f, "draft only", first);
    expect(await publishedContent(f)).toEqual(withText("live"));
    const page = await f.owner.query(api.userPages.forEditing, { instanceId: f.instanceId });
    expect(page?.published?.revision).toBe(first);
    expect(page?.draft.revision).toBe(second);

    await f.owner.mutation(api.userPages.publish, { instanceId: f.instanceId, revision: second });
    expect(await publishedContent(f)).toEqual(withText("draft only"));
  });

  test("keeps no more than the draft and the published copy", async () => {
    const f = await fixture();
    let revision = 0;
    for (const text of ["a", "b", "c"]) {
      revision = await saved(f, text, revision);
      await f.owner.mutation(api.userPages.publish, { instanceId: f.instanceId, revision });
    }
    const revisions = await f.t.run(async (ctx) => ctx.db.query("userPageRevisions").take(10));
    expect(revisions).toHaveLength(2);
  });

  test("refuses a revision other than the current draft", async () => {
    const f = await fixture();
    const first = await saved(f, "a");
    await saved(f, "b", first);
    const refused = await refusal(
      f.owner.mutation(api.userPages.publish, { instanceId: f.instanceId, revision: first })
    );
    expect(refused.code).toBe("stale_draft");
    expect(await publishedContent(f)).toBeNull();
  });

  test("refuses an account whose plan does not include pages, and keeps the draft", async () => {
    const f = await fixture({ entitled: false });
    const revision = await saved(f, "a");
    await expect(f.owner.mutation(api.userPages.publish, { instanceId: f.instanceId, revision })).rejects.toThrow(
      "Not included in your plan"
    );
    expect(await publishedContent(f)).toBeNull();
    const page = await f.owner.query(api.userPages.forEditing, { instanceId: f.instanceId });
    expect(page?.canPublish).toBe(false);
    expect(page?.draft.content).toEqual(withText("a"));
  });

  test("refuses an instance with no slug", async () => {
    const f = await fixture({ managed: false });
    const revision = await saved(f, "a");
    const refused = await refusal(f.owner.mutation(api.userPages.publish, { instanceId: f.instanceId, revision }));
    expect(refused.code).toBe("no_slug");
  });

  test("refuses a member who is not an admin, and a non-member", async () => {
    const f = await fixture();
    const revision = await saved(f, "a");
    await expect(f.member.mutation(api.userPages.publish, { instanceId: f.instanceId, revision })).rejects.toThrow(
      "Not authorized for this instance"
    );
    await expect(f.stranger.mutation(api.userPages.publish, { instanceId: f.instanceId, revision })).rejects.toThrow(
      "Not authorized for this instance"
    );
  });

  test("refuses a page whose bound resource was deleted since it was saved", async () => {
    const f = await fixture();
    const { revision } = await f.owner.mutation(api.userPages.saveDraft, {
      instanceId: f.instanceId,
      baseRevision: 0,
      content: withCounter(COUNTER),
    });
    await f.t.run(async (ctx) => {
      for (const row of await ctx.db.query("moduleResourceInstances").take(10)) {
        await ctx.db.delete(row._id);
      }
    });
    const refused = await refusal(f.owner.mutation(api.userPages.publish, { instanceId: f.instanceId, revision }));
    expect(refused.code).toBe("invalid_content");
  });

  test("unpublish takes the page offline and keeps the draft", async () => {
    const f = await fixture();
    const revision = await saved(f, "a");
    await f.owner.mutation(api.userPages.publish, { instanceId: f.instanceId, revision });
    await f.owner.mutation(api.userPages.unpublish, { instanceId: f.instanceId });
    expect(await publishedContent(f)).toBeNull();
    const page = await f.owner.query(api.userPages.forEditing, { instanceId: f.instanceId });
    expect(page?.published).toBeNull();
    expect(page?.draft.content).toEqual(withText("a"));
  });
});
