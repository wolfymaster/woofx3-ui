import { defaultPageContent, type PageContent } from "@shared/user-pages";
import type { Id } from "../_generated/dataModel";
import { newBackend } from "./convexTest.testing";

// An instance with an owner, a member and a stranger, one counter resource and
// a default plan, for tests of the user page functions.

export const COUNTER = "woofx3:counter:deaths";

export type Backend = ReturnType<typeof newBackend>;

export interface Fixture {
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

export interface FixtureOptions {
  hosting?: "managed" | "external";
  /** Whether the default plan includes the userPages feature. */
  entitled?: boolean;
  /**
   * Whether the engine holds a slug. Only managed engines get one today; an
   * external engine with a slug stands in for one linked to an account.
   */
  slug?: boolean;
}

export async function fixture({
  hosting = "managed",
  entitled = false,
  slug = true,
}: FixtureOptions = {}): Promise<Fixture> {
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
      hosting,
      createdAt: 1,
    });
    await ctx.db.insert("instanceMembers", { instanceId, userId: ownerId, role: "owner" });
    await ctx.db.insert("instanceMembers", { instanceId, userId: memberId, role: "member" });
    if (slug) {
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

export function withText(markdown: string): PageContent {
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

export function withCounter(resource: string): PageContent {
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
