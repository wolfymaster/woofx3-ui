import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { ConvexError } from "convex/values";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { newBackend } from "./lib/convexTest.testing";
import type { OrgRole } from "./lib/organization";

// Paying for a listing and reading its license key are the organization's,
// so its role decides them. Each user here holds the opposite instance role
// to their organization role, so a gate on the instance role would fail.

type Backend = ReturnType<typeof newBackend>;

const ENV_KEYS = ["MARKETPLACE_API_URL", "MARKETPLACE_API_TOKEN"] as const;
const savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
const realFetch = globalThis.fetch;
let marketplaceCalls: string[] = [];

beforeEach(() => {
  marketplaceCalls = [];
  process.env.MARKETPLACE_API_URL = "https://marketplace.test";
  process.env.MARKETPLACE_API_TOKEN = "token";
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    marketplaceCalls.push(url.pathname);
    if (url.pathname === "/checkout/sessions") {
      return Response.json({ url: "https://pay.example/1" });
    }
    if (url.pathname === "/entitlements") {
      return Response.json({ licenses: [{ listingId: "cozy", source: "purchase", key: "W3X-KEY" }] });
    }
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  for (const key of ENV_KEYS) {
    process.env[key] = savedEnv[key];
  }
});

const INSTANCE_ROLE_OF: Record<OrgRole, "owner" | "admin" | "member"> = {
  owner: "member",
  admin: "owner",
  member: "owner",
};

async function seed(t: Backend) {
  return t.run(async (ctx) => {
    const users = {} as Record<OrgRole, Id<"users">>;
    for (const role of ["owner", "admin", "member"] as const) {
      users[role] = await ctx.db.insert("users", { name: role });
    }
    const accountId = await ctx.db.insert("accounts", { name: "Org", ownerId: users.owner, createdAt: 1 });
    const instanceId = await ctx.db.insert("instances", {
      accountId,
      name: "Engine",
      url: "https://e.example",
      createdAt: 1,
    });
    for (const role of ["owner", "admin", "member"] as const) {
      await ctx.db.insert("accountMembers", { accountId, userId: users[role], role, createdAt: 1 });
      await ctx.db.insert("instanceMembers", { instanceId, userId: users[role], role: INSTANCE_ROLE_OF[role] });
    }
    return { users, instanceId };
  });
}

const as = (t: Backend, userId: Id<"users">) => t.withIdentity({ subject: `${userId}|session` });

function refusal(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => null,
    (error: unknown) => (error instanceof ConvexError ? error.data : error)
  );
}

describe("licenseKey", () => {
  test.each(["owner", "admin"] as const)("an organization %s reads the key", async (role) => {
    const t = newBackend();
    const { users, instanceId } = await seed(t);
    expect(await as(t, users[role]).action(api.marketplaceCatalog.licenseKey, { instanceId, listingId: "cozy" })).toBe(
      "W3X-KEY"
    );
  });

  test("an organization member is refused before the marketplace is asked", async () => {
    const t = newBackend();
    const { users, instanceId } = await seed(t);
    expect(
      await refusal(as(t, users.member).action(api.marketplaceCatalog.licenseKey, { instanceId, listingId: "cozy" }))
    ).toMatchObject({ code: "not_authorized", action: "viewBilling" });
    expect(marketplaceCalls).toEqual([]);
  });

  test("someone outside the organization is refused", async () => {
    const t = newBackend();
    const { instanceId } = await seed(t);
    const outsider = await t.run((ctx) => ctx.db.insert("users", { name: "outsider" }));
    expect(
      await refusal(as(t, outsider).action(api.marketplaceCatalog.licenseKey, { instanceId, listingId: "cozy" }))
    ).toMatchObject({ code: "not_authorized" });
  });
});

describe("organizations.capabilitiesForInstance", () => {
  test.each([
    ["owner", { viewBilling: true, manageBilling: true }],
    ["admin", { viewBilling: true, manageBilling: false }],
    ["member", { viewBilling: false, manageBilling: false }],
  ] as const)("an organization %s gets its billing capabilities", async (role, expected) => {
    const t = newBackend();
    const { users, instanceId } = await seed(t);
    expect(await as(t, users[role]).query(api.organizations.capabilitiesForInstance, { instanceId })).toMatchObject(
      expected
    );
  });

  test("is null for someone outside the organization", async () => {
    const t = newBackend();
    const { instanceId } = await seed(t);
    const outsider = await t.run((ctx) => ctx.db.insert("users", { name: "outsider" }));
    expect(await as(t, outsider).query(api.organizations.capabilitiesForInstance, { instanceId })).toBeNull();
  });
});
