"use node";

import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import { action } from "./_generated/server";
import { marketplaceFetch } from "./marketplace";

export interface ModuleDetailResult {
  id: string;
  name: string;
  description: string;
  version: string;
  /** Latest version available in the marketplace, when the module is published there. */
  latestVersion?: string;
  author: string;
  category: string;
  tags: string[];
  iconUrl?: string;
  readme?: string;
  isInstalled: boolean;
  triggers: Array<{ key: string; name: string; description: string; color: string }>;
  actions: Array<{ key: string; name: string; description: string; color: string }>;
  functions: Array<{ qualifiedName: string; runtime?: string }>;
  widgets: Array<{ slug: string; name: string }>;
  workflows: Array<{ slug: string; name: string }>;
}

export const getModuleDetail = action({
  args: {
    instanceId: v.id("instances"),
    moduleId: v.string(),
  },
  handler: async (ctx, { instanceId, moduleId }): Promise<ModuleDetailResult> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    const installedModule = await ctx.runQuery(internal.moduleRepository.resolveModuleForDetail, {
      instanceId,
      moduleId,
    });

    if (installedModule) {
      const [triggers, actions, functions, widgets] = await Promise.all([
        ctx.runQuery(api.triggerDefinitions.listByModule, { moduleId: installedModule._id }),
        ctx.runQuery(api.actionDefinitions.listByModule, { moduleId: installedModule._id }),
        ctx.runQuery(api.moduleFunctions.listByModule, { moduleId: installedModule._id }),
        ctx.runQuery(api.moduleWidgets.listByModule, { moduleId: installedModule._id }),
      ]);
      const detail = formatInstalledDetail(installedModule, triggers, actions, functions, widgets);
      // The DB is authoritative for installed modules, but we do not store the README. Fetch it
      // (and the icon / latest version) from the marketplace and merge it in. Only attempt this when
      // the moduleKey carries a real marketplace id; a marketplace miss must not fail the detail.
      const marketplaceId = installedModule.moduleKey?.split(":")[0];
      if (marketplaceId) {
        await mergeMarketplaceMetadata(detail, marketplaceId);
      }
      return detail;
    }

    const payload = await marketplaceFetch(`/modules/${encodeURIComponent(moduleId)}`);
    return formatMarketplaceDetail(moduleId, payload);
  },
});

function formatInstalledDetail(
  module: {
    name: string;
    description: string;
    version: string;
    author?: string;
    category?: string;
    tags: string[];
    moduleKey?: string;
    status?: string;
  },
  triggers: Array<{ slug: string; name: string; description: string; color: string }>,
  actions: Array<{ slug: string; name: string; description: string; color: string }>,
  functions: Array<{ qualifiedName: string; runtime: string }>,
  widgets: Array<{ widgetId: string; name: string }>
): ModuleDetailResult {
  const mpId = module.moduleKey?.split(":")[0] ?? module.name;
  return {
    id: mpId,
    name: module.name,
    description: module.description,
    version: module.version,
    author: module.author ?? "",
    category: module.category ?? "Utilities",
    tags: module.tags,
    isInstalled: module.status === "installed",
    triggers: triggers.map((t) => ({ key: t.slug, name: t.name, description: t.description, color: t.color })),
    actions: actions.map((a) => ({ key: a.slug, name: a.name, description: a.description, color: a.color })),
    functions: functions.map((f) => ({ qualifiedName: f.qualifiedName, runtime: f.runtime })),
    widgets: widgets.map((w) => ({ slug: w.widgetId, name: w.name })),
    // The Convex workflows table carries no module link, so a module's declared workflows are not
    // available from the DB. They are merged in from the marketplace manifest (see mergeMarketplaceMetadata).
    workflows: [],
  };
}

async function mergeMarketplaceMetadata(detail: ModuleDetailResult, marketplaceId: string): Promise<void> {
  try {
    const payload = await marketplaceFetch(`/modules/${encodeURIComponent(marketplaceId)}`);
    const raw = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
    const module = raw.module && typeof raw.module === "object" ? (raw.module as Record<string, unknown>) : raw;
    if (typeof module.readme === "string") {
      detail.readme = module.readme;
    }
    if (typeof module.iconUrl === "string" && !detail.iconUrl) {
      detail.iconUrl = module.iconUrl;
    }
    if (typeof module.version === "string") {
      detail.latestVersion = module.version;
    }
    // Workflows are declared in the manifest, not synced to the Convex workflows table, so the
    // marketplace manifest is the only source for an installed module's declared workflows.
    detail.workflows = parseWorkflows(module.workflows);
  } catch {
    // Module is not published to the marketplace (e.g. a manual upload). Leave README/latestVersion/
    // workflows unset — the DB-sourced detail stands on its own.
  }
}

function parseWorkflows(value: unknown): Array<{ slug: string; name: string }> {
  return asArr(value).map((w) => {
    const o = w && typeof w === "object" ? (w as Record<string, unknown>) : {};
    return { slug: asStr(o.slug), name: asStr(o.name) };
  });
}

function asStr(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asStrArr(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((x): x is string => typeof x === "string") : [];
}

function asArr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function formatMarketplaceDetail(moduleId: string, payload: unknown): ModuleDetailResult {
  const raw = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const module =
    raw.module && typeof raw.module === "object" ? (raw.module as Record<string, unknown>) : raw;

  const result: ModuleDetailResult = {
    id: asStr(module.id, moduleId),
    name: asStr(module.name, moduleId),
    description: asStr(module.description),
    version: asStr(module.version, "0.0.0"),
    author: asStr(module.author),
    category: asStr(module.category, "Utilities"),
    tags: asStrArr(module.tags),
    isInstalled: false,
    triggers: asArr(module.triggers).map((t) => {
      const o = t && typeof t === "object" ? (t as Record<string, unknown>) : {};
      return {
        key: asStr(o.slug),
        name: asStr(o.name),
        description: asStr(o.description),
        color: asStr(o.color, "#6366f1"),
      };
    }),
    actions: asArr(module.actions).map((a) => {
      const o = a && typeof a === "object" ? (a as Record<string, unknown>) : {};
      return {
        key: asStr(o.slug),
        name: asStr(o.name),
        description: asStr(o.description),
        color: asStr(o.color, "#6366f1"),
      };
    }),
    functions: asArr(module.functions).map((f) => {
      const o = f && typeof f === "object" ? (f as Record<string, unknown>) : {};
      const entry: { qualifiedName: string; runtime?: string } = { qualifiedName: asStr(o.qualifiedName) };
      if (typeof o.runtime === "string") {
        entry.runtime = o.runtime;
      }
      return entry;
    }),
    widgets: asArr(module.widgets).map((w) => {
      const o = w && typeof w === "object" ? (w as Record<string, unknown>) : {};
      return { slug: asStr(o.slug), name: asStr(o.name) };
    }),
    workflows: parseWorkflows(module.workflows),
  };

  if (typeof module.iconUrl === "string") {
    result.iconUrl = module.iconUrl;
  }
  if (typeof module.readme === "string") {
    result.readme = module.readme;
  }
  return result;
}
