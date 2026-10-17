/**
 * Marketplace installs carried out by the engine.
 *
 * The engine can install a listing by id (`installMarketplaceListing`), read
 * the build an install would use (`inspectMarketplaceListing`) and install an
 * overlay or alert bundle (`installMarketplaceBundle`), fetching and checking
 * everything itself with a buyer token this deployment mints. The Convex
 * actions that install, review and browse marketplace content take that path
 * only when `routeThroughEngine` allows it, and otherwise run their own
 * download path. Either way they answer with the same shapes and errors, so a
 * caller cannot tell which path ran.
 *
 * Shared by `"use node"` and default-runtime action files, so it defines no
 * Convex functions.
 */

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
import type { FeatureFlagKey } from "./featureFlags";
import type { LocalEndpointSummary, LocalProtocol } from "./localEndpoints";
import { type MarketplaceAccess, marketplaceAccessFor } from "./marketplaceAccess";
import { marketplaceGet } from "./marketplaceApi";
import { notPurchasedMessage } from "./marketplaceEntitlement";

export const ENGINE_INSTALL_FLAG: FeatureFlagKey = "marketplace.engineInstall";
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
  flagOn(): Promise<boolean>;
  capabilities(): Promise<EngineCapabilityReport>;
}

/**
 * Whether the engine path runs. Dev access keeps the Convex path because the
 * engine reads `/catalog/{id}` anonymously, where dev-tier listings do not
 * exist. The engine is asked for its capabilities last, so an instance outside
 * the rollout costs no engine round trip.
 *
 * An engine that cannot answer for its capabilities gets the Convex path:
 * reviews and file browsing do not need the engine there, and an install
 * fails the way it always has.
 */
export async function routeThroughEngine(gate: EngineInstallGate): Promise<boolean> {
  if (gate.access === "dev") {
    return false;
  }
  if (!(await gate.flagOn())) {
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
    flagOn: () => ctx.runQuery(internal.featureFlags.isOnForInstance, { key: ENGINE_INSTALL_FLAG, instanceId }),
    capabilities: () => fetchEngineCapabilities(engine),
  });
  return useEngine ? engine : null;
}

/** A fresh session: a capnweb HTTP batch session is spent by its first call. */
export function marketplaceEngineSession(engine: EngineCredentials): MarketplaceEngine {
  return createEngineRpcSession<EngineApi>(engine.url, engine.clientId, engine.clientSecret);
}

// --- engine errors ---

/** A marketplace refusal the engine passed on, read from its error message. */
export interface EngineMarketplaceRefusal {
  method: string;
  path: string;
  status: number;
}

/**
 * Must match `marketplaceError` in woofx3 `api/src/marketplace-client.ts`:
 * `Marketplace {method} {path} failed with {status}`, then an optional reason.
 */
const REFUSAL_PATTERN = /^Marketplace (GET|POST) (\S+) failed with (\d{3})\b/;

export function engineMarketplaceRefusal(err: unknown): EngineMarketplaceRefusal | null {
  const message = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  const match = REFUSAL_PATTERN.exec(message);
  if (!match) {
    return null;
  }
  return { method: match[1], path: match[2], status: Number(match[3]) };
}

function isPurchaseRefusal(refusal: EngineMarketplaceRefusal | null): boolean {
  return refusal !== null && (refusal.status === 401 || refusal.status === 402 || refusal.status === 403);
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
      throw new ConvexError(notPurchasedMessage(result.name));
  }
}

/**
 * The version in an install key, `{listingId}:{version}:{sha7}`. The format
 * is pinned by `marketplaceModuleKey` in woofx3 `api/src/routes/marketplace.ts`.
 */
export function versionFromModuleKey(listingId: string, moduleKey: string): string {
  const prefix = `${listingId}:`;
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
  /** The listing's display name for the progress event. */
  listingName: () => Promise<string>;
  /**
   * Writes the progress event unless an event under its key was written at
   * or after `since`: barkloader may already have answered by webhook.
   */
  emitProgress: (progress: ModuleInstallProgress, since: number) => Promise<void>;
  now: () => number;
}

/**
 * Installs a module or theme listing through the engine.
 *
 * The install key only exists once the engine has hashed the archive, so the
 * progress event follows the engine's answer instead of preceding the call,
 * and is skipped when the engine's own `module.installed` or
 * `module.install_failed` callback already settled the key. A failure after
 * the key is known reaches the dashboard as the engine's
 * `module.install_failed`; this side has no key to report one under.
 */
export async function installModuleThroughEngine(
  deps: EngineModuleInstallDeps,
  request: { listingId: string; approvedPermissions: readonly string[]; approvedLocalEndpoints: readonly string[] }
): Promise<MarketplaceInstallResult> {
  const buyerToken = await deps.buyerToken();
  const since = deps.now();
  const result = await deps.engine().installMarketplaceListing(request.listingId, {
    approvedPermissions: [...request.approvedPermissions],
    approvedLocalEndpoints: [...request.approvedLocalEndpoints],
    buyerToken,
  });
  const mapped = moduleInstallResultFromEngine(result);
  if (result.status === "installed" && result.alreadyInstalled !== true) {
    const version = versionFromModuleKey(request.listingId, result.moduleKey);
    const name = await deps.listingName().catch(() => request.listingId);
    await deps.emitProgress(moduleInstallProgress(result.moduleKey, name, version), since);
  }
  return mapped;
}

/**
 * A listing's name read the way the engine reads it: `/catalog/{id}`,
 * anonymously. Only called on the engine path, which never runs at dev access.
 */
export async function catalogListingName(listingId: string): Promise<string> {
  const payload = await marketplaceGet(`/catalog/${encodeURIComponent(listingId)}`, "public");
  const listing = payload && typeof payload === "object" ? (payload as Record<string, unknown>).listing : undefined;
  const name = listing && typeof listing === "object" ? (listing as Record<string, unknown>).name : undefined;
  return typeof name === "string" && name !== "" ? name : listingId;
}

// --- bundle installs ---

export function bundleInstallResultFromEngine(result: EngineBundleInstallResult): InstallBundleResult {
  if (result.status === "payment_required") {
    throw new ConvexError(notPurchasedMessage(result.name));
  }
  return { listingId: result.listingId, engineId: result.engineId, kind: result.kind };
}

/**
 * The error the Convex bundle path raises for the same failure, so the
 * storefront shows the same text. Engine errors reach a browser only as a
 * ConvexError, which is why the refusals that path names are rewrapped.
 */
export function bundleInstallErrorFromEngine(err: unknown, listingId: string): unknown {
  const refusal = engineMarketplaceRefusal(err);
  if (refusal?.status === 404 && refusal.path === `/catalog/${encodeURIComponent(listingId)}`) {
    return new ConvexError(`Marketplace listing ${listingId} was not found`);
  }
  const message = err instanceof Error ? err.message : "";
  if (message.endsWith("does not install as a bundle") || message.endsWith("carries no bundle to install")) {
    return new ConvexError(message);
  }
  return err;
}

export interface EngineCallDeps {
  engine: () => MarketplaceEngine;
  buyerToken: () => Promise<string>;
}

/** Installs an overlay or alert listing through the engine. */
export async function installBundleThroughEngine(
  deps: EngineCallDeps,
  listingId: string
): Promise<InstallBundleResult> {
  const buyerToken = await deps.buyerToken();
  let result: EngineBundleInstallResult;
  try {
    result = await deps.engine().installMarketplaceBundle(listingId, buyerToken);
  } catch (err) {
    throw bundleInstallErrorFromEngine(err, listingId);
  }
  return bundleInstallResultFromEngine(result);
}

// --- reviews and file browsing ---

/** An uninstalled listing's files, as `listModuleFiles` answers for an installed one. */
export function moduleFilesFromInspection(inspection: MarketplaceListingInspection): ModuleFileList {
  return { available: true, files: inspection.files.map(({ path, size }) => ({ path, size })) };
}

/**
 * The error the Convex path raises for the same failure. A download the
 * marketplace refused the buyer is a listing they have not bought, which
 * that path refuses up front under the same message.
 */
export function inspectionErrorFromEngine(err: unknown, listingName: string): unknown {
  return isPurchaseRefusal(engineMarketplaceRefusal(err)) ? new ConvexError(notPurchasedMessage(listingName)) : err;
}

/**
 * The build an install would use, read by the engine. Claims nothing, so
 * browsing or reviewing a listing is never counted as an install.
 * `listingName` names the listing in a purchase refusal.
 */
export async function inspectThroughEngine(
  deps: EngineCallDeps,
  listingId: string,
  listingName: string
): Promise<MarketplaceListingInspection> {
  const buyerToken = await deps.buyerToken();
  try {
    return await deps.engine().inspectMarketplaceListing(listingId, buyerToken);
  } catch (err) {
    throw inspectionErrorFromEngine(err, listingName);
  }
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
