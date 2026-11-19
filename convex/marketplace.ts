"use node";

import { getAuthUserId } from "@convex-dev/auth/server";
import { type CatalogListing, isModuleListing, parseCatalogDetail } from "@shared/marketplace-catalog";
import { type MarketplaceImages, parseFeaturedRank, parseMarketplaceImages } from "@shared/marketplace-images";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { type ActionCtx, action, internalAction } from "./_generated/server";
import { requireInstanceRoleInAction } from "./lib/instanceAccess";
import { type MarketplaceAccess, marketplaceRequestHeaders } from "./lib/marketplaceAccess";
import { marketplaceGet, withClientErrors } from "./lib/marketplaceApi";
import {
  type EngineCredentials,
  type EngineModuleInstallDeps,
  installModuleThroughEngine,
  type MarketplaceInstallResult,
  marketplaceEngineSession,
  marketplaceModuleEngineFor,
} from "./lib/marketplaceEngineInstall";
import { buyerTokenFor } from "./lib/marketplaceEntitlement";
import { listingManifestId } from "./lib/marketplaceInstallIdentity";

const MARKETPLACE_TIMEOUT_MS = 10_000;

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
  /**
   * "dev" for a module the marketplace hides from the public catalog. Only an
   * instance with marketplace dev access is ever sent one.
   */
  tier: "public" | "dev";
  /**
   * The manifest id every edition of the module shares, which it installs
   * under. Absent from a marketplace that predates editions.
   */
  moduleKey?: string;
  /** Which edition of the module this listing is. Absent like `moduleKey`. */
  edition?: number;
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

/** The marketplace access `instanceId` has. Every marketplace request must be made at one. */
export async function marketplaceAccessForInstance(
  ctx: ActionCtx,
  instanceId: Id<"instances">
): Promise<MarketplaceAccess> {
  return await ctx.runQuery(internal.instances.getMarketplaceAccess, { instanceId });
}

export async function marketplaceFetch(path: string, access: MarketplaceAccess): Promise<unknown> {
  const base = getMarketplaceUrl();
  const headers = marketplaceRequestHeaders(access, process.env.MARKETPLACE_DEV_TOKEN);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MARKETPLACE_TIMEOUT_MS);
  try {
    const res = await fetch(`${base}${path}`, {
      method: "GET",
      headers,
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
    tier: obj.tier === "dev" ? "dev" : "public",
  };
  const featuredRank = parseFeaturedRank(obj.featuredRank);
  if (featuredRank !== undefined) {
    summary.featuredRank = featuredRank;
  }
  if (typeof obj.updatedAt === "string") {
    summary.updatedAt = obj.updatedAt;
  }
  if (typeof obj.moduleKey === "string" && obj.moduleKey.trim() !== "") {
    summary.moduleKey = obj.moduleKey.trim();
  }
  if (typeof obj.edition === "number" && Number.isInteger(obj.edition) && obj.edition >= 1) {
    summary.edition = obj.edition;
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

/** Every module the marketplace lists. Entries it cannot parse are dropped. */
export async function fetchMarketplaceListing(access: MarketplaceAccess): Promise<MarketplaceModuleSummary[]> {
  const payload = await marketplaceFetch("/modules", access);
  const rawList =
    payload && typeof payload === "object" && Array.isArray((payload as Record<string, unknown>).modules)
      ? ((payload as Record<string, unknown>).modules as unknown[])
      : [];
  return rawList.map(parseSummary).filter((m): m is MarketplaceModuleSummary => m !== null);
}

export const listModules = action({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, { instanceId }): Promise<MarketplaceModuleSummary[]> => {
    await requireInstanceRoleInAction(ctx, instanceId);
    return await fetchMarketplaceListing(await marketplaceAccessForInstance(ctx, instanceId));
  },
});

export const getModule = action({
  args: { instanceId: v.id("instances"), marketplaceModuleId: v.string() },
  handler: async (ctx, { instanceId, marketplaceModuleId }): Promise<MarketplaceModuleDetail> => {
    await requireInstanceRoleInAction(ctx, instanceId);

    const payload = await marketplaceFetch(
      `/modules/${encodeURIComponent(marketplaceModuleId)}`,
      await marketplaceAccessForInstance(ctx, instanceId)
    );
    const rawModule = payload && typeof payload === "object" ? (payload as Record<string, unknown>).module : undefined;
    const detail = parseDetail(rawModule);
    if (!detail) {
      throw new Error(`Marketplace module ${marketplaceModuleId} response was malformed`);
    }
    return detail;
  },
});

export type { MarketplaceInstallResult };

/** What `installModuleThroughEngine` needs to install `listing` on `engine` for `instanceId`. */
function engineModuleInstallDeps(
  ctx: ActionCtx,
  instanceId: Id<"instances">,
  engine: EngineCredentials,
  listing: CatalogListing
): EngineModuleInstallDeps {
  return {
    engine: () => marketplaceEngineSession(engine),
    buyerToken: () => buyerTokenFor(ctx, instanceId),
    emitProgress: async (progress, since) => {
      await ctx.runMutation(internal.transientEvents.emitUnlessNewer, {
        instanceId,
        correlationKey: progress.moduleKey,
        type: "module.install",
        status: "progress",
        message: progress.message,
        data: progress.data,
        since,
      });
    },
    recordInstall: async (moduleKey) => {
      await ctx.runMutation(internal.marketplaceInstalls.record, {
        instanceId,
        moduleKey,
        listingId: listing.id,
        edition: listing.edition,
      });
    },
    now: Date.now,
  };
}

/** The instance's engine, for a signed-in user who may act on the instance. */
async function registeredEngineForUser(ctx: ActionCtx, instanceId: Id<"instances">): Promise<EngineCredentials> {
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
  return { url: bundle.url, clientId: bundle.clientId, clientSecret: bundle.clientSecret };
}

/**
 * Installs a module or theme listing the account holds, on an engine with the
 * `marketplace.licenseKeys` capability, with the license key
 * `acquireForInstall` answered. The engine downloads the build with the key
 * and checks it against the approvals, so a build asking for more comes back
 * as `needs_approval` and installs nothing. Engine failures throw with the
 * engine's message.
 */
export const installWithLicense = action({
  args: {
    instanceId: v.id("instances"),
    listingId: v.string(),
    licenseKey: v.string(),
    approvedPermissions: v.array(v.string()),
    approvedLocalEndpoints: v.array(v.string()),
  },
  handler: async (
    ctx,
    { instanceId, listingId, licenseKey, approvedPermissions, approvedLocalEndpoints }
  ): Promise<MarketplaceInstallResult> =>
    withClientErrors(async () => {
      const engine = await registeredEngineForUser(ctx, instanceId);
      const payload = await marketplaceGet(
        `/catalog/${encodeURIComponent(listingId)}`,
        await marketplaceAccessForInstance(ctx, instanceId)
      );
      const listing = parseCatalogDetail(
        payload && typeof payload === "object" ? (payload as { listing?: unknown }).listing : null
      );
      if (!listing) {
        throw new ConvexError(`Marketplace listing ${listingId} was not found`);
      }
      if (!isModuleListing(listing.type)) {
        throw new ConvexError(`${listing.name} is a ${listing.type} listing and does not install as a module`);
      }
      return await installModuleThroughEngine(engineModuleInstallDeps(ctx, instanceId, engine, listing), {
        listingId: listing.id,
        listingName: listing.name,
        manifestId: listingManifestId(listing),
        approvedPermissions,
        approvedLocalEndpoints,
        licenseKey,
      });
    }),
});

/**
 * Installs a module on an instance's behalf, without a signed-in user, for
 * installs the streamer approved earlier and that run later, such as the
 * platforms chosen at setup once the engine is ready. The engine claims the
 * listing and downloads it. The approval that authorizes it is
 * `approvedPermissions` and `approvedLocalEndpoints`, recorded when the
 * streamer chose the module; a build asking for more comes back as
 * `needs_approval` instead of installing.
 */
export const installApprovedModule = internalAction({
  args: {
    instanceId: v.id("instances"),
    marketplaceModuleId: v.string(),
    approvedPermissions: v.array(v.string()),
    approvedLocalEndpoints: v.array(v.string()),
  },
  handler: async (
    ctx,
    { instanceId, marketplaceModuleId, approvedPermissions, approvedLocalEndpoints }
  ): Promise<MarketplaceInstallResult> => {
    const { engine, listing } = await marketplaceModuleEngineFor(ctx, instanceId, marketplaceModuleId);
    return await installModuleThroughEngine(engineModuleInstallDeps(ctx, instanceId, engine, listing), {
      listingId: marketplaceModuleId,
      listingName: listing.name,
      manifestId: listingManifestId(listing),
      approvedPermissions,
      approvedLocalEndpoints,
    });
  },
});
