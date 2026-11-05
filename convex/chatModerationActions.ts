import { ENGINE_CAPABILITIES } from "@woofx3/api/capabilities";
import {
  MODERATION_ACTIONS_DEFAULT_LIMIT,
  type ModerationActionRecord,
  type ModerationConfig,
  parseModerationConfig,
} from "@woofx3/api/moderation-config";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { type ActionCtx, action } from "./_generated/server";
import { createEngineRpcSession, type EngineApi } from "./lib/engineInstanceUrl";
import { requireInstanceRoleInAction } from "./lib/instanceAccess";

// Chat moderation's config lives in the engine, which runs it on chat; these
// actions only relay to its RPCs (getModerationConfig, setModerationConfig,
// listModerationActions). Nothing is kept in Convex.
//
// Failures leave as ConvexError carrying the sentence to show: in production
// Convex replaces a plain Error's message with "Server Error".

/** What the moderation page reads: the config, or that this engine is too old to moderate chat. */
export type ChatModerationRead = { kind: "unsupported" } | { kind: "ready"; config: ModerationConfig };

async function engineFor(ctx: ActionCtx, instanceId: Id<"instances">, userId: Id<"users">) {
  const bundle = await ctx.runQuery(internal.workflowCatalogContext.catalogContextForUser, { instanceId, userId });
  if (!bundle) {
    throw new ConvexError("This instance could not be found.");
  }
  if (!bundle.clientId || !bundle.clientSecret) {
    throw new ConvexError("This instance is not connected to its engine yet.");
  }
  const { url, clientId, clientSecret } = bundle;
  // A capnweb HTTP batch session is single-use, so each call gets its own.
  return () => createEngineRpcSession<EngineApi>(url, clientId, clientSecret);
}

function readable(error: unknown): ConvexError<string> {
  return new ConvexError(error instanceof Error ? error.message : String(error));
}

export const getConfig = action({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, args): Promise<ChatModerationRead> => {
    const userId = await requireInstanceRoleInAction(ctx, args.instanceId, "member");
    const session = await engineFor(ctx, args.instanceId, userId);
    try {
      const { capabilities } = await session().getEngineCapabilities();
      if (!capabilities.includes(ENGINE_CAPABILITIES.moderationConfig)) {
        return { kind: "unsupported" };
      }
      return { kind: "ready", config: await session().getModerationConfig() };
    } catch (error) {
      throw readable(error);
    }
  },
});

export const setConfig = action({
  // Checked by the shared parser below, then again by the engine.
  args: { instanceId: v.id("instances"), config: v.any() },
  handler: async (ctx, args): Promise<ModerationConfig> => {
    // Moderation acts on chat for the whole channel, so it is an owner's or admin's change.
    const userId = await requireInstanceRoleInAction(ctx, args.instanceId, "admin");
    const parsed = parseModerationConfig(args.config);
    if (!parsed.ok) {
      throw new ConvexError(parsed.error);
    }
    const session = await engineFor(ctx, args.instanceId, userId);
    try {
      return await session().setModerationConfig(parsed.value);
    } catch (error) {
      throw readable(error);
    }
  },
});

export const listRecentActions = action({
  args: { instanceId: v.id("instances"), limit: v.optional(v.number()) },
  handler: async (ctx, args): Promise<ModerationActionRecord[]> => {
    const userId = await requireInstanceRoleInAction(ctx, args.instanceId, "member");
    const session = await engineFor(ctx, args.instanceId, userId);
    try {
      return await session().listModerationActions(args.limit ?? MODERATION_ACTIONS_DEFAULT_LIMIT);
    } catch (error) {
      throw readable(error);
    }
  },
});
