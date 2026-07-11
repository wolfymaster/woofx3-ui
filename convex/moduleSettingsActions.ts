"use node";

import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";

export interface ModuleSettingValue {
  id: string;
  moduleId: string;
  key: string;
  value: string;
  valueType: string;
}

export const getModuleSettings = action({
  args: {
    instanceId: v.id("instances"),
    moduleId: v.string(),
  },
  handler: async (ctx, { instanceId, moduleId }): Promise<ModuleSettingValue[]> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }
    const instance: { url: string } | null = await ctx.runQuery(internal.instances.getInternal, { instanceId });
    if (!instance) {
      throw new Error("Instance not found");
    }
    const resp = await fetch(
      `${instance.url}/modules/${encodeURIComponent(moduleId)}/settings`
    );
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`Failed to fetch module settings: ${resp.status} ${text}`);
    }
    const data = await resp.json() as { settings?: ModuleSettingValue[] };
    return data.settings ?? [];
  },
});

export const updateModuleSetting = action({
  args: {
    instanceId: v.id("instances"),
    moduleId: v.string(),
    key: v.string(),
    value: v.string(),
  },
  handler: async (ctx, { instanceId, moduleId, key, value }): Promise<ModuleSettingValue> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }
    const instance: { url: string } | null = await ctx.runQuery(internal.instances.getInternal, { instanceId });
    if (!instance) {
      throw new Error("Instance not found");
    }
    const resp = await fetch(
      `${instance.url}/modules/${encodeURIComponent(moduleId)}/settings/${encodeURIComponent(key)}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value }),
      }
    );
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`Failed to update module setting: ${resp.status} ${text}`);
    }
    return resp.json() as Promise<ModuleSettingValue>;
  },
});
