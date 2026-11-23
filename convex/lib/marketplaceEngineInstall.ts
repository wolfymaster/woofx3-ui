/**
 * Marketplace installs carried out by the engine.
 *
 * The engine can install a listing by id (`installMarketplaceListing`) and
 * install an overlay or alert bundle (`installMarketplaceBundle`). It reads the listing,
 * claims it with `acquire`, downloads and verifies the content itself, with a
 * buyer token this deployment mints. The Convex actions that install marketplace
 * content take that path only when
 * `marketplaceEngineFor` allows it, and otherwise run their own download path.
 * Either way they answer with the same shapes.
 *
 * Shared by `"use node"` and default-runtime action files, so it defines no
 * Convex functions.
 */

import { type CatalogListing, isModuleListing, parseCatalogDetail } from "@shared/marketplace-catalog";
import type {
  MarketplaceBundleInstallResult as EngineBundleInstallResult,
  MarketplaceInstallResult as EngineModuleInstallResult,
  MarketplaceInstallRequest,
} from "@woofx3/api";
import { parseMarketplaceCatalogError } from "@woofx3/api/marketplace-catalog";
import { ConvexError } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { logger } from "../logger";
import { createEngineRpcSession, type EngineApi } from "./engineInstanceUrl";
import { marketplaceAccessFor } from "./marketplaceAccess";
import { marketplaceGet } from "./marketplaceApi";
import { BUYER_SIGNING_KEY_ENV, BUYER_SIGNING_KEY_ID_ENV } from "./marketplaceBuyerToken";
import { notBoughtMessage } from "./marketplaceEntitlement";
import { MARKETPLACE_REFUSAL_COPY } from "./marketplaceLicense";

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
export type MarketplaceEngine = Pick<EngineApi, "installMarketplaceListing" | "installMarketplaceBundle">;

// --- routing ---

/** Whether `MARKETPLACE_BUYER_SIGNING_KEY` and `_KEY_ID` are both set. */
export function buyerTokensConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env[BUYER_SIGNING_KEY_ENV]?.trim() && env[BUYER_SIGNING_KEY_ID_ENV]?.trim());
}

const ENGINE_UNREACHABLE_COPY = "Your engine isn't answering right now. Make sure it is running, then try again.";
const ENGINE_UNAVAILABLE_COPY = "Marketplace installs aren't available for this engine right now.";
const LISTING_UNREADABLE_COPY = "This module's marketplace listing couldn't be read. Try again in a moment.";

/**
 * The engine to run a marketplace operation on for `instanceId`, or null when
 * it has none to run on: an instance not registered with its engine, or a
 * deployment that cannot mint buyer tokens (the engine could then claim
 * nothing for the buyer). An engine that does not answer fails the call, so
 * an install never quietly goes somewhere else.
 */
export async function marketplaceEngineFor(
  ctx: ActionCtx,
  instanceId: Id<"instances">
): Promise<EngineCredentials | null> {
  const instance = await ctx.runQuery(internal.instances.getInternal, { instanceId });
  if (!instance?.clientId || !instance.clientSecret || !buyerTokensConfigured()) {
    return null;
  }
  const engine = { url: instance.url, clientId: instance.clientId, clientSecret: instance.clientSecret };
  try {
    await createEngineRpcSession<EngineApi>(engine.url, engine.clientId, engine.clientSecret).getEngineInfo();
  } catch (err) {
    logger.warn("marketplace install: engine unreachable", {
      instanceId,
      error: err instanceof Error ? err.message : String(err),
    });
    throw new ConvexError(ENGINE_UNREACHABLE_COPY);
  }
  return engine;
}

/**
 * The engine to install module listing `listingId` on, with the listing as
 * the catalog describes it. Throws a message the streamer can read when the
 * engine is unavailable, the listing cannot be read, or it does not install
 * as a module.
 */
export async function marketplaceModuleEngineFor(
  ctx: ActionCtx,
  instanceId: Id<"instances">,
  listingId: string
): Promise<{ engine: EngineCredentials; listing: CatalogListing }> {
  const engine = await marketplaceEngineFor(ctx, instanceId);
  if (!engine) {
    throw new ConvexError(ENGINE_UNAVAILABLE_COPY);
  }
  const instance = await ctx.runQuery(internal.instances.getInternal, { instanceId });
  if (!instance) {
    throw new ConvexError(ENGINE_UNAVAILABLE_COPY);
  }
  let listing: CatalogListing | null;
  try {
    const payload = await marketplaceGet(`/catalog/${encodeURIComponent(listingId)}`, marketplaceAccessFor(instance));
    listing = parseCatalogDetail(
      payload && typeof payload === "object" ? (payload as { listing?: unknown }).listing : null
    );
  } catch (err) {
    logger.warn("marketplace listing could not be read for an install", {
      listingId,
      error: err instanceof Error ? err.message : String(err),
    });
    throw new ConvexError(LISTING_UNREADABLE_COPY);
  }
  if (!listing) {
    throw new ConvexError(`Marketplace listing ${listingId} was not found`);
  }
  if (!isModuleListing(listing.type)) {
    throw new ConvexError(`${listing.name} is a ${listing.type} listing and does not install as a module`);
  }
  return { engine, listing };
}

/** A fresh session: a capnweb HTTP batch session is spent by its first call. */
export function marketplaceEngineSession(engine: EngineCredentials): MarketplaceEngine {
  return createEngineRpcSession<EngineApi>(engine.url, engine.clientId, engine.clientSecret);
}

// --- engine errors ---

/**
 * What the streamer is told for each code the marketplace refuses an engine's
 * claim or download with. A Map, not an object: the code is the marketplace's
 * text, and a code like `constructor` must not read Object's own members.
 */
const INSTALL_REFUSAL_COPY: ReadonlyMap<string, string> = new Map(
  Object.entries({
    ...MARKETPLACE_REFUSAL_COPY,
    listing_not_found: MARKETPLACE_REFUSAL_COPY.not_found,
    module_not_found: MARKETPLACE_REFUSAL_COPY.not_found,
    payment_required: "This module hasn't been bought in this account yet.",
    not_entitled: "This account's license doesn't unlock this module. Reload the page, then install it again.",
    buyer_mismatch: "This module's license belongs to another account, so it can't be installed here.",
    activation_limit:
      "This module's license is already on as many engines as it allows. Remove it from another engine, then try again.",
  })
);

const INSTALL_REFUSED_COPY =
  "The marketplace refused this install. Try again, or contact woofx3 support if it keeps happening.";
const MARKETPLACE_UNREACHABLE_COPY = "Your engine couldn't reach the marketplace. Try again in a moment.";
const MARKETPLACE_DISABLED_COPY = "Marketplace installs are turned off on this engine.";

/**
 * What to tell the streamer about a marketplace failure the engine passed on
 * in the catalog error format, or null for any other engine failure. A
 * `listing_unavailable` keeps the marketplace's message, which it writes for
 * a person (unpriced, unpublished, replaced by a newer edition).
 */
export function marketplaceInstallFailureCopy(err: unknown): string | null {
  const failure = parseMarketplaceCatalogError(err);
  if (failure === null) {
    return null;
  }
  switch (failure.kind) {
    case "http":
      if (failure.code === "listing_unavailable" && failure.message.trim() !== "") {
        return failure.message;
      }
      return INSTALL_REFUSAL_COPY.get(failure.code) ?? INSTALL_REFUSED_COPY;
    case "timeout":
    case "unreachable":
      return MARKETPLACE_UNREACHABLE_COPY;
    case "disabled":
      return MARKETPLACE_DISABLED_COPY;
  }
}

/**
 * An engine failure as an error the browser can read. Convex shows only
 * "Server Error" for anything but a ConvexError, and capnweb passes only an
 * error's name and message. A marketplace refusal the engine passed on keeps
 * its code in that message, so it is told in the streamer's words and the raw
 * text goes to the log; any other engine message is passed on as it is.
 * Refusals the streamer must act on in the flow (payment required, needs
 * approval) arrive as results instead.
 */
export function engineFailure(err: unknown): ConvexError<string> {
  if (err instanceof ConvexError) {
    return err;
  }
  const raw = err instanceof Error ? err.message : String(err);
  const copy = marketplaceInstallFailureCopy(err);
  if (copy === null) {
    return new ConvexError(raw);
  }
  logger.warn("marketplace refused an engine install", { error: raw });
  return new ConvexError(copy);
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
    /**
     * The listing's license key, from `acquire`. With it the engine downloads
     * with the key and claims nothing; only an engine with the
     * `marketplace.licenseKeys` capability reads it.
     */
    licenseKey?: string;
  }
): Promise<MarketplaceInstallResult> {
  const buyerToken = await deps.buyerToken();
  const since = deps.now();
  const engineRequest: MarketplaceInstallRequest = {
    approvedPermissions: [...request.approvedPermissions],
    approvedLocalEndpoints: [...request.approvedLocalEndpoints],
    buyerToken,
  };
  if (request.licenseKey !== undefined) {
    engineRequest.licenseKey = request.licenseKey;
  }
  let result: EngineModuleInstallResult;
  try {
    result = await deps.engine().installMarketplaceListing(request.listingId, engineRequest);
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
