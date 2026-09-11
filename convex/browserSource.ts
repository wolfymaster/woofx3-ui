import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { type ActionCtx, action, internalMutation, internalQuery } from "./_generated/server";
import { createEngineRpcSession, type EngineApi } from "./lib/engineInstanceUrl";
import { isCurrentSceneUrl } from "./lib/sceneOverlayUrl";

export const getDefaultScene = internalQuery({
  args: { instanceId: v.string() },
  handler: async (ctx, args) => {
    const scenes = await ctx.db
      .query("scenes")
      .withIndex("by_instance", (q) => q.eq("instanceId", args.instanceId as any))
      .first();
    return scenes;
  },
});

export const getAlertDescriptor = internalQuery({
  args: { sceneId: v.string(), alertType: v.string() },
  handler: async (ctx, args) => {
    const descriptors = await ctx.db
      .query("alertDescriptors")
      .withIndex("by_scene", (q) => q.eq("sceneId", args.sceneId as any))
      .collect();
    // Filter by alertType - matches if array contains the type or "*"
    return (
      descriptors.find((d) => {
        const types = d.alertTypes ?? [];
        return types.includes(args.alertType) || types.includes("*");
      }) ?? null
    );
  },
});

export const createAlert = internalMutation({
  args: {
    instanceId: v.string(),
    sceneId: v.string(),
    sourceKey: v.string(),
    alertType: v.string(),
    user: v.string(),
    amount: v.optional(v.number()),
    message: v.optional(v.string()),
    tier: v.optional(v.string()),
    rawPayload: v.any(),
    priority: v.number(),
    ttl: v.number(),
    expiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    const alertId = await ctx.db.insert("alerts", {
      instanceId: args.instanceId as any,
      sceneId: args.sceneId as any,
      sourceKey: args.sourceKey,
      alertType: args.alertType,
      user: args.user,
      amount: args.amount,
      message: args.message,
      tier: args.tier,
      rawPayload: args.rawPayload,
      state: "pending",
      priority: args.priority,
      ttl: args.ttl,
      expiresAt: args.expiresAt,
      createdAt: Date.now(),
    });
    return alertId;
  },
});

export const getSourceKeyByKey = internalQuery({
  args: { key: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("browserSourceKeys")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .first();
  },
});

export const getAllBrowserSourceKeys = internalQuery({
  args: {},
  handler: async (ctx) => {
    const keys = await ctx.db.query("browserSourceKeys").collect();
    return keys.map((k) => ({
      keyPrefix: k.key.substring(0, 8),
      total: keys.length,
      keys: keys.map((k) => k.key.substring(0, 8)),
    }));
  },
});

export const getAllBrowserSourceKeysDebug = internalQuery({
  args: {},
  handler: async (ctx) => {
    const keys = await ctx.db.query("browserSourceKeys").collect();
    return keys.map((k) => ({
      key: k.key,
      sceneId: k.sceneId,
    }));
  },
});

export const updateSourceKeyLastUsed = internalMutation({
  args: { keyId: v.id("browserSourceKeys"), lastUsedAt: v.number() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.keyId, { lastUsedAt: args.lastUsedAt });
  },
});

export const getScene = internalQuery({
  args: { sceneId: v.id("scenes") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.sceneId);
  },
});

export const getSceneSlots = internalQuery({
  args: { sceneId: v.id("scenes") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("sceneSlots")
      .withIndex("by_scene", (q) => q.eq("sceneId", args.sceneId))
      .collect();
  },
});

export const getAlertDescriptorsForScene = internalQuery({
  args: { sceneId: v.id("scenes") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("alertDescriptors")
      .withIndex("by_scene", (q) => q.eq("sceneId", args.sceneId))
      .collect();
  },
});

export const updateAlertState = internalMutation({
  args: {
    alertId: v.string(),
    state: v.union(
      v.literal("pending"),
      v.literal("rendering"),
      v.literal("complete"),
      v.literal("cancelled"),
      v.literal("expired")
    ),
    completedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const id = args.alertId as any;
    const existing = await ctx.db.get(id);
    if (!existing) return;

    const updates: Record<string, unknown> = { state: args.state };
    if (args.completedAt) {
      updates.completedAt = args.completedAt;
    }
    if (args.state === "rendering") {
      updates.claimedBy = "browser-source";
    }

    await ctx.db.patch(id, updates);
  },
});

export const getAlert = internalQuery({
  args: { alertId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.alertId as any);
  },
});

export const createAlertHistory = internalMutation({
  args: {
    instanceId: v.string(),
    sceneId: v.string(),
    alertType: v.string(),
    user: v.string(),
    amount: v.optional(v.number()),
    message: v.optional(v.string()),
    tier: v.optional(v.string()),
    state: v.string(),
    createdAt: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("alertHistory", {
      instanceId: args.instanceId as any,
      sceneId: args.sceneId as any,
      alertType: args.alertType,
      user: args.user,
      amount: args.amount,
      message: args.message,
      tier: args.tier,
      state: args.state,
      createdAt: args.createdAt,
    });
  },
});

type SceneResolution = { status: "not_found" } | { status: "unauthorized" } | { status: "ok"; scene: Doc<"scenes"> };

export const resolveSceneForAction = internalQuery({
  args: { sceneId: v.id("scenes"), userId: v.id("users") },
  handler: async (ctx, { sceneId, userId }): Promise<SceneResolution> => {
    const scene = await ctx.db.get(sceneId);
    if (!scene) {
      return { status: "not_found" };
    }
    const membership = await ctx.db
      .query("instanceMembers")
      .withIndex("by_instance_user", (q) => q.eq("instanceId", scene.instanceId).eq("userId", userId))
      .first();
    if (!membership) {
      return { status: "unauthorized" };
    }
    return { status: "ok", scene };
  },
});

// A row's `purpose` is undefined on rows created before that field existed —
// treated as "obs" (the only purpose that existed back then).
function matchesPurpose(row: Doc<"browserSourceKeys">, purpose: "obs" | "preview"): boolean {
  return purpose === "obs" ? row.purpose === "obs" || row.purpose === undefined : row.purpose === purpose;
}

export const getKeyForScenePurpose = internalQuery({
  args: { sceneId: v.id("scenes"), purpose: v.union(v.literal("obs"), v.literal("preview")) },
  handler: async (ctx, { sceneId, purpose }) => {
    const rows = await ctx.db
      .query("browserSourceKeys")
      .withIndex("by_scene", (q) => q.eq("sceneId", sceneId))
      .collect();
    return rows.find((row) => matchesPurpose(row, purpose)) ?? null;
  },
});

export const insertKey = internalMutation({
  args: {
    instanceId: v.id("instances"),
    sceneId: v.id("scenes"),
    key: v.string(),
    name: v.string(),
    purpose: v.union(v.literal("obs"), v.literal("preview")),
    engineTokenId: v.string(),
    overlayUrl: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("browserSourceKeys", { ...args, createdAt: Date.now() });
  },
});

export const patchKeyToken = internalMutation({
  args: { keyId: v.id("browserSourceKeys"), engineTokenId: v.string(), overlayUrl: v.string() },
  handler: async (ctx, { keyId, engineTokenId, overlayUrl }) => {
    await ctx.db.patch(keyId, { engineTokenId, overlayUrl });
  },
});

// Deletes any existing row(s) for (sceneId, purpose) — including legacy rows
// with no purpose set, when purpose is "obs" — then inserts the replacement.
// Used by rotate, where the old key must stop resolving the moment the new
// one exists.
export const replaceKeyForScenePurpose = internalMutation({
  args: {
    instanceId: v.id("instances"),
    sceneId: v.id("scenes"),
    purpose: v.union(v.literal("obs"), v.literal("preview")),
    key: v.string(),
    name: v.string(),
    engineTokenId: v.string(),
    overlayUrl: v.string(),
  },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("browserSourceKeys")
      .withIndex("by_scene", (q) => q.eq("sceneId", args.sceneId))
      .collect();
    for (const row of rows) {
      if (matchesPurpose(row, args.purpose)) {
        await ctx.db.delete(row._id);
      }
    }
    await ctx.db.insert("browserSourceKeys", {
      instanceId: args.instanceId,
      sceneId: args.sceneId,
      key: args.key,
      name: args.name,
      purpose: args.purpose,
      engineTokenId: args.engineTokenId,
      overlayUrl: args.overlayUrl,
      createdAt: Date.now(),
    });
  },
});

export const deleteKeys = internalMutation({
  args: { keyIds: v.array(v.id("browserSourceKeys")) },
  handler: async (ctx, { keyIds }) => {
    for (const keyId of keyIds) {
      await ctx.db.delete(keyId);
    }
  },
});

// Best-effort consistency for the OVERLAY_TOKEN_REVOKED webhook — a token
// might be revoked through a channel other than this file's own
// revokeOverlayToken/rotateOverlayToken calls (e.g. a direct engine-side
// operator action). Clears the cached overlayUrl so the next
// /browser-source/{key} load shows a "not ready" placeholder instead of
// iframing a dead token, without deleting the row itself (the key stays
// reusable — the next getOrCreateBrowserSourceKey/getOrCreatePreviewUrl call
// mints a fresh token in its place).
export const clearOverlayUrlByTokenId = internalMutation({
  args: { engineTokenId: v.string() },
  handler: async (ctx, { engineTokenId }) => {
    const row = await ctx.db
      .query("browserSourceKeys")
      .withIndex("by_engine_token_id", (q) => q.eq("engineTokenId", engineTokenId))
      .first();
    if (row) {
      await ctx.db.patch(row._id, { overlayUrl: undefined });
    }
  },
});

// Busts every cached overlayUrl for an instance — called after
// setOverlayPublicUrl changes what every URL should resolve to. Every
// browser-source/preview row was minted against whatever overlayPublicUrl
// was in effect at the time and never re-checks it, so without this they'd
// keep serving the old host indefinitely. Returns the engineTokenIds that
// were cleared so the caller can revoke them on the engine (the old tokens
// stay technically valid otherwise — a stale-but-working URL on the old
// host, not just a stale UI). Only clears overlayUrl, not the row itself —
// the next getOrCreateBrowserSourceKey/getOrCreatePreviewUrl call mints a
// fresh token in its place, transparently, with the same public `key`.
export const bustOverlayUrlCacheForInstance = internalMutation({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, { instanceId }): Promise<string[]> => {
    const rows = await ctx.db
      .query("browserSourceKeys")
      .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
      .collect();
    const revokedTokenIds: string[] = [];
    for (const row of rows) {
      if (row.overlayUrl === undefined) {
        continue;
      }
      await ctx.db.patch(row._id, { overlayUrl: undefined });
      if (row.engineTokenId) {
        revokedTokenIds.push(row.engineTokenId);
      }
    }
    return revokedTokenIds;
  },
});

/** Best-effort: a token whose URL we are replacing should not stay valid on the engine. */
async function revokeStaleToken(
  instance: { url: string; clientId: string; clientSecret: string },
  engineTokenId: string | undefined
): Promise<void> {
  if (!engineTokenId) {
    return;
  }
  try {
    await createEngineRpcSession<EngineApi>(instance.url, instance.clientId, instance.clientSecret).revokeOverlayToken({
      tokenId: engineTokenId,
    });
  } catch {
    // A token we can no longer reach is not a reason to withhold a working URL.
  }
}

async function requireInstanceForScene(
  ctx: ActionCtx,
  scene: Doc<"scenes">
): Promise<{ url: string; clientId: string; clientSecret: string }> {
  const instance = await ctx.runQuery(internal.instances.getInternal, { instanceId: scene.instanceId });
  if (!instance?.clientId || !instance.clientSecret) {
    throw new Error("Instance is not registered with the engine");
  }
  return { url: instance.url, clientId: instance.clientId, clientSecret: instance.clientSecret };
}

// Mints (or reuses) a "preview"-purpose overlay token for the canvas preview and
// returns the engine URL it resolves to — `{Scene Manager Public URL}/scene/
// {engineSceneId}?token={token}`, straight from the engine.
//
// The editor embeds that URL directly rather than routing through the
// /browser-source/{key} route OBS uses. That route exists to give OBS a stable
// URL whose token can be rotated underneath it; the editor is an authenticated
// view that fetches this URL itself, so it has no use for the indirection. It
// must not frame a convex.site document either: a third site in the frame's
// ancestor chain makes every engine request cross-site and drops Scene Manager's
// SameSite=Strict session cookie — the one authorizing the widget frames and the
// event stream. (The OBS route avoids the same trap by redirecting, not framing.)
// Embedded directly, a UI and an engine that share a registrable domain
// (ui.x.tv / scenes.x.tv) stay same-site and the session holds.
//
// The token is its own, separate from the "obs" purpose above, so rotating or
// revoking the public browser-source URL never disturbs (or is disturbed by)
// this preview.
//
// Returns null rather than throwing on any not-ready condition (unauthenticated
// caller, missing scene, or a scene that hasn't synced with the engine yet)
// since this only ever backs a passive preview surface, never a user-initiated
// action.
export const getOrCreatePreviewUrl = action({
  args: { sceneId: v.id("scenes") },
  handler: async (ctx, { sceneId }): Promise<string | null> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return null;
    }
    const resolved: SceneResolution = await ctx.runQuery(internal.browserSource.resolveSceneForAction, {
      sceneId,
      userId,
    });
    if (resolved.status !== "ok") {
      return null;
    }
    const { scene } = resolved;
    const engineSceneId = scene.engineSceneId;
    if (!engineSceneId) {
      return null;
    }

    const existing = await ctx.runQuery(internal.browserSource.getKeyForScenePurpose, {
      sceneId,
      purpose: "preview",
    });
    const cached = existing?.overlayUrl;
    if (isCurrentSceneUrl(cached, engineSceneId)) {
      return cached;
    }

    const instance = await requireInstanceForScene(ctx, scene);
    if (cached) {
      await revokeStaleToken(instance, existing?.engineTokenId);
    }
    const rpc = createEngineRpcSession<EngineApi>(instance.url, instance.clientId, instance.clientSecret);
    const minted = await rpc.mintOverlayToken({
      sceneId: engineSceneId,
      label: "Scene Manager Preview",
    });

    if (existing) {
      await ctx.runMutation(internal.browserSource.patchKeyToken, {
        keyId: existing._id,
        engineTokenId: minted.tokenId,
        overlayUrl: minted.url,
      });
    } else {
      await ctx.runMutation(internal.browserSource.insertKey, {
        instanceId: scene.instanceId,
        sceneId,
        key: crypto.randomUUID().replace(/-/g, ""),
        name: `${scene.name} Preview`,
        purpose: "preview",
        engineTokenId: minted.tokenId,
        overlayUrl: minted.url,
      });
    }
    return minted.url;
  },
});

// Mints (or reuses) the engine overlay token backing this scene's public OBS
// browser-source URL. `key` — Convex's own opaque public identity — never
// changes across a "get" call; only rotate/revoke touch it. Legacy rows
// (pre-dating engineTokenId/overlayUrl) are backfilled in place on next
// access rather than forcing a migration or breaking existing OBS URLs.
export const getOrCreateBrowserSourceKey = action({
  args: { sceneId: v.id("scenes") },
  handler: async (ctx, { sceneId }): Promise<string> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Unauthorized");
    }
    const resolved: SceneResolution = await ctx.runQuery(internal.browserSource.resolveSceneForAction, {
      sceneId,
      userId,
    });
    if (resolved.status === "not_found") {
      throw new Error("Scene not found");
    }
    if (resolved.status === "unauthorized") {
      throw new Error("Not authorized");
    }
    const { scene } = resolved;

    if (!scene.engineSceneId) {
      throw new Error("This scene has not finished syncing with the engine yet");
    }

    const existing = await ctx.runQuery(internal.browserSource.getKeyForScenePurpose, { sceneId, purpose: "obs" });
    const cached = existing?.overlayUrl;
    if (existing && cached && isCurrentSceneUrl(cached, scene.engineSceneId)) {
      return existing.key;
    }

    const instance = await requireInstanceForScene(ctx, scene);
    if (cached) {
      await revokeStaleToken(instance, existing?.engineTokenId);
    }
    const rpc = createEngineRpcSession<EngineApi>(instance.url, instance.clientId, instance.clientSecret);
    const minted = await rpc.mintOverlayToken({
      sceneId: scene.engineSceneId,
      label: `${scene.name} Browser Source`,
    });

    if (existing) {
      await ctx.runMutation(internal.browserSource.patchKeyToken, {
        keyId: existing._id,
        engineTokenId: minted.tokenId,
        overlayUrl: minted.url,
      });
      return existing.key;
    }

    const key = crypto.randomUUID().replace(/-/g, "");
    await ctx.runMutation(internal.browserSource.insertKey, {
      instanceId: scene.instanceId,
      sceneId,
      key,
      name: `${scene.name} Browser Source`,
      purpose: "obs",
      engineTokenId: minted.tokenId,
      overlayUrl: minted.url,
    });
    return key;
  },
});

// Revokes every "obs"-purpose browser-source key for a scene (best-effort on
// the engine — always deletes locally even if the engine call fails). Any
// OBS source pointed at an old URL immediately stops resolving.
export const revokeBrowserSourceKeys = action({
  args: { sceneId: v.id("scenes") },
  handler: async (ctx, { sceneId }): Promise<{ revoked: number }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Unauthorized");
    }
    const resolved: SceneResolution = await ctx.runQuery(internal.browserSource.resolveSceneForAction, {
      sceneId,
      userId,
    });
    if (resolved.status === "not_found") {
      throw new Error("Scene not found");
    }
    if (resolved.status === "unauthorized") {
      throw new Error("Not authorized");
    }
    const { scene } = resolved;

    const existing = await ctx.runQuery(internal.browserSource.getKeyForScenePurpose, { sceneId, purpose: "obs" });
    if (!existing) {
      return { revoked: 0 };
    }

    if (existing.engineTokenId) {
      const instance = await ctx.runQuery(internal.instances.getInternal, { instanceId: scene.instanceId });
      if (instance?.clientId && instance.clientSecret) {
        try {
          const rpc = createEngineRpcSession<EngineApi>(instance.url, instance.clientId, instance.clientSecret);
          await rpc.revokeOverlayToken({ tokenId: existing.engineTokenId });
        } catch {
          // best-effort — still delete the Convex row below
        }
      }
    }

    await ctx.runMutation(internal.browserSource.deleteKeys, { keyIds: [existing._id] });
    return { revoked: 1 };
  },
});

// Revokes the existing "obs" key (atomically, via the engine's rotate RPC
// when a token already exists) and issues a fresh one. Returns the new key
// so the caller can re-copy the URL; the old URL stops working immediately.
export const rotateBrowserSourceKey = action({
  args: { sceneId: v.id("scenes") },
  handler: async (ctx, { sceneId }): Promise<string> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Unauthorized");
    }
    const resolved: SceneResolution = await ctx.runQuery(internal.browserSource.resolveSceneForAction, {
      sceneId,
      userId,
    });
    if (resolved.status === "not_found") {
      throw new Error("Scene not found");
    }
    if (resolved.status === "unauthorized") {
      throw new Error("Not authorized");
    }
    const { scene } = resolved;
    if (!scene.engineSceneId) {
      throw new Error("This scene has not finished syncing with the engine yet");
    }

    const instance = await requireInstanceForScene(ctx, scene);
    const rpc = createEngineRpcSession<EngineApi>(instance.url, instance.clientId, instance.clientSecret);

    const existing = await ctx.runQuery(internal.browserSource.getKeyForScenePurpose, { sceneId, purpose: "obs" });
    const minted = existing?.engineTokenId
      ? await rpc.rotateOverlayToken({ tokenId: existing.engineTokenId })
      : await rpc.mintOverlayToken({ sceneId: scene.engineSceneId, label: `${scene.name} Browser Source` });

    const key = crypto.randomUUID().replace(/-/g, "");
    await ctx.runMutation(internal.browserSource.replaceKeyForScenePurpose, {
      instanceId: scene.instanceId,
      sceneId,
      purpose: "obs",
      key,
      name: `${scene.name} Browser Source`,
      engineTokenId: minted.tokenId,
      overlayUrl: minted.url,
    });

    return key;
  },
});
