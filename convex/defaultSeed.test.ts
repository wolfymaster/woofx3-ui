import { describe, expect, test } from "bun:test";
import { DEFAULT_ALERTS_PACK_ID, DEFAULT_DASHBOARD_WIDGETS } from "@shared/default-seed";
import { api, internal } from "./_generated/api";
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
    await t.withIdentity({ subject: `${ownerId}|session` }).mutation(api.setup.complete, { instanceId });
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
