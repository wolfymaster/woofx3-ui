"use node";

import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import { action } from "./_generated/server";
import { marketplaceFetch } from "./marketplace";

export type ManifestSettingAction =
  | { kind: "internal"; request: { event: string; payload?: Record<string, unknown> }; timeoutMs?: number }
  | { kind: "integration"; integration: string };

export interface ManifestSettingField {
  id: string;
  name: string;
  description: string;
  type: string;
  required: boolean;
  default?: string;
  /** Present only when `type === "button"`. */
  action?: ManifestSettingAction;
}

export interface ManifestResourceKind {
  kind: string;
  name: string;
  description: string;
  valueSchema?: Record<string, unknown>;
}

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
  /** Convex _id of the installed module, only present for installed modules. */
  moduleDbId?: string;
  /** Module-level settings declared in the manifest. */
  manifestSettings: ManifestSettingField[];
  /** Runtime instance types declared in the manifest. */
  manifestResourceKinds: ManifestResourceKind[];
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

      const detail = formatInstalledDetail(
        installedModule,
        triggers,
        actions,
        functions,
        widgets,
        installedModule.manifest
      );
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

function parseManifestSettingAction(value: unknown): ManifestSettingAction | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const o = value as Record<string, unknown>;
  if (o.kind === "integration" && typeof o.integration === "string") {
    return { kind: "integration", integration: o.integration };
  }
  if (o.kind === "internal" && o.request && typeof o.request === "object") {
    const req = o.request as Record<string, unknown>;
    if (typeof req.event !== "string") {
      return undefined;
    }
    return {
      kind: "internal",
      request: {
        event: req.event,
        ...(req.payload && typeof req.payload === "object" ? { payload: req.payload as Record<string, unknown> } : {}),
      },
      ...(typeof o.timeoutMs === "number" ? { timeoutMs: o.timeoutMs } : {}),
    };
  }
  return undefined;
}

function parseManifestSettings(manifest: unknown): ManifestSettingField[] {
  const raw = manifest && typeof manifest === "object" ? (manifest as Record<string, unknown>) : {};
  return asArr(raw.settings).map((s) => {
    const o = s && typeof s === "object" ? (s as Record<string, unknown>) : {};
    const action = parseManifestSettingAction(o.action);
    return {
      id: asStr(o.id),
      name: asStr(o.name),
      description: asStr(o.description),
      type: asStr(o.type, "string"),
      required: typeof o.required === "boolean" ? o.required : false,
      ...(o.default !== undefined ? { default: String(o.default) } : {}),
      ...(action ? { action } : {}),
    };
  }).filter((s) => s.id);
}

function parseManifestResourceKinds(manifest: unknown): ManifestResourceKind[] {
  const raw = manifest && typeof manifest === "object" ? (manifest as Record<string, unknown>) : {};
  return asArr(raw.resources).map((r) => {
    const o = r && typeof r === "object" ? (r as Record<string, unknown>) : {};
    const entry: ManifestResourceKind = {
      kind: asStr(o.kind),
      name: asStr(o.name),
      description: asStr(o.description),
    };
    if (o.valueSchema && typeof o.valueSchema === "object") {
      entry.valueSchema = o.valueSchema as Record<string, unknown>;
    }
    return entry;
  }).filter((r) => r.kind);
}

function formatInstalledDetail(
  module: {
    _id: string;
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
  widgets: Array<{ widgetId: string; name: string }>,
  manifest: unknown
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
    moduleDbId: module._id,
    manifestSettings: parseManifestSettings(manifest),
    manifestResourceKinds: parseManifestResourceKinds(manifest),
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
    manifestSettings: [],
    manifestResourceKinds: [],
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
