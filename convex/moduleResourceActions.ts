"use node";

import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";

interface CreatedInstance {
  canonicalId: string;
  displayName: string;
  instanceId: string;
}

export const createResourceInstance = action({
  args: {
    instanceId: v.id("instances"),
    moduleName: v.string(),
    kind: v.string(),
    resourceInstanceId: v.string(),
    displayName: v.string(),
  },
  handler: async (ctx, { instanceId, moduleName, kind, resourceInstanceId, displayName }): Promise<CreatedInstance> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }
    const instance: { url: string } | null = await ctx.runQuery(internal.instances.getInternal, { instanceId });
    if (!instance) {
      throw new Error("Instance not found");
    }
    const resp = await fetch(
      `${instance.url}/modules/${encodeURIComponent(moduleName)}/resources/${encodeURIComponent(kind)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instanceId: resourceInstanceId, displayName }),
      }
    );
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`Failed to create resource instance: ${resp.status} ${text}`);
    }
    return resp.json() as Promise<CreatedInstance>;
  },
});

export const deleteResourceInstance = action({
  args: {
    instanceId: v.id("instances"),
    moduleName: v.string(),
    kind: v.string(),
    resourceInstanceId: v.string(),
  },
  handler: async (ctx, { instanceId, moduleName, kind, resourceInstanceId }): Promise<void> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }
    const instance: { url: string } | null = await ctx.runQuery(internal.instances.getInternal, { instanceId });
    if (!instance) {
      throw new Error("Instance not found");
    }
    const resp = await fetch(
      `${instance.url}/modules/${encodeURIComponent(moduleName)}/resources/${encodeURIComponent(kind)}/${encodeURIComponent(resourceInstanceId)}`,
      { method: "DELETE" }
    );
    if (!resp.ok && resp.status !== 204) {
      const text = await resp.text().catch(() => "");
      throw new Error(`Failed to delete resource instance: ${resp.status} ${text}`);
    }
  },
});
