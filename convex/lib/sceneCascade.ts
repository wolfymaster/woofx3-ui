import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

type SceneChildId =
  | Id<"sceneSlots">
  | Id<"browserSourceKeys">
  | Id<"alertDescriptors">
  | Id<"alertHistory">
  | Id<"obsSceneConfigs">
  | Id<"alerts">
  | Id<"obsCommands">;

type SceneChildQuery = (ctx: MutationCtx, sceneId: Id<"scenes">, limit: number) => Promise<{ _id: SceneChildId }[]>;

// Every table holding a reference to a scene. Deleting a scene must clear all
// of them: browserSourceKeys in particular carry live overlay URLs and engine
// tokens, so a leaked row is a dangling public endpoint, not just clutter.
// Each entry is its own closure so the table/index pairing stays type-checked.
const SCENE_CHILD_QUERIES: SceneChildQuery[] = [
  (ctx, sceneId, limit) =>
    ctx.db
      .query("sceneSlots")
      .withIndex("by_scene", (q) => q.eq("sceneId", sceneId))
      .take(limit),
  (ctx, sceneId, limit) =>
    ctx.db
      .query("browserSourceKeys")
      .withIndex("by_scene", (q) => q.eq("sceneId", sceneId))
      .take(limit),
  (ctx, sceneId, limit) =>
    ctx.db
      .query("alertDescriptors")
      .withIndex("by_scene", (q) => q.eq("sceneId", sceneId))
      .take(limit),
  (ctx, sceneId, limit) =>
    ctx.db
      .query("alertHistory")
      .withIndex("by_scene", (q) => q.eq("sceneId", sceneId))
      .take(limit),
  (ctx, sceneId, limit) =>
    ctx.db
      .query("obsSceneConfigs")
      .withIndex("by_scene", (q) => q.eq("sceneId", sceneId))
      .take(limit),
  (ctx, sceneId, limit) =>
    ctx.db
      .query("alerts")
      .withIndex("by_scene_and_state", (q) => q.eq("sceneId", sceneId))
      .take(limit),
  (ctx, sceneId, limit) =>
    ctx.db
      .query("obsCommands")
      .withIndex("by_scene_and_state", (q) => q.eq("sceneId", sceneId))
      .take(limit),
];

// Bounds the work per transaction. alerts/alertHistory are unbounded in
// principle, so the cascade drains in batches rather than risking one oversized
// transaction that would fail the whole webhook.
const SCENE_CASCADE_BATCH = 256;

// Deletes up to SCENE_CASCADE_BATCH child rows. done=false means the budget ran
// out and another pass is needed.
export async function purgeSceneChildren(
  ctx: MutationCtx,
  sceneId: Id<"scenes">
): Promise<{ deleted: number; done: boolean }> {
  let budget = SCENE_CASCADE_BATCH;

  for (const childQuery of SCENE_CHILD_QUERIES) {
    if (budget <= 0) {
      return { deleted: SCENE_CASCADE_BATCH, done: false };
    }

    const rows = await childQuery(ctx, sceneId, budget);
    for (const row of rows) {
      await ctx.db.delete(row._id);
    }
    budget -= rows.length;
  }

  return { deleted: SCENE_CASCADE_BATCH - budget, done: true };
}

// Removes a scene and everything hanging off it. The scene row goes first so the
// UI reflects the delete immediately and a redelivered webhook is a no-op; any
// children beyond the batch budget are drained by a scheduled follow-up pass.
export async function deleteSceneAndChildren(ctx: MutationCtx, sceneId: Id<"scenes">): Promise<void> {
  await ctx.db.delete(sceneId);

  const { done } = await purgeSceneChildren(ctx, sceneId);
  if (!done) {
    await ctx.scheduler.runAfter(0, internal.scenes.cascadeSceneChildren, { sceneId });
  }
}
