"use node";

import { createHash } from "node:crypto";
import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { action } from "./_generated/server";
import { createEngineRpcSession } from "./lib/engineInstanceUrl";
import { type MarketplaceImages, parseFeaturedRank, parseMarketplaceImages } from "./lib/marketplaceImages";
import { parseManifestPermissions, readArchiveManifest, unapprovedPermissions } from "./lib/modulePermissions";
import type { LocalEngineApi } from "./moduleEngine";

const MARKETPLACE_TIMEOUT_MS = 10_000;
const ARCHIVE_TIMEOUT_MS = 30_000;
// Module archives carry code, manifests and a few assets. The cap keeps a
// malformed or hostile listing from making a Convex action buffer an unbounded
// download just to read one small JSON file.
const MAX_ARCHIVE_BYTES = 50 * 1024 * 1024;

export interface MarketplaceTriggerSummary {
  slug: string;
  name: string;
  description: string;
  color: string;
  icon?: string;
}

export interface MarketplaceActionSummary {
  slug: string;
  name: string;
  description: string;
  color: string;
  icon?: string;
}

export interface MarketplaceFunctionSummary {
  qualifiedName: string;
  runtime?: string;
}

export interface MarketplaceWidgetSummary {
  slug: string;
  name: string;
}

export interface MarketplaceModuleCounts {
  triggers: number;
  actions: number;
  functions: number;
  widgets: number;
}

export interface MarketplaceModuleSummary {
  id: string;
  name: string;
  description: string;
  version: string;
  author: string;
  category: string;
  tags: string[];
  images: MarketplaceImages;
  /** Position in the storefront's featured set, lowest first. Absent when not featured. */
  featuredRank?: number;
  counts: MarketplaceModuleCounts;
  updatedAt?: string;
}

export interface MarketplaceModuleDetail extends MarketplaceModuleSummary {
  readme?: string;
  triggers: MarketplaceTriggerSummary[];
  actions: MarketplaceActionSummary[];
  functions: MarketplaceFunctionSummary[];
  widgets: MarketplaceWidgetSummary[];
}

function getMarketplaceUrl(): string {
  const url = process.env.MARKETPLACE_API_URL;
  if (!url) {
    throw new Error("Marketplace not configured: set MARKETPLACE_API_URL");
  }
  return url.replace(/\/$/, "");
}

export async function marketplaceFetch(path: string): Promise<unknown> {
  const base = getMarketplaceUrl();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MARKETPLACE_TIMEOUT_MS);
  try {
    const res = await fetch(`${base}${path}`, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`Marketplace request to ${path} failed: ${res.status} ${res.statusText}`);
    }
    return await res.json();
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`Marketplace request to ${path} timed out after ${MARKETPLACE_TIMEOUT_MS}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export interface MarketplaceDownload {
  url: string;
  sha256: string;
}

export async function fetchMarketplaceDownload(marketplaceModuleId: string): Promise<MarketplaceDownload> {
  const payload = await marketplaceFetch(`/modules/${encodeURIComponent(marketplaceModuleId)}/download`);
  const obj = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const url = asString(obj.url);
  if (!url) {
    throw new Error("Marketplace did not return a download URL");
  }
  const sha256 = asString(obj.sha256).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(sha256)) {
    throw new Error("Marketplace did not return a valid sha256 hash");
  }
  return { url, sha256 };
}

/**
 * The permissions declared by the manifest inside a marketplace archive.
 *
 * The marketplace API does not expose a module's permissions, so they are read
 * from the archive the engine would install. The bytes are checked against the
 * listing's sha256 so the permissions shown for approval belong to exactly the
 * build whose hash goes into the install's moduleKey.
 */
export async function fetchMarketplaceArchivePermissions(download: MarketplaceDownload): Promise<string[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ARCHIVE_TIMEOUT_MS);
  let bytes: Uint8Array;
  try {
    const res = await fetch(download.url, { method: "GET", signal: controller.signal });
    if (!res.ok) {
      throw new Error(`Module archive download failed: ${res.status} ${res.statusText}`);
    }
    const declaredLength = Number(res.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_ARCHIVE_BYTES) {
      throw new Error(`Module archive is ${declaredLength} bytes, over the ${MAX_ARCHIVE_BYTES} byte limit`);
    }
    bytes = new Uint8Array(await res.arrayBuffer());
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`Module archive download timed out after ${ARCHIVE_TIMEOUT_MS}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
  if (bytes.byteLength > MAX_ARCHIVE_BYTES) {
    throw new Error(`Module archive is ${bytes.byteLength} bytes, over the ${MAX_ARCHIVE_BYTES} byte limit`);
  }
  const actualSha256 = createHash("sha256").update(bytes).digest("hex");
  if (actualSha256 !== download.sha256) {
    throw new Error("Module archive does not match the marketplace's sha256 hash");
  }
  return parseManifestPermissions(readArchiveManifest(bytes));
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((v): v is string => typeof v === "string");
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function parseCounts(value: unknown): MarketplaceModuleCounts {
  const obj = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    triggers: asNumber(obj.triggers),
    actions: asNumber(obj.actions),
    functions: asNumber(obj.functions),
    widgets: asNumber(obj.widgets),
  };
}

function parseSummary(raw: unknown): MarketplaceModuleSummary | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const obj = raw as Record<string, unknown>;
  const id = asString(obj.id);
  if (!id) {
    return null;
  }
  const summary: MarketplaceModuleSummary = {
    id,
    name: asString(obj.name, id),
    description: asString(obj.description),
    version: asString(obj.version, "0.0.0"),
    author: asString(obj.author),
    category: asString(obj.category, "Utilities"),
    tags: asStringArray(obj.tags),
    images: parseMarketplaceImages(obj.images),
    counts: parseCounts(obj.counts),
  };
  const featuredRank = parseFeaturedRank(obj.featuredRank);
  if (featuredRank !== undefined) {
    summary.featuredRank = featuredRank;
  }
  if (typeof obj.updatedAt === "string") {
    summary.updatedAt = obj.updatedAt;
  }
  return summary;
}

function parseTriggers(value: unknown): MarketplaceTriggerSummary[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const result: MarketplaceTriggerSummary[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") {
      continue;
    }
    const obj = raw as Record<string, unknown>;
    const slug = asString(obj.slug);
    if (!slug) {
      continue;
    }
    const entry: MarketplaceTriggerSummary = {
      slug,
      name: asString(obj.name, slug),
      description: asString(obj.description),
      color: asString(obj.color, "#888888"),
    };
    if (typeof obj.icon === "string") {
      entry.icon = obj.icon;
    }
    result.push(entry);
  }
  return result;
}

function parseActions(value: unknown): MarketplaceActionSummary[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const result: MarketplaceActionSummary[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") {
      continue;
    }
    const obj = raw as Record<string, unknown>;
    const slug = asString(obj.slug);
    if (!slug) {
      continue;
    }
    const entry: MarketplaceActionSummary = {
      slug,
      name: asString(obj.name, slug),
      description: asString(obj.description),
      color: asString(obj.color, "#888888"),
    };
    if (typeof obj.icon === "string") {
      entry.icon = obj.icon;
    }
    result.push(entry);
  }
  return result;
}

function parseFunctions(value: unknown): MarketplaceFunctionSummary[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const result: MarketplaceFunctionSummary[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") {
      continue;
    }
    const obj = raw as Record<string, unknown>;
    const qualifiedName = asString(obj.qualifiedName);
    if (!qualifiedName) {
      continue;
    }
    const entry: MarketplaceFunctionSummary = { qualifiedName };
    if (typeof obj.runtime === "string") {
      entry.runtime = obj.runtime;
    }
    result.push(entry);
  }
  return result;
}

function parseWidgets(value: unknown): MarketplaceWidgetSummary[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const result: MarketplaceWidgetSummary[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") {
      continue;
    }
    const obj = raw as Record<string, unknown>;
    const slug = asString(obj.slug);
    if (!slug) {
      continue;
    }
    result.push({ slug, name: asString(obj.name, slug) });
  }
  return result;
}

function parseDetail(raw: unknown): MarketplaceModuleDetail | null {
  const summary = parseSummary(raw);
  if (!summary || !raw || typeof raw !== "object") {
    return null;
  }
  const obj = raw as Record<string, unknown>;
  const triggers = parseTriggers(obj.triggers);
  const actions = parseActions(obj.actions);
  const functions = parseFunctions(obj.functions);
  const widgets = parseWidgets(obj.widgets);
  const detail: MarketplaceModuleDetail = {
    ...summary,
    // Derive counts from the actual arrays when the detail endpoint omits them.
    counts:
      summary.counts.triggers || summary.counts.actions || summary.counts.functions || summary.counts.widgets
        ? summary.counts
        : {
            triggers: triggers.length,
            actions: actions.length,
            functions: functions.length,
            widgets: widgets.length,
          },
    triggers,
    actions,
    functions,
    widgets,
  };
  if (typeof obj.readme === "string") {
    detail.readme = obj.readme;
  }
  return detail;
}

export const listModules = action({
  args: {},
  handler: async (ctx): Promise<MarketplaceModuleSummary[]> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    const payload = await marketplaceFetch("/modules");
    const rawList =
      payload && typeof payload === "object" && Array.isArray((payload as Record<string, unknown>).modules)
        ? ((payload as Record<string, unknown>).modules as unknown[])
        : [];
    return rawList.map(parseSummary).filter((m): m is MarketplaceModuleSummary => m !== null);
  },
});

export const getModule = action({
  args: { marketplaceModuleId: v.string() },
  handler: async (ctx, { marketplaceModuleId }): Promise<MarketplaceModuleDetail> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    const payload = await marketplaceFetch(`/modules/${encodeURIComponent(marketplaceModuleId)}`);
    const rawModule = payload && typeof payload === "object" ? (payload as Record<string, unknown>).module : undefined;
    const detail = parseDetail(rawModule);
    if (!detail) {
      throw new Error(`Marketplace module ${marketplaceModuleId} response was malformed`);
    }
    return detail;
  },
});

export const installModule = action({
  args: {
    instanceId: v.id("instances"),
    marketplaceModuleId: v.string(),
    // Every permission the streamer has approved for this module, including
    // those an installed version already held. The install is refused when the
    // archive declares one outside this list, which also catches a listing
    // republished with new permissions after the streamer reviewed it.
    approvedPermissions: v.array(v.string()),
  },
  handler: async (ctx, { instanceId, marketplaceModuleId, approvedPermissions }): Promise<{ moduleKey: string }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    const bundle = await ctx.runQuery(internal.workflowCatalogContext.catalogContextForUser, {
      instanceId,
      userId,
    });
    if (!bundle) {
      throw new Error("Not authorized or instance not found");
    }
    if (!bundle.clientId || !bundle.clientSecret) {
      throw new Error("Instance is not registered with the engine");
    }

    const detailPayload = await marketplaceFetch(`/modules/${encodeURIComponent(marketplaceModuleId)}`);
    const rawModule =
      detailPayload && typeof detailPayload === "object"
        ? (detailPayload as Record<string, unknown>).module
        : undefined;
    const detail = parseDetail(rawModule);
    if (!detail) {
      throw new Error(`Marketplace module ${marketplaceModuleId} response was malformed`);
    }

    const download = await fetchMarketplaceDownload(marketplaceModuleId);
    const declaredPermissions = await fetchMarketplaceArchivePermissions(download);
    const unapproved = unapprovedPermissions(declaredPermissions, approvedPermissions);
    if (unapproved.length > 0) {
      throw new Error(
        `${detail.name}@${detail.version} asks for permissions that were not approved (${unapproved.join(", ")}). ` +
          "Review the module and install again."
      );
    }
    const moduleKey = `${marketplaceModuleId}:${detail.version}:${download.sha256.slice(0, 7)}`;

    await ctx.runMutation(internal.transientEvents.emit, {
      instanceId,
      correlationKey: moduleKey,
      type: "module.install",
      status: "progress",
      message: `Installing ${detail.name}@${detail.version} from marketplace...`,
      data: { moduleName: detail.name, moduleVersion: detail.version, source: "marketplace" },
    });

    try {
      const rpc = createEngineRpcSession<LocalEngineApi>(bundle.url, bundle.clientId, bundle.clientSecret);
      await rpc.installModuleFromUrl(download.url, moduleKey, {
        name: detail.name,
        version: detail.version,
        source: "marketplace",
        marketplaceModuleId,
      });

      return { moduleKey };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await ctx.runMutation(internal.transientEvents.emit, {
        instanceId,
        correlationKey: moduleKey,
        type: "module.install",
        status: "error",
        message: `Marketplace install failed: ${message}`,
        data: { moduleName: detail.name, moduleVersion: detail.version, source: "marketplace" },
      });
      throw err;
    }
  },
});
