"use node";

import { type ConfigField, LIST_ITEM_FIELD_TYPES, parseFieldList } from "@woofx3/api/ui-schema";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { action } from "./_generated/server";
import { requireInstanceRoleInAction } from "./lib/instanceAccess";
import { type LocalEndpointSummary, localEndpointSummaries } from "./lib/localEndpoints";
import type { MarketplaceAccess } from "./lib/marketplaceAccess";
import {
  installedFunctionSummaries,
  type ModuleFunctionSummary,
  marketplaceFunctionSummaries,
  type RegisteredFunction,
} from "./lib/moduleFunctionSummary";
import { moduleOAuthIntegrationIds } from "./lib/moduleOAuth";
import { parseManifestPermissions } from "./lib/modulePermissions";
import { type ManifestResourceKind, parseManifestResourceKinds } from "./lib/resourceKinds";
import { logger } from "./logger";
import {
  fetchMarketplaceArchiveManifest,
  fetchMarketplaceDownload,
  marketplaceAccessForInstance,
  marketplaceFetch,
} from "./marketplace";

export type ManifestSettingAction =
  | { kind: "internal"; request: { event: string; payload?: Record<string, unknown> }; timeoutMs?: number }
  | {
      kind: "integration";
      integration: string;
      /**
       * Whether the manifest declares the integration under `oauth[]`, the
       * only integrations a button can connect (moduleOAuth.ts).
       */
      declared: boolean;
    };

export interface ManifestSettingField {
  id: string;
  label: string;
  description: string;
  type: string;
  required: boolean;
  defaultValue?: string;
  /** Present only when `type === "button"`. */
  action?: ManifestSettingAction;
  /** Present only when `type === "resource_ref"`: the kind of instance it links. */
  resourceKind?: string;
  /**
   * Present only when `type === "list"`: the fields of one row. The value is
   * stored as a JSON array of objects keyed by these fields' ids.
   */
  itemFields?: ConfigField[];
}

export type { ManifestResourceKind, ModuleFunctionSummary };

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
  functions: ModuleFunctionSummary[];
  widgets: Array<{ slug: string; name: string }>;
  workflows: Array<{ slug: string; name: string }>;
  /** Convex _id of the installed module, only present for installed modules. */
  moduleDbId?: string;
  /** Module-level settings declared in the manifest. */
  manifestSettings: ManifestSettingField[];
  /** Runtime instance types declared in the manifest. */
  manifestResourceKinds: ManifestResourceKind[];
  /**
   * Permission ids the manifest of `version` declares. Null when they could not
   * be read (an installed row with no stored manifest, or an unreachable
   * marketplace archive).
   */
  permissions: string[] | null;
  /**
   * Permission ids `latestVersion` declares, read from its marketplace archive.
   * Present only for an installed module whose marketplace version differs from
   * the installed one; null when that archive could not be read.
   */
  latestPermissions?: string[] | null;
  /** What the manifest of `version` reaches on the streamer's network (`local[]`); null when unreadable, like `permissions`. */
  localEndpoints: LocalEndpointSummary[] | null;
  /** `local[]` of `latestVersion`, alongside `latestPermissions`. */
  latestLocalEndpoints?: LocalEndpointSummary[] | null;
}

interface ManifestDeclarations {
  permissions: string[] | null;
  localEndpoints: LocalEndpointSummary[] | null;
}

export const getModuleDetail = action({
  args: {
    instanceId: v.id("instances"),
    moduleId: v.string(),
  },
  handler: async (ctx, { instanceId, moduleId }): Promise<ModuleDetailResult> => {
    await requireInstanceRoleInAction(ctx, instanceId);
    const access = await marketplaceAccessForInstance(ctx, instanceId);

    const installedModule = await ctx.runQuery(internal.moduleRepository.resolveModuleForDetail, {
      instanceId,
      moduleId,
    });

    if (installedModule) {
      // The DB is authoritative for installed modules, but we do not store the README. Fetch it
      // (and the icon / latest version / workflows) from the marketplace alongside the DB queries —
      // run concurrently rather than after, since the external marketplace call can take seconds
      // (up to MARKETPLACE_TIMEOUT_MS) and gains nothing from waiting on the DB queries first. Only
      // attempted when the moduleKey carries a real marketplace id; a marketplace miss must not fail
      // the detail.
      const marketplaceId = installedModule.moduleKey?.split(":")[0];
      const [triggers, actions, functions, widgets, marketplaceMeta] = await Promise.all([
        ctx.runQuery(internal.triggerDefinitions.listByModule, { moduleId: installedModule._id }),
        ctx.runQuery(internal.actionDefinitions.listByModule, { moduleId: installedModule._id }),
        ctx.runQuery(internal.moduleFunctions.listByModule, { moduleId: installedModule._id }),
        ctx.runQuery(internal.moduleWidgets.listByModule, { moduleId: installedModule._id }),
        marketplaceId ? fetchMarketplaceMetadata(marketplaceId, access) : Promise.resolve(null),
      ]);

      const detail = formatInstalledDetail(
        installedModule,
        triggers,
        actions,
        functions,
        widgets,
        installedModule.manifest
      );
      if (marketplaceMeta) {
        applyMarketplaceMetadata(detail, marketplaceMeta);
      }
      if (marketplaceId && detail.latestVersion !== undefined && detail.latestVersion !== detail.version) {
        const latest = manifestDeclarations(await readMarketplaceManifest(marketplaceId, access));
        detail.latestPermissions = latest.permissions;
        detail.latestLocalEndpoints = latest.localEndpoints;
      }
      return detail;
    }

    const [payload, manifest] = await Promise.all([
      marketplaceFetch(`/modules/${encodeURIComponent(moduleId)}`, access),
      readMarketplaceManifest(moduleId, access),
    ]);
    return { ...formatMarketplaceDetail(moduleId, payload, manifest), ...manifestDeclarations(manifest) };
  },
});

/**
 * Null when the archive cannot be read. The detail view still renders: the
 * permissions and local endpoints show as unknown, and functions lose their
 * file paths. Install does not depend on this read: it re-reads the archive
 * and refuses permissions the streamer did not approve.
 */
async function readMarketplaceManifest(marketplaceId: string, access: MarketplaceAccess): Promise<unknown> {
  try {
    return await fetchMarketplaceArchiveManifest(await fetchMarketplaceDownload(marketplaceId, access));
  } catch (err) {
    logger.warn("could not read marketplace module manifest", {
      marketplaceId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

function manifestDeclarations(manifest: unknown): ManifestDeclarations {
  if (manifest === null) {
    return { permissions: null, localEndpoints: null };
  }
  return { permissions: parseManifestPermissions(manifest), localEndpoints: localEndpointSummaries(manifest) };
}

function parseManifestSettingAction(value: unknown, oauthIntegrations: string[]): ManifestSettingAction | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const o = value as Record<string, unknown>;
  if (o.kind === "integration" && typeof o.integration === "string") {
    return {
      kind: "integration",
      integration: o.integration,
      declared: oauthIntegrations.includes(o.integration),
    };
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

/**
 * A `list` setting's row fields, through the same parser every other `list`
 * control's go through, so the settings pane and the engine agree on which
 * row types render. `undefined` when none do: a list whose rows hold nothing
 * renderable is a half-built control and is left out.
 */
function parseSettingItemFields(raw: unknown): ConfigField[] | undefined {
  const fields = parseFieldList(JSON.stringify(Array.isArray(raw) ? raw : [])).filter((item) =>
    (LIST_ITEM_FIELD_TYPES as readonly string[]).includes(item.type)
  );
  return fields.length > 0 ? fields : undefined;
}

export function parseManifestSettings(manifest: unknown): ManifestSettingField[] {
  const raw = manifest && typeof manifest === "object" ? (manifest as Record<string, unknown>) : {};
  const oauthIntegrations = moduleOAuthIntegrationIds(manifest);
  return asArr(raw.settings)
    .map((s) => {
      const o = s && typeof s === "object" ? (s as Record<string, unknown>) : {};
      const action = parseManifestSettingAction(o.action, oauthIntegrations);
      const itemFields = o.type === "list" ? parseSettingItemFields(o.itemFields) : undefined;
      return {
        id: asStr(o.id),
        label: asStr(o.label),
        description: asStr(o.description),
        type: asStr(o.type, "string"),
        required: typeof o.required === "boolean" ? o.required : false,
        ...(o.defaultValue !== undefined ? { defaultValue: String(o.defaultValue) } : {}),
        ...(action ? { action } : {}),
        ...(typeof o.resourceKind === "string" && o.resourceKind !== "" ? { resourceKind: o.resourceKind } : {}),
        ...(itemFields ? { itemFields } : {}),
      };
    })
    .filter((s) => s.id && (s.type !== "list" || s.itemFields));
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
  functions: RegisteredFunction[],
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
    permissions: manifest === undefined || manifest === null ? null : parseManifestPermissions(manifest),
    localEndpoints: manifest === undefined || manifest === null ? null : localEndpointSummaries(manifest),
    triggers: triggers.map((t) => ({ key: t.slug, name: t.name, description: t.description, color: t.color })),
    actions: actions.map((a) => ({ key: a.slug, name: a.name, description: a.description, color: a.color })),
    functions: installedFunctionSummaries(functions, manifest),
    widgets: widgets.map((w) => ({ slug: w.widgetId, name: w.name })),
    // The Convex workflows table carries no module link, so a module's declared workflows are not
    // available from the DB. They are merged in from the marketplace manifest (see mergeMarketplaceMetadata).
    workflows: [],
  };
}

interface MarketplaceMergeData {
  readme?: string;
  iconUrl?: string;
  latestVersion?: string;
  // Workflows are declared in the manifest, not synced to the Convex workflows table, so the
  // marketplace manifest is the only source for an installed module's declared workflows.
  workflows: Array<{ slug: string; name: string }>;
}

async function fetchMarketplaceMetadata(
  marketplaceId: string,
  access: MarketplaceAccess
): Promise<MarketplaceMergeData | null> {
  try {
    const payload = await marketplaceFetch(`/modules/${encodeURIComponent(marketplaceId)}`, access);
    const raw = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
    const module = raw.module && typeof raw.module === "object" ? (raw.module as Record<string, unknown>) : raw;
    const data: MarketplaceMergeData = { workflows: parseWorkflows(module.workflows) };
    if (typeof module.readme === "string") {
      data.readme = module.readme;
    }
    if (typeof module.iconUrl === "string") {
      data.iconUrl = module.iconUrl;
    }
    if (typeof module.version === "string") {
      data.latestVersion = module.version;
    }
    return data;
  } catch {
    // Module is not published to the marketplace (e.g. a manual upload), or the marketplace is
    // unreachable — the DB-sourced detail stands on its own.
    return null;
  }
}

function applyMarketplaceMetadata(detail: ModuleDetailResult, meta: MarketplaceMergeData): void {
  if (meta.readme !== undefined) {
    detail.readme = meta.readme;
  }
  if (meta.iconUrl !== undefined && !detail.iconUrl) {
    detail.iconUrl = meta.iconUrl;
  }
  if (meta.latestVersion !== undefined) {
    detail.latestVersion = meta.latestVersion;
  }
  detail.workflows = meta.workflows;
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

function formatMarketplaceDetail(moduleId: string, payload: unknown, manifest: unknown): ModuleDetailResult {
  const raw = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const module = raw.module && typeof raw.module === "object" ? (raw.module as Record<string, unknown>) : raw;

  const id = asStr(module.id, moduleId);
  const result: ModuleDetailResult = {
    id,
    name: asStr(module.name, moduleId),
    description: asStr(module.description),
    version: asStr(module.version, "0.0.0"),
    author: asStr(module.author),
    category: asStr(module.category, "Utilities"),
    tags: asStrArr(module.tags),
    isInstalled: false,
    manifestSettings: [],
    manifestResourceKinds: [],
    permissions: null,
    localEndpoints: null,
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
    functions: marketplaceFunctionSummaries(id, asArr(module.functions), manifest),
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
