import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { type ActionCtx, action } from "./_generated/server";
import { createEngineRpcSession, type EngineApi } from "./lib/engineInstanceUrl";

// Chat commands and their permission groups are engine-authoritative (see
// docs/services/commands-ui.md in the woofx3 engine repo). Every write here
// calls the engine RPC first, then immediately mirrors the engine's own
// response into the local read cache (convex/chatCommands.ts /
// convex/chatCommandGroups.ts) so the calling browser sees its own change
// right away without waiting on the command.*/group.* webhooks — those
// webhooks exist purely to pick up changes made from other sessions.

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

const commandTypeValidator = v.union(v.literal("text"), v.literal("function"));
const visibilityValidator = v.union(v.literal("public"), v.literal("restricted"));

export const createCommand = action({
  args: {
    instanceId: v.id("instances"),
    command: v.string(),
    type: commandTypeValidator,
    typeValue: v.string(),
    cooldown: v.number(),
    priority: v.optional(v.number()),
    enabled: v.boolean(),
    visibility: visibilityValidator,
    groupIds: v.optional(v.array(v.string())),
    usernames: v.optional(v.array(v.string())),
    argumentPattern: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ engineCommandId: string }> => {
    const bundle = await requireInstanceContext(ctx, args.instanceId);
    const correlationKey = crypto.randomUUID();

    const rpc = createEngineRpcSession<EngineApi>(bundle.url, bundle.clientId, bundle.clientSecret);
    const result = await rpc.createCommand({
      command: args.command,
      type: args.type,
      typeValue: args.typeValue,
      cooldown: args.cooldown,
      priority: args.priority,
      enabled: args.enabled,
      visibility: args.visibility,
      groupIds: args.groupIds,
      usernames: args.usernames,
      argumentPattern: args.argumentPattern,
      correlationKey,
    });

    await ctx.runMutation(internal.chatCommands.upsertFromWebhook, {
      instanceId: args.instanceId,
      applicationId: result.applicationId,
      engineCommandId: result.id,
      command: result.command,
      type: result.type,
      typeValue: result.typeValue,
      cooldown: result.cooldown,
      priority: result.priority,
      enabled: result.enabled,
      visibility: result.visibility,
      groupIds: result.groupIds ?? [],
      usernames: result.usernames ?? [],
      argumentPattern: result.argumentPattern,
    });

    return { engineCommandId: result.id };
  },
});

export const updateCommand = action({
  args: {
    instanceId: v.id("instances"),
    engineCommandId: v.string(),
    command: v.string(),
    type: commandTypeValidator,
    typeValue: v.string(),
    cooldown: v.number(),
    priority: v.number(),
    enabled: v.boolean(),
    visibility: visibilityValidator,
    groupIds: v.optional(v.array(v.string())),
    usernames: v.optional(v.array(v.string())),
    argumentPattern: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ engineCommandId: string }> => {
    const bundle = await requireInstanceContext(ctx, args.instanceId);
    const correlationKey = crypto.randomUUID();

    const rpc = createEngineRpcSession<EngineApi>(bundle.url, bundle.clientId, bundle.clientSecret);
    const result = await rpc.updateCommand(args.engineCommandId, {
      command: args.command,
      type: args.type,
      typeValue: args.typeValue,
      cooldown: args.cooldown,
      priority: args.priority,
      enabled: args.enabled,
      visibility: args.visibility,
      groupIds: args.groupIds,
      usernames: args.usernames,
      argumentPattern: args.argumentPattern,
      correlationKey,
    });

    await ctx.runMutation(internal.chatCommands.upsertFromWebhook, {
      instanceId: args.instanceId,
      applicationId: result.applicationId,
      engineCommandId: result.id,
      command: result.command,
      type: result.type,
      typeValue: result.typeValue,
      cooldown: result.cooldown,
      priority: result.priority,
      enabled: result.enabled,
      visibility: result.visibility,
      groupIds: result.groupIds ?? [],
      usernames: result.usernames ?? [],
      argumentPattern: result.argumentPattern,
    });

    return { engineCommandId: result.id };
  },
});

export const deleteCommand = action({
  args: {
    instanceId: v.id("instances"),
    engineCommandId: v.string(),
  },
  handler: async (ctx, args): Promise<{ deleted: boolean }> => {
    const bundle = await requireInstanceContext(ctx, args.instanceId);
    const correlationKey = crypto.randomUUID();

    const rpc = createEngineRpcSession<EngineApi>(bundle.url, bundle.clientId, bundle.clientSecret);
    const result = await rpc.deleteCommand(args.engineCommandId, correlationKey);

    if (result.deleted) {
      await ctx.runMutation(internal.chatCommands.deleteFromWebhook, {
        instanceId: args.instanceId,
        engineCommandId: args.engineCommandId,
      });
    }

    return { deleted: result.deleted };
  },
});

export const createGroup = action({
  args: {
    instanceId: v.id("instances"),
    name: v.string(),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ engineGroupId: string }> => {
    const bundle = await requireInstanceContext(ctx, args.instanceId);
    const correlationKey = crypto.randomUUID();

    const rpc = createEngineRpcSession<EngineApi>(bundle.url, bundle.clientId, bundle.clientSecret);
    const result = await rpc.createGroup({
      name: args.name,
      description: args.description,
      correlationKey,
    });

    await ctx.runMutation(internal.chatCommandGroups.upsertFromWebhook, {
      instanceId: args.instanceId,
      applicationId: result.applicationId,
      engineGroupId: result.id,
      name: result.name,
      description: result.description,
      isBuiltIn: result.isBuiltIn,
      engineCreatedAt: result.createdAt,
    });

    return { engineGroupId: result.id };
  },
});

export const updateGroup = action({
  args: {
    instanceId: v.id("instances"),
    engineGroupId: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ engineGroupId: string }> => {
    const bundle = await requireInstanceContext(ctx, args.instanceId);
    const correlationKey = crypto.randomUUID();

    const rpc = createEngineRpcSession<EngineApi>(bundle.url, bundle.clientId, bundle.clientSecret);
    const result = await rpc.updateGroup(args.engineGroupId, {
      name: args.name,
      description: args.description,
      correlationKey,
    });

    await ctx.runMutation(internal.chatCommandGroups.upsertFromWebhook, {
      instanceId: args.instanceId,
      applicationId: result.applicationId,
      engineGroupId: result.id,
      name: result.name,
      description: result.description,
      isBuiltIn: result.isBuiltIn,
      engineCreatedAt: result.createdAt,
    });

    return { engineGroupId: result.id };
  },
});

export const deleteGroup = action({
  args: {
    instanceId: v.id("instances"),
    engineGroupId: v.string(),
  },
  handler: async (ctx, args): Promise<{ deleted: boolean }> => {
    const bundle = await requireInstanceContext(ctx, args.instanceId);
    const correlationKey = crypto.randomUUID();

    const rpc = createEngineRpcSession<EngineApi>(bundle.url, bundle.clientId, bundle.clientSecret);
    const result = await rpc.deleteGroup(args.engineGroupId, correlationKey);

    if (result.deleted) {
      await ctx.runMutation(internal.chatCommandGroups.deleteFromWebhook, {
        instanceId: args.instanceId,
        engineGroupId: args.engineGroupId,
      });
    }

    return { deleted: result.deleted };
  },
});

export const addUserToGroup = action({
  args: {
    instanceId: v.id("instances"),
    engineGroupId: v.string(),
    username: v.string(),
  },
  handler: async (ctx, args): Promise<{ ok: true }> => {
    const bundle = await requireInstanceContext(ctx, args.instanceId);
    const username = args.username.trim().toLowerCase();

    const rpc = createEngineRpcSession<EngineApi>(bundle.url, bundle.clientId, bundle.clientSecret);
    const result = await rpc.addUserToGroup(args.engineGroupId, username);

    await ctx.runMutation(internal.chatCommandGroups.addMemberFromWebhook, {
      instanceId: args.instanceId,
      engineGroupId: args.engineGroupId,
      username,
    });

    return result;
  },
});

export const removeUserFromGroup = action({
  args: {
    instanceId: v.id("instances"),
    engineGroupId: v.string(),
    username: v.string(),
  },
  handler: async (ctx, args): Promise<{ ok: true }> => {
    const bundle = await requireInstanceContext(ctx, args.instanceId);
    const username = args.username.trim().toLowerCase();

    const rpc = createEngineRpcSession<EngineApi>(bundle.url, bundle.clientId, bundle.clientSecret);
    const result = await rpc.removeUserFromGroup(args.engineGroupId, username);

    await ctx.runMutation(internal.chatCommandGroups.removeMemberFromWebhook, {
      instanceId: args.instanceId,
      engineGroupId: args.engineGroupId,
      username,
    });

    return result;
  },
});
