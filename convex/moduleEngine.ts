"use node";

import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import { action, internalAction } from "./_generated/server";
import { createEngineRpcSession, type EngineApi } from "./lib/engineInstanceUrl";

/**
 * Local extension of the shared EngineApi for methods the engine exposes
 * but which haven't made it into @woofx3/api yet. Remove each entry as the
 * shared interface catches up.
 */
interface LocalEngineApi extends EngineApi {
  setEngineModuleState(name: string, state: string): Promise<unknown>;
}

interface EngineModule {
  name: string;
  version: string;
  state: string;
}

export const listEngineModules = action({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, { instanceId }): Promise<EngineModule[]> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    const bundle = await ctx.runQuery(internal.workflowCatalogContext.catalogContextForUser, { instanceId, userId });
    if (!bundle) {
      throw new Error("Not authorized or instance not found");
    }

    if (!bundle.clientId || !bundle.clientSecret) {
      throw new Error("Instance is not registered with the engine");
    }

    const rpc = createEngineRpcSession<LocalEngineApi>(bundle.url, bundle.clientId, bundle.clientSecret);

    try {
      const result = await rpc.listEngineModules();

      return (result ?? [])
        .filter((m) => !!m.name)
        .map((m) => ({
          name: m.name ?? "",
          version: m.version ?? "",
          state: m.state ?? "active",
        }));
    } catch (e) {
      console.error("listEngineModules RPC failed:", e);
      throw new Error(`RPC failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  },
});

/**
 * Request an async uninstall of a module from the engine.
 *
 * Fires-and-forgets an RPC to the engine; the engine performs the uninstall in the
 * background and POSTs a module.uninstalled or module.uninstall_failed webhook back.
 * The UI subscribes to the transient event keyed by the returned moduleKey to observe
 * progress, success, or a conflict-list failure.
 */
export const requestModuleUninstall = action({
  args: { instanceId: v.id("instances"), moduleId: v.id("moduleRepository") },
  handler: async (ctx, { instanceId, moduleId }): Promise<{ moduleKey: string }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    const bundle = await ctx.runQuery(internal.workflowCatalogContext.catalogContextForUser, { instanceId, userId });
    if (!bundle) {
      throw new Error("Not authorized or instance not found");
    }
    if (!bundle.clientId || !bundle.clientSecret) {
      throw new Error("Instance is not registered with the engine");
    }

    const module = await ctx.runQuery(api.moduleRepository.get, { moduleId });
    if (!module) {
      throw new Error("Module not found");
    }

    const moduleKey = module.moduleKey ?? `${module.name}:${module.version}:manual-${Date.now()}`;

    await ctx.runMutation(internal.transientEvents.emit, {
      instanceId,
      correlationKey: moduleKey,
      type: "module.uninstall",
      status: "progress",
      message: `Requesting uninstall of ${module.name}@${module.version}...`,
      data: { moduleName: module.name, moduleVersion: module.version },
    });

    try {
      const rpc = createEngineRpcSession<LocalEngineApi>(bundle.url, bundle.clientId, bundle.clientSecret);
      await rpc.uninstallModule(module.name, { moduleKey });
      return { moduleKey };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await ctx.runMutation(internal.transientEvents.emit, {
        instanceId,
        correlationKey: moduleKey,
        type: "module.uninstall",
        status: "error",
        message: `Uninstall request failed: ${message}`,
        data: { moduleName: module.name, moduleVersion: module.version },
      });
      throw err;
    }
  },
});

export const setEngineModuleState = action({
  args: { instanceId: v.id("instances"), name: v.string(), state: v.string() },
  handler: async (ctx, { instanceId, name, state }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    const bundle = await ctx.runQuery(internal.workflowCatalogContext.catalogContextForUser, { instanceId, userId });
    if (!bundle) {
      throw new Error("Not authorized or instance not found");
    }

    if (!bundle.clientId || !bundle.clientSecret) {
      throw new Error("Instance is not registered with the engine");
    }

    const rpc = createEngineRpcSession<LocalEngineApi>(bundle.url, bundle.clientId, bundle.clientSecret);

    await rpc.setEngineModuleState(name, state);
    return { success: true };
  },
});

export const deliverZipToInstance = internalAction({
  args: {
    instanceId: v.id("instances"),
    moduleKey: v.string(),
    archiveKey: v.string(),
    fileName: v.string(),
    moduleMeta: v.object({
      name: v.string(),
      description: v.string(),
      version: v.string(),
      tags: v.array(v.string()),
      manifest: v.any(),
    }),
  },
  handler: async (ctx, args) => {
    try {
      const delivery = await ctx.runQuery(internal.moduleRepository.getDeliveryData, {
        instanceId: args.instanceId,
        archiveKey: args.archiveKey,
      });
      const archiveRes = await fetch(delivery.archiveUrl);
      if (!archiveRes.ok) {
        throw new Error(`Failed to fetch module archive: ${archiveRes.status} ${archiveRes.statusText}`);
      }
      const archiveBuffer = await archiveRes.arrayBuffer();
      const zipBase64 = Buffer.from(archiveBuffer).toString("base64");

      // Log hash components for comparison with client-side and engine-side hashes
      const { createHash } = await import("crypto");
      const serverHashHex = createHash("sha256").update(Buffer.from(archiveBuffer)).digest("hex");
      const serverShortHash = serverHashHex.slice(0, 7);
      console.log("[deliverZip] hash components", {
        moduleKey: args.moduleKey,
        zipSize: archiveBuffer.byteLength,
        fullHash: serverHashHex,
        shortHash: serverShortHash,
        fileName: args.fileName,
      });

      if (!delivery.clientId || !delivery.clientSecret) {
        throw new Error("Instance is not registered with the engine");
      }
      const rpc = createEngineRpcSession<LocalEngineApi>(
        delivery.instanceUrl,
        delivery.clientId,
        delivery.clientSecret
      );

      // Pass moduleKey in context so the engine echoes it back in the webhook
      await rpc.installModuleZip(args.fileName, zipBase64, { moduleKey: args.moduleKey });

      return { delivered: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Emit a transient error so the UI picks it up immediately
      await ctx.runMutation(internal.transientEvents.emit, {
        instanceId: args.instanceId,
        correlationKey: args.moduleKey,
        type: "module.install",
        status: "error",
        message: `Delivery failed: ${message}`,
        data: { moduleName: args.moduleMeta.name, moduleVersion: args.moduleMeta.version },
      });
      throw err;
    }
  },
});
