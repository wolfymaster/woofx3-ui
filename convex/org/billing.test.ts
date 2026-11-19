import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { ConvexError } from "convex/values";
import { api, internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { hashCompanionToken } from "../lib/companionCodes";
import { newBackend } from "../lib/convexTest.testing";
import { insertProjection } from "../lib/orgBilling.testing";
import { upsertPlan } from "../lib/plans";
import { PLAN_SEEDS } from "../seeds/plans";

// Who may do what while an org is suspended, through the public functions
// that do it. Each row runs against an active org, a suspended one and one
// the plane has not reported on yet; only the suspended org's refused rows
// may answer `org_suspended`. The engine and the plane are unreachable here,
// so an allowed call may still fail later for that reason, never for billing.

type Backend = ReturnType<typeof newBackend>;
type Org = "active" | "suspended" | "no projection";

const realFetch = globalThis.fetch;
const savedPlaneUrl = process.env.MAINTENANCE_API_URL;
const savedPlaneKey = process.env.MAINTENANCE_API_KEY;

beforeEach(() => {
  process.env.MAINTENANCE_API_URL = "https://plane.test";
  process.env.MAINTENANCE_API_KEY = "key";
  globalThis.fetch = (async () => {
    throw new Error("network is not reachable in this test");
  }) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  process.env.MAINTENANCE_API_URL = savedPlaneUrl;
  process.env.MAINTENANCE_API_KEY = savedPlaneKey;
});

interface Seeded {
  ownerId: Id<"users">;
  adminId: Id<"users">;
  memberId: Id<"users">;
  inviteeId: Id<"users">;
  accountId: Id<"accounts">;
  instanceId: Id<"instances">;
}

async function seed(t: Backend, org: Org): Promise<Seeded> {
  return t.run(async (ctx) => {
    for (const planSeed of PLAN_SEEDS) {
      await upsertPlan(ctx, planSeed, "test");
    }
    const ownerId = await ctx.db.insert("users", { name: "Owner" });
    const adminId = await ctx.db.insert("users", { name: "Admin" });
    const memberId = await ctx.db.insert("users", { name: "Member" });
    const inviteeId = await ctx.db.insert("users", {
      name: "Invitee",
      email: "invitee@example.com",
      emailVerificationTime: 1,
    });
    const accountId = await ctx.db.insert("accounts", { name: "Org", ownerId, createdAt: 1 });
    await ctx.db.insert("accountMembers", { accountId, userId: ownerId, role: "owner", createdAt: 1 });
    await ctx.db.insert("accountMembers", { accountId, userId: adminId, role: "admin", createdAt: 1 });
    await ctx.db.insert("accountMembers", { accountId, userId: memberId, role: "member", createdAt: 1 });
    const instanceId = await ctx.db.insert("instances", {
      accountId,
      name: "Hosted",
      url: "https://engine.test",
      hosting: "managed",
      createdAt: 1,
      clientId: "client-1",
      clientSecret: "secret-1",
    });
    await ctx.db.insert("instanceMembers", { instanceId, userId: ownerId, role: "owner" });
    await ctx.db.insert("instanceMembers", { instanceId, userId: adminId, role: "admin" });
    await ctx.db.insert("instanceMembers", { instanceId, userId: memberId, role: "member" });
    await ctx.db.insert("invitations", {
      accountId,
      email: "invitee@example.com",
      role: "member",
      instanceId,
      engineRole: "member",
      token: "invite-token",
      invitedByUserId: ownerId,
      status: "pending",
      expiresAt: Number.MAX_SAFE_INTEGER,
      createdAt: 1,
    });
    if (org === "active") {
      await insertProjection(ctx, accountId);
    }
    if (org === "suspended") {
      await insertProjection(ctx, accountId, { standing: "suspended", reason: "payment_failed" });
    }
    return { ownerId, adminId, memberId, inviteeId, accountId, instanceId };
  });
}

const as = (t: Backend, userId: Id<"users">) => t.withIdentity({ subject: `${userId}|session` });

/** The refusal code a call failed with, `null` when it succeeded, or `other` for any non-billing failure. */
function outcome(call: Promise<unknown>): Promise<string | null> {
  return call.then(
    () => null,
    (error: unknown) => {
      if (error instanceof ConvexError && typeof error.data === "object" && error.data !== null) {
        return String((error.data as { code?: unknown }).code ?? "other");
      }
      return error instanceof Error && error.message.includes("org_suspended") ? "org_suspended" : "other";
    }
  );
}

type Call = (t: Backend, seeded: Seeded) => Promise<unknown>;

const COMPANION_TOKEN = `wfxc_${"a".repeat(43)}`;

function seedScene(t: Backend, s: Seeded): Promise<Id<"scenes">> {
  return t.run((ctx) =>
    ctx.db.insert("scenes", { instanceId: s.instanceId, name: "Scene", createdAt: 1, updatedAt: 1 })
  );
}

/** A confirmed companion whose approver is the engine's admin; returns its token. */
async function pairCompanion(t: Backend, s: Seeded): Promise<string> {
  const tokenHash = await hashCompanionToken(COMPANION_TOKEN);
  await t.run((ctx) =>
    ctx.db.insert("companions", {
      instanceId: s.instanceId,
      installationId: "install-1",
      tokenHash,
      deviceName: "PC",
      companionVersion: "1.0.0",
      pairedBy: s.adminId,
      pairedAt: 1,
      confirmedAt: 2,
    })
  );
  return COMPANION_TOKEN;
}

const REFUSED: Array<[string, Call]> = [
  [
    "a member's engine proxy action (sceneActions.createScene)",
    (t, s) => as(t, s.memberId).action(api.sceneActions.createScene, { instanceId: s.instanceId, name: "Scene" }),
  ],
  [
    "a member's engine action behind requireInstanceRoleInAction (engineSync.syncNow)",
    (t, s) => as(t, s.memberId).action(api.engineSync.syncNow, { instanceId: s.instanceId }),
  ],
  [
    "a member's engine mutation behind requireInstanceRole (dashboardLayouts.addPanel)",
    (t, s) => as(t, s.memberId).mutation(api.dashboardLayouts.addPanel, { instanceId: s.instanceId, layoutId: "l" }),
  ],
  [
    "an admin operating the engine (instances.update)",
    (t, s) => as(t, s.adminId).mutation(api.instances.update, { instanceId: s.instanceId, name: "Renamed" }),
  ],
  [
    "a module install (marketplace.installWithLicense)",
    (t, s) =>
      as(t, s.adminId).action(api.marketplace.installWithLicense, {
        instanceId: s.instanceId,
        listingId: "module-1",
        licenseKey: "W3X-KEY",
        approvedPermissions: [],
        approvedLocalEndpoints: [],
      }),
  ],
  [
    "an engine role change (engineMembers.setRole)",
    (t, s) =>
      as(t, s.adminId).mutation(api.engineMembers.setRole, {
        instanceId: s.instanceId,
        targetUserId: s.memberId,
        role: "admin",
      }),
  ],
  [
    "a member's stream recap read (streamRecap.loadEngineDetail)",
    (t, s) =>
      as(t, s.memberId).action(api.streamRecap.loadEngineDetail, { instanceId: s.instanceId, sessionId: "session-1" }),
  ],
  [
    "a member's stream recap markers (streamRecap.loadMarkers)",
    (t, s) =>
      as(t, s.memberId).action(api.streamRecap.loadMarkers, { instanceId: s.instanceId, sessionId: "session-1" }),
  ],
  [
    "an admin's moderation call (moderation.listBlockedTerms)",
    (t, s) => as(t, s.adminId).action(api.moderation.listBlockedTerms, { instanceId: s.instanceId }),
  ],
  [
    "a member reading chat settings (moderation.getChatSettings)",
    (t, s) => as(t, s.memberId).action(api.moderation.getChatSettings, { instanceId: s.instanceId }),
  ],
  [
    "a member reading the OBS status (obsStatus.get)",
    (t, s) => as(t, s.memberId).action(api.obsStatus.get, { instanceId: s.instanceId }),
  ],
  [
    "a member starting a module connection (moduleOAuth.start)",
    (t, s) =>
      as(t, s.memberId).action(api.moduleOAuth.start, {
        instanceId: s.instanceId,
        moduleId: "module-1",
        integration: "twitch",
        redirectTo: "/",
      }),
  ],
  [
    "an admin connecting Twitch (twitchIntegration.startConnect)",
    (t, s) =>
      as(t, s.adminId).action(api.twitchIntegration.startConnect, { instanceId: s.instanceId, redirectTo: "/" }),
  ],
  [
    "an admin disconnecting Twitch (twitchIntegration.disconnect)",
    (t, s) =>
      as(t, s.adminId).action(api.twitchIntegration.disconnect, { instanceId: s.instanceId, platform: "twitch" }),
  ],
  [
    "a member minting a browser source key (browserSource.getOrCreateBrowserSourceKey)",
    async (t, s) =>
      as(t, s.memberId).action(api.browserSource.getOrCreateBrowserSourceKey, { sceneId: await seedScene(t, s) }),
  ],
  [
    "a member revoking browser source keys (browserSource.revokeBrowserSourceKeys)",
    async (t, s) =>
      as(t, s.memberId).action(api.browserSource.revokeBrowserSourceKeys, { sceneId: await seedScene(t, s) }),
  ],
  [
    "a member's preview URL (browserSource.getOrCreatePreviewUrl)",
    async (t, s) =>
      as(t, s.memberId).action(api.browserSource.getOrCreatePreviewUrl, { sceneId: await seedScene(t, s) }),
  ],
  [
    "a companion reporting what it found (companionIntegrations.reportTarget)",
    async (t, s) =>
      t.query(internal.companionIntegrations.reportTarget, {
        token: await pairCompanion(t, s),
        moduleId: "module-1",
        endpointId: "obs",
      }),
  ],
  [
    "a companion asking for a relay credential (companionRelay.credentialSubject)",
    async (t, s) => t.query(internal.companionRelay.credentialSubject, { token: await pairCompanion(t, s) }),
  ],
  [
    "the owner retrying the engine build (provisioning.retry)",
    (t, s) => as(t, s.ownerId).action(api.provisioning.retry, { instanceId: s.instanceId }),
  ],
];

const ALLOWED: Array<[string, Call]> = [
  [
    "the owner tearing down the managed engine (provisioning.deleteManagedEngine)",
    (t, s) => as(t, s.ownerId).action(api.provisioning.deleteManagedEngine, { instanceId: s.instanceId }),
  ],
  [
    "the owner deleting the engine (instances.deleteInstance)",
    (t, s) => as(t, s.ownerId).action(api.instances.deleteInstance, { instanceId: s.instanceId }),
  ],
  [
    "the owner starting a checkout (billingCommands.startCheckout)",
    (t, s) =>
      as(t, s.ownerId).action(api.billingCommands.startCheckout, {
        accountId: s.accountId,
        plan: "starter",
        interval: "month",
      }),
  ],
  [
    "the owner opening the provider portal (billingCommands.openPortal)",
    (t, s) => as(t, s.ownerId).action(api.billingCommands.openPortal, { accountId: s.accountId }),
  ],
  [
    "an admin removing someone from the org (accountMembers.removeMember)",
    (t, s) =>
      as(t, s.adminId).mutation(api.accountMembers.removeMember, {
        accountId: s.accountId,
        targetUserId: s.memberId,
      }),
  ],
  [
    "a member reading their organizations (organizations.mine)",
    (t, s) => as(t, s.memberId).query(api.organizations.mine, {}),
  ],
  [
    "a member opening the dashboard (access.entry)",
    (t, s) => as(t, s.memberId).query(api.access.entry, { selectedInstanceId: s.instanceId }),
  ],
];

const ORGS: Org[] = ["active", "suspended", "no projection"];

describe.each(ORGS)("%s org", (org) => {
  test.each(REFUSED)(`${org === "suspended" ? "refuses" : "does not refuse"} %s`, async (_name, call) => {
    const t = newBackend();
    const result = await outcome(call(t, await seed(t, org)));
    if (org === "suspended") {
      expect(result).toBe("org_suspended");
    } else {
      expect(result).not.toBe("org_suspended");
    }
  });

  test.each(ALLOWED)("allows %s", async (_name, call) => {
    const t = newBackend();
    expect(await outcome(call(t, await seed(t, org)))).not.toBe("org_suspended");
  });
});

describe.each(ORGS)("%s org accepting an invitation", (org) => {
  test(org === "suspended" ? "is told the org is suspended" : "joins the engine", async () => {
    const t = newBackend();
    const seeded = await seed(t, org);
    const result = await as(t, seeded.inviteeId).mutation(api.invitations.accept, { token: "invite-token" });
    expect(result.status).toBe(org === "suspended" ? "org_suspended" : "accepted");
    const joined = await t.run((ctx) =>
      ctx.db
        .query("instanceMembers")
        .withIndex("by_instance_user", (q) => q.eq("instanceId", seeded.instanceId).eq("userId", seeded.inviteeId))
        .first()
    );
    expect(joined !== null).toBe(org !== "suspended");
  });
});

describe("a suspended org", () => {
  async function suspended(t: Backend) {
    return seed(t, "suspended");
  }

  test("still shows the owner its billing", async () => {
    const t = newBackend();
    const { ownerId } = await suspended(t);
    const [organization] = await as(t, ownerId).query(api.organizations.mine, {});
    expect(organization?.subscription).toMatchObject({ state: "suspended", stateReason: "payment_failed" });
  });

  test("lets the owner delete the engine", async () => {
    const t = newBackend();
    const { ownerId, instanceId } = await suspended(t);
    await as(t, ownerId).action(api.instances.deleteInstance, { instanceId });
    expect(await t.run((ctx) => ctx.db.get(instanceId))).toBeNull();
  });

  test("hands the engine no relay target", async () => {
    const t = newBackend();
    const { instanceId } = await suspended(t);
    expect(await t.query(internal.companionRelay.relayTarget, { instanceId })).toBeNull();
  });

  test("never refuses a self-hosted engine", async () => {
    const t = newBackend();
    const { memberId, instanceId } = await suspended(t);
    await t.run((ctx) => ctx.db.patch(instanceId, { hosting: "external" } satisfies Partial<Doc<"instances">>));
    expect(
      await outcome(as(t, memberId).mutation(api.dashboardLayouts.addPanel, { instanceId, layoutId: "l" }))
    ).not.toBe("org_suspended");
  });
});
