import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation } from "../_generated/server";
import { rescalePlacements } from "../lib/placementOpacity";

/**
 * One-time: a widget placement's `opacity` is a fraction, 0 to 1. Placements
 * written before that held a percent (in practice always 100). This rescales
 * every placement whose opacity is above 1, in the scene mirror and in the
 * workflow mirror (Alert steps' `parameters.layout.widgets`). Values at or
 * below 1 are left alone, so it is safe to run again.
 *
 *   bunx convex run migrations/opacityAsFraction:default
 */

const BATCH = 50;

const tableValidator = v.union(v.literal("scenes"), v.literal("workflows"));

export default internalMutation({
  args: v.object({}),
  handler: async (ctx) => {
    await ctx.scheduler.runAfter(0, internal.migrations.opacityAsFraction.batch, { table: "scenes", cursor: null });
    await ctx.scheduler.runAfter(0, internal.migrations.opacityAsFraction.batch, { table: "workflows", cursor: null });
    return { scheduled: ["scenes", "workflows"] };
  },
});

export const batch = internalMutation({
  args: { table: tableValidator, cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { table, cursor }) => {
    let rewritten = 0;
    let page: { isDone: boolean; continueCursor: string };
    if (table === "scenes") {
      const result = await ctx.db.query("scenes").paginate({ numItems: BATCH, cursor });
      for (const scene of result.page) {
        const widgets = rescalePlacements(scene.widgets);
        const sceneWidgets = rescalePlacements(scene.sceneWidgets);
        if (widgets.changed || sceneWidgets.changed) {
          await ctx.db.patch(scene._id, {
            widgets: widgets.value as typeof scene.widgets,
            sceneWidgets: sceneWidgets.value as typeof scene.sceneWidgets,
          });
          rewritten++;
        }
      }
      page = result;
    } else {
      const result = await ctx.db.query("workflows").paginate({ numItems: BATCH, cursor });
      for (const workflow of result.page) {
        const definition = rescalePlacements(workflow.definition);
        const nodes = rescalePlacements(workflow.nodes);
        if (definition.changed || nodes.changed) {
          await ctx.db.patch(workflow._id, {
            definition: definition.value,
            nodes: nodes.value as typeof workflow.nodes,
          });
          rewritten++;
        }
      }
      page = result;
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.migrations.opacityAsFraction.batch, {
        table,
        cursor: page.continueCursor,
      });
    }
    console.log(`opacityAsFraction ${table}: rewrote ${rewritten}${page.isDone ? ", done" : ""}`);
    return { rewritten, isDone: page.isDone };
  },
});
