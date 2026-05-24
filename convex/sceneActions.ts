import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { type ActionCtx, action } from "./_generated/server";
import { createEngineRpcSession, type EngineApi } from "./lib/engineInstanceUrl";

type InstanceContext = {
  url: string;
  applicationId: string;
  clientId: string;
  clientSecret: string;
};

async function requireInstanceContext(ctx: ActionCtx, instanceId: Id<"instances">): Promise<InstanceContext> {
  const userId = await getAuthUserId(ctx);
  if (!userId) {
    throw new Error("Not authenticated");
  }
  const bundle = await ctx.runQuery(internal.workflowCatalogContext.catalogContextForUser, {
    instanceId,
    userId,
  });
  if (!bundle) {
    throw new Error("Not authorized or instance not found");
  }
  if (!bundle.clientId || !bundle.clientSecret) {
    throw new Error("Instance is not registered with the engine");
  }
  return {
    url: bundle.url,
    applicationId: bundle.applicationId,
    clientId: bundle.clientId,
    clientSecret: bundle.clientSecret,
  };
}

export const createScene = action({
  args: {
    instanceId: v.id("instances"),
    name: v.string(),
    description: v.optional(v.string()),
    widgetsJson: v.optional(v.string()),
    layoutJson: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ engineSceneId: string }> => {
    const bundle = await requireInstanceContext(ctx, args.instanceId);
    const correlationKey = crypto.randomUUID();

    const rpc = createEngineRpcSession<EngineApi>(bundle.url, bundle.clientId, bundle.clientSecret);
    const result = await rpc.createScene({
      name: args.name,
      accountId: bundle.applicationId,
      description: args.description,
      widgetsJson: args.widgetsJson ?? "[]",
      layoutJson: args.layoutJson ?? "{}",
      correlationKey,
    });

    return { engineSceneId: result.id };
  },
});

export const updateScene = action({
  args: {
    instanceId: v.id("instances"),
    engineSceneId: v.string(),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    widgetsJson: v.optional(v.string()),
    layoutJson: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ success: boolean }> => {
    const bundle = await requireInstanceContext(ctx, args.instanceId);
    const correlationKey = crypto.randomUUID();

    const rpc = createEngineRpcSession<EngineApi>(bundle.url, bundle.clientId, bundle.clientSecret);
    const result = await rpc.updateScene(args.engineSceneId, {
      name: args.name,
      description: args.description,
      widgetsJson: args.widgetsJson,
      layoutJson: args.layoutJson,
      correlationKey,
    });

    return { success: result.success };
  },
});

export const deleteScene = action({
  args: {
    instanceId: v.id("instances"),
    engineSceneId: v.string(),
  },
  handler: async (ctx, args): Promise<{ success: boolean }> => {
    const bundle = await requireInstanceContext(ctx, args.instanceId);
    const correlationKey = crypto.randomUUID();

    const rpc = createEngineRpcSession<EngineApi>(bundle.url, bundle.clientId, bundle.clientSecret);
    const result = await rpc.deleteScene(args.engineSceneId, correlationKey);

    return { success: result.success };
  },
});

export const getAvailableWidgets = action({
  args: {
    instanceId: v.id("instances"),
  },
  handler: async (ctx, args): Promise<{
    widgets: Array<{
      id: string;
      manifestId: string;
      name: string;
      description: string;
      directory: string;
      alertTypes: string[];
      settingsSchema: string;
      surface: string;
    }>;
  }> => {
    const bundle = await requireInstanceContext(ctx, args.instanceId);

    const rpc = createEngineRpcSession<EngineApi>(bundle.url, bundle.clientId, bundle.clientSecret);
    const result = await rpc.getAvailableWidgets();

    return {
      widgets: (result.widgets ?? []).filter((w) => w.surface === "scene"),
    };
  },
});
