import { parseViewerFacts, type ViewerFact } from "@shared/viewer-facts";
import type { RpcTarget } from "@woofx3/api/client";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { action } from "./_generated/server";
import { createEngineRpcSession } from "./lib/engineInstanceUrl";

interface ViewerFactsApi extends RpcTarget {
  listViewerFacts(): Promise<unknown>;
}

import { requireInstanceRoleInAction } from "./lib/instanceAccess";

/**
 * Every value `${viewer.*}` can resolve on the instance's engine, for the
 * condition builder's field picker. Read live rather than synced: fact
 * definitions change without a callback, and the list is small.
 */
export const list = action({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, { instanceId }): Promise<ViewerFact[]> => {
    await requireInstanceRoleInAction(ctx, instanceId);
    const instance = await ctx.runQuery(internal.instances.getInternal, { instanceId });
    if (!instance?.clientId || !instance.clientSecret) {
      throw new ConvexError("This engine is not registered yet");
    }
    try {
      const raw = await createEngineRpcSession<ViewerFactsApi>(
        instance.url,
        instance.clientId,
        instance.clientSecret
      ).listViewerFacts();
      return parseViewerFacts(raw);
    } catch (error) {
      throw new ConvexError(error instanceof Error ? error.message : String(error));
    }
  },
});
