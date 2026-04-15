"use node";

import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { action, internalAction } from "./_generated/server";
import { createEngineRpcSession, type RpcTarget } from "./lib/engineInstanceUrl";

interface ModuleInstallRpc extends RpcTarget {
  installModuleZip(fileName: string, zipBase64: string): Promise<unknown>;
}

interface ModuleManageRpc extends RpcTarget {
  listEngineModules(): Promise<unknown>;
  uninstallEngineModule(name: string): Promise<unknown>;
  setEngineModuleState(name: string, state: string): Promise<unknown>;
  sendChatMessage(message: string): Promise<unknown>;
  getWorkflows(query: { accountId: string }): Promise<unknown>;
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

    const rpc = createEngineRpcSession<ModuleManageRpc>(bundle.url, bundle.clientId, bundle.clientSecret);

    try {
      const result = (await (rpc as any).listEngineModules()) as Array<{
        name?: string;
        version?: string;
        state?: string;
      }>;

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

export const uninstallEngineModule = action({
  args: { instanceId: v.id("instances"), name: v.string() },
  handler: async (ctx, { instanceId, name }) => {
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

    const rpc = createEngineRpcSession<ModuleManageRpc>(bundle.url, bundle.clientId, bundle.clientSecret);

    await (rpc as any).uninstallEngineModule(name);
    return { success: true };
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

    const rpc = createEngineRpcSession<ModuleManageRpc>(bundle.url, bundle.clientId, bundle.clientSecret);

    await (rpc as any).setEngineModuleState(name, state);
    return { success: true };
  },
});

export const deliverZipToInstance = internalAction({
  args: {
    instanceId: v.id("instances"),
    moduleId: v.id("moduleRepository"),
  },
  handler: async (ctx, args) => {
    await ctx.runMutation(internal.moduleRepository.updateStatus, {
      moduleId: args.moduleId,
      status: "delivering",
    });

    try {
      const delivery = await ctx.runQuery(internal.moduleRepository.getInstallDeliveryData, args);
      const archiveRes = await fetch(delivery.archiveUrl);
      if (!archiveRes.ok) {
        throw new Error(`Failed to fetch module archive: ${archiveRes.status} ${archiveRes.statusText}`);
      }
      const archiveBuffer = await archiveRes.arrayBuffer();
      const zipBase64 = Buffer.from(archiveBuffer).toString("base64");

      if (!delivery.clientId || !delivery.clientSecret) {
        throw new Error("Instance is not registered with the engine");
      }
      const rpc = createEngineRpcSession<ModuleInstallRpc>(
        delivery.instanceUrl,
        delivery.clientId,
        delivery.clientSecret,
      );
      await rpc.installModuleZip(delivery.fileName, zipBase64);

      // Note: status transitions to "installed" when the engine sends the
      // module.installed webhook callback. The action only confirms delivery.
      return { delivered: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await ctx.runMutation(internal.moduleRepository.updateStatus, {
        moduleId: args.moduleId,
        status: "failed",
        statusMessage: message,
      });
      throw err;
    }
  },
});
