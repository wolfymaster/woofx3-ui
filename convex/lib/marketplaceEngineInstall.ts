/**
 * Marketplace installs carried out by the engine.
 *
 * The engine can install a listing by id (`installMarketplaceListing`), read
 * the build an install would use (`inspectMarketplaceListing`) and install an
 * overlay or alert bundle (`installMarketplaceBundle`). It reads the listing,
 * claims it with `acquire`, downloads and verifies the content itself, with a
 * buyer token this deployment mints. The Convex actions that install, review
 * and browse marketplace content take that path only when
 * `marketplaceEngineFor` allows it, and otherwise run their own download path.
 * Either way they answer with the same shapes.
 *
 * Shared by `"use node"` and default-runtime action files, so it defines no
 * Convex functions.
 */

import type { LocalEndpointSummary, LocalProtocol } from "@shared/local-endpoints";
import { type CatalogListing, isModuleListing, parseCatalogDetail } from "@shared/marketplace-catalog";
import type {
  MarketplaceBundleInstallResult as EngineBundleInstallResult,
  MarketplaceInstallResult as EngineModuleInstallResult,
  MarketplaceListingInspection,
  ModuleFileList,
} from "@woofx3/api";
import { ConvexError } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import {
  type EngineCapability,
  type EngineCapabilityReport,
  fetchEngineCapabilities,
  hasEngineCapability,
} from "./engineCapabilities";
import { createEngineRpcSession, type EngineApi } from "./engineInstanceUrl";
import { type MarketplaceAccess, marketplaceAccessFor } from "./marketplaceAccess";
import { marketplaceGet } from "./marketplaceApi";
import { BUYER_SIGNING_KEY_ENV, BUYER_SIGNING_KEY_ID_ENV } from "./marketplaceBuyerToken";
import { notBoughtMessage } from "./marketplaceEntitlement";

export const ENGINE_INSTALL_CAPABILITY: EngineCapability = "modules.marketplaceInstall";

export interface EngineCredentials {
  url: string;
  clientId: string;
  clientSecret: string;
}

export type MarketplaceInstallResult =
  | { status: "installed"; moduleKey: string }
  | {
      /**
       * The archive declares permissions or local endpoints nobody approved,
       * e.g. because the listing was republished after the streamer reviewed
       * it. Nothing was installed.
       */
      status: "needs_approval";
      name: string;
      version: string;
      unapproved: string[];
      /** Ids of `local[]` endpoints outside the approval. */
      unapprovedLocalEndpoints: string[];
    };

export type InstallBundleResult = {
  listingId: string;
  /** What the install produced in the engine. */
  engineId: string;
  kind: "scene" | "alert";
};

/** The engine methods the marketplace path calls. */
export type MarketplaceEngine = Pick<
  EngineApi,
  "installMarketplaceListing" | "inspectMarketplaceListing" | "installMarketplaceBundle"
>;

// --- routing ---

/** What decides the path for one instance. Read lazily, cheapest first. */
export interface EngineInstallGate {
  access: MarketplaceAccess;
  /** Whether this deployment can mint buyer tokens at all. */
  buyerTokens: boolean;
  capabilities(): Promise<EngineCapabilityReport>;
}

/**
 * Whether the engine path runs.
 *
 * Dev access keeps the Convex path: the engine reads `/catalog/{id}`
 * anonymously, where dev-tier listings do not exist. A deployment without
 * the buyer signing key keeps it too, because the engine could then only
 * install free listings and would claim nothing for the buyer. Both are
 * checked before the engine is asked for its capabilities, so they cost no
 * engine round trip.
 *
 * An engine that cannot answer for its capabilities gets the Convex path:
 * reviews and file browsing do not need the engine there, and an install
 * fails the way it always has.
 */
export async function routeThroughEngine(gate: EngineInstallGate): Promise<boolean> {
  if (gate.access === "dev" || !gate.buyerTokens) {
    return false;
  }
  let report: EngineCapabilityReport;
  try {
    report = await gate.capabilities();
  } catch (err) {
    console.warn("Marketplace install routing could not read engine capabilities:", err);
    return false;
  }
  return hasEngineCapability(report, ENGINE_INSTALL_CAPABILITY);
}

/** Whether `MARKETPLACE_BUYER_SIGNING_KEY` and `_KEY_ID` are both set. */
export function buyerTokensConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env[BUYER_SIGNING_KEY_ENV]?.trim() && env[BUYER_SIGNING_KEY_ID_ENV]?.trim());
}

/**
 * The engine to run a marketplace operation on for `instanceId`, or null for
 * the Convex path. An instance that is not registered with its engine gets
 * null, so the Convex path reports that as it always has.
 */
export async function marketplaceEngineFor(
  ctx: ActionCtx,
  instanceId: Id<"instances">
): Promise<EngineCredentials | null> {
  const instance = await ctx.runQuery(internal.instances.getInternal, { instanceId });
  if (!instance?.clientId || !instance.clientSecret) {
    return null;
  }
  const engine = { url: instance.url, clientId: instance.clientId, clientSecret: instance.clientSecret };
  const useEngine = await routeThroughEngine({
    access: marketplaceAccessFor(instance),
    buyerTokens: buyerTokensConfigured(),
    capabilities: () => fetchEngineCapabilities(engine),
  });
  return useEngine ? engine : null;
}

/**
 * Why a listing stays on the Convex path although the instance is routed to
 * the engine, or null when the engine may install it. Only module and theme
 * listings install as modules; anything else keeps the Convex path, which
 * refuses it with its own error.
 */
export function moduleListingStaysOnConvex(listing: CatalogListing): string | null {
  if (!isModuleListing(listing.type)) {
    return `a ${listing.type} listing does not install as a module`;
  }
  return null;
}

/**
 * The engine to install module listing `listingId` on, with the listing as
 * the catalog describes it, or null for the Convex path.
 *
 * Reads `/catalog/{id}` only once the instance is routed to the engine, so
 * an instance on the Convex path asks nothing more of the marketplace. A listing that
 * cannot be read keeps the Convex path, which then reports the failure the
 * way it always has.
 */
export async function marketplaceModuleEngineFor(
  ctx: ActionCtx,
  instanceId: Id<"instances">,
  listingId: string
): Promise<{ engine: EngineCredentials; listing: CatalogListing } | null> {
  const engine = await marketplaceEngineFor(ctx, instanceId);
  if (!engine) {
    return null;
  }
  let listing: CatalogListing | null;
  try {
    // Public: the engine path never runs at dev access.
    const payload = await marketplaceGet(`/catalog/${encodeURIComponent(listingId)}`, "public");
    listing = parseCatalogDetail(
      payload && typeof payload === "object" ? (payload as { listing?: unknown }).listing : null
    );
  } catch (err) {
    console.warn(`Marketplace listing ${listingId} could not be read for the engine path:`, err);
    return null;
  }
  if (!listing) {
    return null;
  }
  const reason = moduleListingStaysOnConvex(listing);
  if (reason !== null) {
    console.info(`Marketplace install of ${listingId} stays on the Convex path: ${reason}`);
    return null;
  }
  return { engine, listing };
}

/** A fresh session: a capnweb HTTP batch session is spent by its first call. */
export function marketplaceEngineSession(engine: EngineCredentials): MarketplaceEngine {
  return createEngineRpcSession<EngineApi>(engine.url, engine.clientId, engine.clientSecret);
}

// --- engine errors ---

/**
 * An engine failure as an error the browser can read. Convex shows only
 * "Server Error" for anything but a ConvexError, and capnweb passes only an
 * error's name and message, so the engine's message is all there is to show.
 * It is passed on as it is, never parsed: refusals the streamer must act on
 * (payment required, needs approval) arrive as results instead.
 */
export function engineFailure(err: unknown): ConvexError<string> {
  if (err instanceof ConvexError) {
    return err;
  }
  return new ConvexError(err instanceof Error ? err.message : String(err));
}

// --- module installs ---

export function moduleInstallResultFromEngine(result: EngineModuleInstallResult): MarketplaceInstallResult {
  switch (result.status) {
    case "installed":
      return { status: "installed", moduleKey: result.moduleKey };
    case "needs_approval":
      return {
        status: "needs_approval",
        name: result.name,
        version: result.version,
        unapproved: result.unapproved,
        unapprovedLocalEndpoints: result.unapprovedLocalEndpoints,
      };
    case "payment_required":
      throw new ConvexError(notBoughtMessage(result.name));
  }
}

/**
 * The version in an install key, `{manifestId}:{version}:{sha7}`. The format
 * is pinned by `marketplaceModuleKey` in woofx3 `api/src/routes/marketplace.ts`
 * and by barkloader, which refuses a key it did not compute itself.
 */
export function versionFromModuleKey(manifestId: string, moduleKey: string): string {
  const prefix = `${manifestId}:`;
  const hashAt = moduleKey.lastIndexOf(":");
  if (!moduleKey.startsWith(prefix) || hashAt < prefix.length) {
    throw new Error(`Engine answered with install key "${moduleKey}", which is not ${prefix}{version}:{hash}`);
  }
  return moduleKey.slice(prefix.length, hashAt);
}

export interface ModuleInstallProgress {
  moduleKey: string;
  message: string;
  data: { moduleName: string; moduleVersion: string; source: "marketplace" };
}

/** The progress event the dashboard shows while an install runs; the same text whichever path installs. */
export function moduleInstallProgress(moduleKey: string, name: string, version: string): ModuleInstallProgress {
  return {
    moduleKey,
    message: `Installing ${name}@${version} from marketplace...`,
    data: { moduleName: name, moduleVersion: version, source: "marketplace" },
  };
}

export interface EngineModuleInstallDeps {
  engine: () => MarketplaceEngine;
  buyerToken: () => Promise<string>;
  /**
   * Writes the progress event unless an event under its key was written at
   * or after `since`: barkloader may already have answered by webhook.
   */
  emitProgress: (progress: ModuleInstallProgress, since: number) => Promise<void>;
  /** Records which listing the installed key is, for `marketplaceInstalls`. */
  recordInstall: (moduleKey: string) => Promise<void>;
  now: () => number;
}

/**
 * Installs a module or theme listing through the engine. `listingName` is the
 * catalog's name for it, for the progress event, and `manifestId` the
 * listing's `moduleKey`, which the engine installs under (see
 * `listingManifestId`).
 *
 * The engine claims the listing with `acquire`, which also counts the install,
 * so nothing here calls acquire. The install key only exists once the engine
 * has hashed the archive, so the progress event follows the engine's answer
 * instead of preceding the call, and is skipped when the engine's own
 * `module.installed` or `module.install_failed` callback already settled the
 * key.
 *
 * A failure is thrown as a ConvexError carrying the engine's message. The
 * dashboard learns the key only from this action's answer, so a thrown
 * failure is the whole report, and there is no key to write an error event
 * under. A failure after the engine knew the key also reaches the key as the
 * engine's `module.install_failed`.
 */
export async function installModuleThroughEngine(
  deps: EngineModuleInstallDeps,
  request: {
    listingId: string;
    listingName: string;
    manifestId: string;
    approvedPermissions: readonly string[];
    approvedLocalEndpoints: readonly string[];
  }
): Promise<MarketplaceInstallResult> {
  const buyerToken = await deps.buyerToken();
  const since = deps.now();
  let result: EngineModuleInstallResult;
  try {
    result = await deps.engine().installMarketplaceListing(request.listingId, {
      approvedPermissions: [...request.approvedPermissions],
      approvedLocalEndpoints: [...request.approvedLocalEndpoints],
      buyerToken,
    });
  } catch (err) {
    throw engineFailure(err);
  }
  const mapped = moduleInstallResultFromEngine(result);
  if (result.status === "installed") {
    await deps.recordInstall(result.moduleKey);
    if (result.alreadyInstalled !== true) {
      const version = versionFromModuleKey(request.manifestId, result.moduleKey);
      await deps.emitProgress(moduleInstallProgress(result.moduleKey, request.listingName, version), since);
    }
  }
  return mapped;
}

// --- bundle installs ---

export function bundleInstallResultFromEngine(result: EngineBundleInstallResult): InstallBundleResult {
  if (result.status === "payment_required") {
    throw new ConvexError(notBoughtMessage(result.name));
  }
  return { listingId: result.listingId, engineId: result.engineId, kind: result.kind };
}

export interface EngineCallDeps {
  engine: () => MarketplaceEngine;
  buyerToken: () => Promise<string>;
}

/**
 * Installs an overlay or alert listing through the engine, which claims it
 * with `acquire` (counting the install) and writes the scene or alert
 * composition. The caller has already read the listing and checked its type,
 * as the Convex path does, so those refusals keep their text.
 */
export async function installBundleThroughEngine(
  deps: EngineCallDeps,
  listingId: string
): Promise<InstallBundleResult> {
  const buyerToken = await deps.buyerToken();
  let result: EngineBundleInstallResult;
  try {
    result = await deps.engine().installMarketplaceBundle(listingId, buyerToken);
  } catch (err) {
    throw engineFailure(err);
  }
  return bundleInstallResultFromEngine(result);
}

// --- reviews and file browsing ---

/** An uninstalled listing's files, as `listModuleFiles` answers for an installed one. */
export function moduleFilesFromInspection(inspection: MarketplaceListingInspection): ModuleFileList {
  return { available: true, files: inspection.files.map(({ path, size }) => ({ path, size })) };
}

/**
 * The build an install would use, read by the engine. Claims nothing, so
 * browsing or reviewing a listing is never counted as an install. Failures
 * propagate: both callers already turn any failure into their own answer.
 */
export async function inspectThroughEngine(
  deps: EngineCallDeps,
  listingId: string
): Promise<MarketplaceListingInspection> {
  const buyerToken = await deps.buyerToken();
  return await deps.engine().inspectMarketplaceListing(listingId, buyerToken);
}

/** What the setup review offers for approval of one listing. */
export interface SetupReview {
  permissions: string[];
  localEndpoints: LocalEndpointSummary[];
}

const LOCAL_PROTOCOLS: ReadonlySet<string> = new Set<LocalProtocol>(["websocket", "http"]);

/**
 * What the setup review shows for a listing: its permissions and local
 * endpoints. The engine reports every `local[]` entry with an id; one with a
 * protocol the dashboard cannot show is left out, as `readLocalEndpoints`
 * leaves it out of an archive read here. An install whose archive still
 * declares it comes back as `needs_approval`.
 */
export function setupReviewFromInspection(inspection: MarketplaceListingInspection): SetupReview {
  return {
    permissions: [...inspection.permissions],
    localEndpoints: inspection.localEndpoints
      .filter((endpoint) => LOCAL_PROTOCOLS.has(endpoint.protocol) && endpoint.name.trim() !== "")
      .map((endpoint) => ({ id: endpoint.id, name: endpoint.name, protocol: endpoint.protocol as LocalProtocol })),
  };
}
