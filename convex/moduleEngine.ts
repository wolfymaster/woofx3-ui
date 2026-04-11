"use node";

import { newHttpBatchRpcSession } from "capnweb";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";

function normalizeEngineApiUrl(instanceUrl: string): string {
  const trimmed = instanceUrl.trim();
  if (!trimmed) {
    throw new Error("Instance URL is empty");
  }
  if (trimmed.includes("://")) {
    const parsed = new URL(trimmed);
    return `${parsed.protocol}//${parsed.host}/api`;
  }
  return `https://${trimmed}/api`;
}

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

      const apiUrl = normalizeEngineApiUrl(delivery.instanceUrl);
      const headers: Record<string, string> = {};
      if (delivery.apiKey) {
        headers["Authorization"] = `Bearer ${delivery.apiKey}`;
      }
      if (delivery.applicationId) {
        headers["X-Application-Id"] = delivery.applicationId;
      }
      const rpcInit = Object.keys(headers).length > 0
        ? new Request(apiUrl, { headers })
        : apiUrl;
      const rpc = newHttpBatchRpcSession<{
        installModuleZip(fileName: string, zipBase64: string): Promise<unknown>;
      }>(rpcInit);
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
