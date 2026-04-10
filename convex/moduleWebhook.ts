import { v } from "convex/values";
import { internalMutation } from "./_generated/server";

const triggerValidator = v.object({
  slug: v.string(),
  name: v.string(),
  description: v.string(),
  category: v.string(),
  event: v.optional(v.string()),
  ui: v.object({
    color: v.string(),
    icon: v.string(),
    configFields: v.optional(v.array(v.any())),
    supportsTiers: v.optional(v.boolean()),
    tierLabel: v.optional(v.string()),
  }),
});

const actionValidator = v.object({
  slug: v.string(),
  name: v.string(),
  description: v.string(),
  category: v.string(),
  ui: v.object({
    color: v.string(),
    icon: v.string(),
    configFields: v.optional(v.array(v.any())),
  }),
});

/**
 * Process a module.installed webhook callback from the engine.
 * Upserts trigger and action definitions in Convex using slug as the idempotency key.
 */
export const processModuleInstalled = internalMutation({
  args: {
    instanceId: v.string(),
    moduleName: v.string(),
    moduleVersion: v.string(),
    triggers: v.array(triggerValidator),
    actions: v.array(actionValidator),
  },
  handler: async (ctx, { moduleName, moduleVersion, triggers, actions }) => {
    // Find the moduleRepository record by name + version using index
    const moduleRecord = await ctx.db
      .query("moduleRepository")
      .withIndex("by_name_version", (q) => q.eq("name", moduleName).eq("version", moduleVersion))
      .first();
    const moduleId = moduleRecord?._id;

    // Upsert trigger definitions
    for (const trigger of triggers) {
      const existing = await ctx.db
        .query("triggerDefinitions")
        .withIndex("by_slug", (q) => q.eq("slug", trigger.slug))
        .first();

      const data = {
        slug: trigger.slug,
        name: trigger.name,
        description: trigger.description,
        category: trigger.category,
        event: trigger.event,
        color: trigger.ui.color,
        icon: trigger.ui.icon,
        configFields: trigger.ui.configFields,
        supportsTiers: trigger.ui.supportsTiers,
        tierLabel: trigger.ui.tierLabel,
        moduleId,
      };

      if (existing) {
        await ctx.db.patch(existing._id, data);
      } else {
        await ctx.db.insert("triggerDefinitions", data);
      }
    }

    // Upsert action definitions
    for (const action of actions) {
      const existing = await ctx.db
        .query("actionDefinitions")
        .withIndex("by_slug", (q) => q.eq("slug", action.slug))
        .first();

      const data = {
        slug: action.slug,
        name: action.name,
        description: action.description,
        category: action.category,
        color: action.ui.color,
        icon: action.ui.icon,
        configFields: action.ui.configFields,
        moduleId,
      };

      if (existing) {
        await ctx.db.patch(existing._id, data);
      } else {
        await ctx.db.insert("actionDefinitions", data);
      }
    }

    // Update module status to installed if we found the record
    if (moduleId) {
      await ctx.db.patch(moduleId, { status: "installed" as const });
    }
  },
});
