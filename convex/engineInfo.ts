import { getAuthUserId } from "@convex-dev/auth/server";
import type { EngineInfo } from "@woofx3/api";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { action } from "./_generated/server";
import { createEngineRpcSession, type EngineApi } from "./lib/engineInstanceUrl";

// Single call per settings page visit — not a hot path, so no caching.
export const getEngineInfo = action({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, args): Promise<EngineInfo | null> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return null;
    }

    const bundle: { url: string; clientId: string | null; clientSecret: string | null } | null = await ctx.runQuery(
      internal.workflowCatalogContext.catalogContextForUser,
      {
        instanceId: args.instanceId,
        userId,
      }
    );
    if (!bundle) {
      return null;
    }

    if (!bundle.clientId || !bundle.clientSecret) {
      return null;
    }

    try {
      const rpc = createEngineRpcSession<EngineApi>(bundle.url, bundle.clientId, bundle.clientSecret);
      return await rpc.getEngineInfo();
    } catch {
      return null;
    }
  },
});

// Changing this setting changes what every already-minted browser-source/
// preview URL should resolve to, but those URLs are cached (see
// convex/browserSource.ts's browserSourceKeys.overlayUrl) rather than
// resolved fresh on every load. So a successful update busts that cache for
// this instance — clearing overlayUrl on every row (they lazily re-mint on
// next access, keeping the same public `key`) and best-effort revoking the
// old engine tokens (otherwise they'd stay valid indefinitely — a
// stale-but-working URL on the old host, not just a stale UI).
export const setOverlayPublicUrl = action({
  args: {
    instanceId: v.id("instances"),
    value: v.string(),
  },
  handler: async (ctx, args): Promise<{ success: boolean }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    const bundle: { url: string; clientId: string | null; clientSecret: string | null } | null = await ctx.runQuery(
      internal.workflowCatalogContext.catalogContextForUser,
      {
        instanceId: args.instanceId,
        userId,
      }
    );
    if (!bundle) {
      throw new Error("Not authorized");
    }

    if (!bundle.clientId || !bundle.clientSecret) {
      throw new Error("Instance not registered with engine");
    }
    const { url, clientId, clientSecret } = bundle;

    const result = await createEngineRpcSession<EngineApi>(url, clientId, clientSecret).setOverlayPublicUrl(args.value);
    if (!result.success) {
      return result;
    }

    const staleTokenIds: string[] = await ctx.runMutation(internal.browserSource.bustOverlayUrlCacheForInstance, {
      instanceId: args.instanceId,
    });
    for (const tokenId of staleTokenIds) {
      try {
        await createEngineRpcSession<EngineApi>(url, clientId, clientSecret).revokeOverlayToken({ tokenId });
      } catch {
        // best-effort — the cache is already busted either way, so the next
        // access still mints a fresh token; a failed revoke here just means
        // the old token lingers as valid-but-unused rather than tombstoned.
      }
    }

    return result;
  },
});
