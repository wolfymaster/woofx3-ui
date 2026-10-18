import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type {
  MarketplaceInstallResult as EngineModuleInstallResult,
  MarketplaceBundleInstallResult,
  MarketplaceInstallRequest,
  MarketplaceListingInspection,
} from "@woofx3/api";
import { getFunctionName } from "convex/server";
import { ConvexError } from "convex/values";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { type EngineCapabilityReport, LEGACY_ENGINE_REPORT } from "./engineCapabilities";
import { MarketplaceError } from "./marketplaceApi";
import { BUYER_SIGNING_KEY_ENV, BUYER_SIGNING_KEY_ID_ENV } from "./marketplaceBuyerToken";
import { type CatalogListing, parseCatalogListing } from "./marketplaceCatalog";
import {
  buyerTokensConfigured,
  type EngineInstallGate,
  engineFailure,
  inspectThroughEngine,
  installBundleThroughEngine,
  installModuleThroughEngine,
  type MarketplaceEngine,
  type ModuleInstallProgress,
  marketplaceEngineFor,
  marketplaceModuleEngineFor,
  moduleFilesFromInspection,
  moduleInstallProgress,
  moduleListingStaysOnConvex,
  routeThroughEngine,
  setupReviewFromInspection,
  versionFromModuleKey,
} from "./marketplaceEngineInstall";
import { acquireRefusal, notBoughtMessage } from "./marketplaceEntitlement";

const LISTING = "obs-scenes";
const TOKEN = "header.claims.signature";
const SHA = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
const KEY = `${LISTING}:1.4.2:${SHA.slice(0, 7)}`;

const CAPABLE: EngineCapabilityReport = { legacy: false, capabilities: ["modules.marketplaceInstall"] };
const NOT_CAPABLE: EngineCapabilityReport = { legacy: false, capabilities: ["modules.files"] };

/** A gate that records which inputs it was asked for. */
function gate(
  overrides: Partial<{
    access: "public" | "dev";
    buyerTokens: boolean;
    report: EngineCapabilityReport;
  }> = {}
) {
  const asked: string[] = [];
  const value: EngineInstallGate = {
    access: overrides.access ?? "public",
    buyerTokens: overrides.buyerTokens ?? true,
    capabilities: async () => {
      asked.push("capabilities");
      return overrides.report ?? CAPABLE;
    },
  };
  return { gate: value, asked };
}

/** An engine session that answers each method from the given handlers and records its calls. */
function fakeEngine(handlers: Partial<MarketplaceEngine>) {
  const calls: { method: string; args: unknown[] }[] = [];
  const sessions = { opened: 0 };
  const open = (): MarketplaceEngine => {
    sessions.opened += 1;
    return {
      installMarketplaceListing: async (...args: Parameters<MarketplaceEngine["installMarketplaceListing"]>) => {
        calls.push({ method: "installMarketplaceListing", args });
        if (!handlers.installMarketplaceListing) {
          throw new Error("unexpected installMarketplaceListing");
        }
        return await handlers.installMarketplaceListing(...args);
      },
      inspectMarketplaceListing: async (...args: Parameters<MarketplaceEngine["inspectMarketplaceListing"]>) => {
        calls.push({ method: "inspectMarketplaceListing", args });
        if (!handlers.inspectMarketplaceListing) {
          throw new Error("unexpected inspectMarketplaceListing");
        }
        return await handlers.inspectMarketplaceListing(...args);
      },
      installMarketplaceBundle: async (...args: Parameters<MarketplaceEngine["installMarketplaceBundle"]>) => {
        calls.push({ method: "installMarketplaceBundle", args });
        if (!handlers.installMarketplaceBundle) {
          throw new Error("unexpected installMarketplaceBundle");
        }
        return await handlers.installMarketplaceBundle(...args);
      },
    } as MarketplaceEngine;
  };
  return { open, calls, sessions };
}

function moduleInstallDeps(answer: () => Promise<EngineModuleInstallResult>) {
  const engine = fakeEngine({ installMarketplaceListing: answer });
  const emitted: { progress: ModuleInstallProgress; since: number }[] = [];
  const recorded: string[] = [];
  let tokens = 0;
  return {
    engine,
    emitted,
    recorded,
    tokensMinted: () => tokens,
    deps: {
      engine: engine.open,
      buyerToken: async () => {
        tokens += 1;
        return TOKEN;
      },
      emitProgress: async (progress: ModuleInstallProgress, since: number) => {
        emitted.push({ progress, since });
      },
      recordInstall: async (moduleKey: string) => {
        recorded.push(moduleKey);
      },
      now: () => 1_000,
    },
  };
}

const APPROVAL = {
  listingId: LISTING,
  listingName: "OBS Scenes",
  manifestId: LISTING,
  approvedPermissions: ["chat.read"],
  approvedLocalEndpoints: ["obs"],
};

async function convexErrorMessage(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(ConvexError);
    return (err as ConvexError<string>).data;
  }
  throw new Error("expected a ConvexError");
}

describe("routeThroughEngine", () => {
  test("takes the engine path with the capability reported and public access", async () => {
    const { gate: g, asked } = gate();
    expect(await routeThroughEngine(g)).toBe(true);
    expect(asked).toEqual(["capabilities"]);
  });

  test("an engine without the capability keeps the Convex path", async () => {
    expect(await routeThroughEngine(gate({ report: NOT_CAPABLE }).gate)).toBe(false);
    expect(await routeThroughEngine(gate({ report: LEGACY_ENGINE_REPORT }).gate)).toBe(false);
  });

  test("dev access keeps the Convex path without asking the engine", async () => {
    const { gate: g, asked } = gate({ access: "dev" });
    expect(await routeThroughEngine(g)).toBe(false);
    expect(asked).toEqual([]);
  });

  test("a deployment that cannot mint buyer tokens keeps the Convex path without asking the engine", async () => {
    const { gate: g, asked } = gate({ buyerTokens: false });
    expect(await routeThroughEngine(g)).toBe(false);
    expect(asked).toEqual([]);
  });

  test("an engine that cannot report capabilities keeps the Convex path", async () => {
    const g: EngineInstallGate = {
      access: "public",
      buyerTokens: true,
      capabilities: async () => {
        throw new Error("fetch failed");
      },
    };
    expect(await routeThroughEngine(g)).toBe(false);
  });
});

describe("buyerTokensConfigured", () => {
  test("needs both the key and its id", () => {
    expect(buyerTokensConfigured({ [BUYER_SIGNING_KEY_ENV]: "{}", [BUYER_SIGNING_KEY_ID_ENV]: "k1" })).toBe(true);
    expect(buyerTokensConfigured({ [BUYER_SIGNING_KEY_ENV]: "{}" })).toBe(false);
    expect(buyerTokensConfigured({ [BUYER_SIGNING_KEY_ENV]: " ", [BUYER_SIGNING_KEY_ID_ENV]: "k1" })).toBe(false);
    expect(buyerTokensConfigured({})).toBe(false);
  });
});

describe("marketplaceEngineFor", () => {
  const instanceId = "instance1" as Id<"instances">;
  const savedEnv = { key: process.env[BUYER_SIGNING_KEY_ENV], id: process.env[BUYER_SIGNING_KEY_ID_ENV] };
  const savedFetch = globalThis.fetch;
  let fetched: string[] = [];

  beforeEach(() => {
    process.env[BUYER_SIGNING_KEY_ENV] = "{}";
    process.env[BUYER_SIGNING_KEY_ID_ENV] = "k1";
    fetched = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      fetched.push(String(input instanceof Request ? input.url : input));
      throw new Error("no network in tests");
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = savedFetch;
    for (const [name, value] of [
      [BUYER_SIGNING_KEY_ENV, savedEnv.key],
      [BUYER_SIGNING_KEY_ID_ENV, savedEnv.id],
    ] as const) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  });

  function fakeCtx(instance: Record<string, unknown> | null) {
    const queries: string[] = [];
    const ctx = {
      runQuery: async (ref: Parameters<typeof getFunctionName>[0]) => {
        const name = getFunctionName(ref);
        queries.push(name);
        if (name === "instances:getInternal") {
          return instance;
        }
        throw new Error(`unexpected query ${name}`);
      },
    } as unknown as ActionCtx;
    return { ctx, queries };
  }

  const registered = { url: "https://engine.example", clientId: "c", clientSecret: "s", accountId: "a" };

  test("an engine that cannot be reached answers the Convex path", async () => {
    const { ctx, queries } = fakeCtx(registered);
    expect(await marketplaceEngineFor(ctx, instanceId)).toBeNull();
    expect(queries).toEqual(["instances:getInternal"]);
    expect(fetched.length).toBeGreaterThan(0);
    expect(fetched.every((url) => url.startsWith(registered.url))).toBe(true);
  });

  test("a module install on an unreachable engine takes the Convex path without asking the marketplace", async () => {
    const { ctx } = fakeCtx(registered);
    expect(await marketplaceModuleEngineFor(ctx, instanceId, LISTING)).toBeNull();
    expect(fetched.every((url) => url.startsWith(registered.url))).toBe(true);
  });

  test("without the buyer signing key the engine is never asked", async () => {
    delete process.env[BUYER_SIGNING_KEY_ID_ENV];
    const { ctx, queries } = fakeCtx(registered);
    expect(await marketplaceEngineFor(ctx, instanceId)).toBeNull();
    expect(queries).toEqual(["instances:getInternal"]);
    expect(fetched).toEqual([]);
  });

  test("dev access answers the Convex path without asking the engine", async () => {
    const { ctx, queries } = fakeCtx({ ...registered, marketplaceDevAccess: true });
    expect(await marketplaceEngineFor(ctx, instanceId)).toBeNull();
    expect(queries).toEqual(["instances:getInternal"]);
    expect(fetched).toEqual([]);
  });

  test("an instance not registered with its engine answers the Convex path", async () => {
    expect(await marketplaceEngineFor(fakeCtx({ ...registered, clientSecret: undefined }).ctx, instanceId)).toBeNull();
    expect(await marketplaceEngineFor(fakeCtx(null).ctx, instanceId)).toBeNull();
  });
});

describe("installModuleThroughEngine", () => {
  test("installs with a fresh buyer token and the approvals, then reports progress in the Convex path's words", async () => {
    const t = moduleInstallDeps(async () => ({ status: "installed", moduleKey: KEY }));
    expect(await installModuleThroughEngine(t.deps, APPROVAL)).toEqual({ status: "installed", moduleKey: KEY });

    expect(t.tokensMinted()).toBe(1);
    expect(t.engine.sessions.opened).toBe(1);
    const [call] = t.engine.calls;
    expect(call.method).toBe("installMarketplaceListing");
    const [listingId, request] = call.args as [string, MarketplaceInstallRequest];
    expect(listingId).toBe(LISTING);
    expect(request).toEqual({ approvedPermissions: ["chat.read"], approvedLocalEndpoints: ["obs"], buyerToken: TOKEN });

    expect(t.emitted).toEqual([{ progress: moduleInstallProgress(KEY, "OBS Scenes", "1.4.2"), since: 1_000 }]);
    expect(t.emitted[0].progress).toEqual({
      moduleKey: KEY,
      message: "Installing OBS Scenes@1.4.2 from marketplace...",
      data: { moduleName: "OBS Scenes", moduleVersion: "1.4.2", source: "marketplace" },
    });
    expect(t.recorded).toEqual([KEY]);
  });

  test("a later edition installs under its manifest id and is recorded as the listing it came from", async () => {
    const key = "cozy:2.0.0:abcdef0";
    const t = moduleInstallDeps(async () => ({ status: "installed", moduleKey: key }));
    const request = { ...APPROVAL, listingId: "cozy-v2", listingName: "Cozy", manifestId: "cozy" };
    expect(await installModuleThroughEngine(t.deps, request)).toEqual({ status: "installed", moduleKey: key });
    expect(t.engine.calls[0].args[0]).toBe("cozy-v2");
    expect(t.emitted).toEqual([{ progress: moduleInstallProgress(key, "Cozy", "2.0.0"), since: 1_000 }]);
    expect(t.recorded).toEqual([key]);
  });

  test("an already installed build answers like a fresh install and leaves the engine's success event alone", async () => {
    const t = moduleInstallDeps(async () => ({ status: "installed", moduleKey: KEY, alreadyInstalled: true }));
    expect(await installModuleThroughEngine(t.deps, APPROVAL)).toEqual({ status: "installed", moduleKey: KEY });
    expect(t.emitted).toEqual([]);
    expect(t.recorded).toEqual([KEY]);
  });

  test("passes needs_approval through in the Convex path's shape, without progress", async () => {
    const t = moduleInstallDeps(async () => ({
      status: "needs_approval",
      name: "OBS Scenes",
      version: "1.5.0",
      unapproved: ["chat.write"],
      unapprovedLocalEndpoints: ["obs-2"],
    }));
    expect(await installModuleThroughEngine(t.deps, APPROVAL)).toEqual({
      status: "needs_approval",
      name: "OBS Scenes",
      version: "1.5.0",
      unapproved: ["chat.write"],
      unapprovedLocalEndpoints: ["obs-2"],
    });
    expect(t.emitted).toEqual([]);
  });

  test("payment_required is the refusal the Convex path's acquire raises for a 402", async () => {
    const t = moduleInstallDeps(async () => ({ status: "payment_required", name: "OBS Scenes", version: "1.4.2" }));
    const message = await convexErrorMessage(installModuleThroughEngine(t.deps, APPROVAL));
    expect(message).toBe("OBS Scenes hasn't been bought on this account.");
    expect(message).toBe(
      acquireRefusal(new MarketplaceError(402, "payment_required", "payment required"), "OBS Scenes")
    );
    expect(t.emitted).toEqual([]);
  });

  test("an engine failure reaches the browser with the engine's message and reports no progress", async () => {
    const t = moduleInstallDeps(async () => {
      throw new Error("Marketplace archive does not match the marketplace's sha256 hash");
    });
    expect(await convexErrorMessage(installModuleThroughEngine(t.deps, APPROVAL))).toBe(
      "Marketplace archive does not match the marketplace's sha256 hash"
    );
    expect(t.emitted).toEqual([]);
  });
});

describe("versionFromModuleKey", () => {
  test("reads the version out of the pinned key format", () => {
    expect(versionFromModuleKey(LISTING, KEY)).toBe("1.4.2");
    expect(versionFromModuleKey("a", "a:2.0.0-beta.1:1234567")).toBe("2.0.0-beta.1");
    expect(versionFromModuleKey("cozy", "cozy:2.0.0:1234567")).toBe("2.0.0");
  });

  test("refuses a key in any other format", () => {
    expect(() => versionFromModuleKey(LISTING, `other:1.4.2:${SHA.slice(0, 7)}`)).toThrow();
    expect(() => versionFromModuleKey(LISTING, `${LISTING}:1.4.2`)).toThrow();
    expect(() => versionFromModuleKey(LISTING, LISTING)).toThrow();
    // A later edition's key carries its manifest id, never its listing id.
    expect(() => versionFromModuleKey("cozy", "cozy-v2:2.0.0:1234567")).toThrow();
  });
});

describe("installBundleThroughEngine", () => {
  function deps(answer: () => Promise<MarketplaceBundleInstallResult>) {
    const engine = fakeEngine({ installMarketplaceBundle: answer });
    return { engine, deps: { engine: engine.open, buyerToken: async () => TOKEN } };
  }

  test("maps an installed bundle to the Convex path's result", async () => {
    const t = deps(async () => ({ status: "installed", listingId: "cozy", engineId: "scene-1", kind: "scene" }));
    expect(await installBundleThroughEngine(t.deps, "cozy")).toEqual({
      listingId: "cozy",
      engineId: "scene-1",
      kind: "scene",
    });
    expect(t.engine.calls).toEqual([{ method: "installMarketplaceBundle", args: ["cozy", TOKEN] }]);
  });

  test("payment_required is the refusal the Convex path's acquire raises for a 402", async () => {
    const t = deps(async () => ({ status: "payment_required", name: "Cozy Cats", version: "1.0.0" }));
    expect(await convexErrorMessage(installBundleThroughEngine(t.deps, "cozy"))).toBe(notBoughtMessage("Cozy Cats"));
  });

  test("an engine failure reaches the browser with the engine's message, unparsed", async () => {
    const t = deps(async () => {
      throw new Error("Marketplace POST /catalog/cozy/acquire failed with 409 (listing_unavailable: replaced)");
    });
    expect(await convexErrorMessage(installBundleThroughEngine(t.deps, "cozy"))).toBe(
      "Marketplace POST /catalog/cozy/acquire failed with 409 (listing_unavailable: replaced)"
    );
  });
});

const INSPECTION: MarketplaceListingInspection = {
  listingId: LISTING,
  type: "module",
  name: "OBS Scenes",
  version: "1.4.2",
  moduleKey: KEY,
  sha256: SHA,
  sizeBytes: 2048,
  manifest: { id: LISTING, name: "OBS Scenes", version: "1.4.2", description: "" },
  permissions: ["chat.read", "obs.control"],
  localEndpoints: [
    { id: "obs", name: "OBS", protocol: "websocket" },
    { id: "printer", name: "Printer", protocol: "lpr" },
    { id: "blank", name: " ", protocol: "http" },
  ],
  files: [
    { path: "manifest.json", size: 120 },
    { path: "src/index.ts", size: 900 },
  ],
};

describe("inspectThroughEngine", () => {
  test("reads the build with a buyer token and lists its files as listModuleFiles does", async () => {
    const engine = fakeEngine({ inspectMarketplaceListing: async () => INSPECTION });
    const inspection = await inspectThroughEngine({ engine: engine.open, buyerToken: async () => TOKEN }, LISTING);
    expect(engine.calls).toEqual([{ method: "inspectMarketplaceListing", args: [LISTING, TOKEN] }]);
    expect(moduleFilesFromInspection(inspection)).toEqual({
      available: true,
      files: [
        { path: "manifest.json", size: 120 },
        { path: "src/index.ts", size: 900 },
      ],
    });
  });

  test("a failure propagates unchanged, for the caller to answer as it does on the Convex path", async () => {
    const failure = new Error("Marketplace archive does not match the marketplace's sha256 hash");
    const engine = fakeEngine({
      inspectMarketplaceListing: async () => {
        throw failure;
      },
    });
    await expect(inspectThroughEngine({ engine: engine.open, buyerToken: async () => TOKEN }, LISTING)).rejects.toBe(
      failure
    );
  });
});

describe("setupReviewFromInspection", () => {
  test("offers the permissions and the endpoints the dashboard can show", () => {
    expect(setupReviewFromInspection(INSPECTION)).toEqual({
      permissions: ["chat.read", "obs.control"],
      localEndpoints: [{ id: "obs", name: "OBS", protocol: "websocket" }],
    });
  });
});

describe("engineFailure", () => {
  test("passes the engine's message on as a ConvexError", () => {
    const err = engineFailure(new Error("Marketplace installs are turned off on this engine"));
    expect(err).toBeInstanceOf(ConvexError);
    expect(err.data).toBe("Marketplace installs are turned off on this engine");
  });

  test("keeps a ConvexError as it is", () => {
    const original = new ConvexError("already readable");
    expect(engineFailure(original)).toBe(original);
  });
});

function listing(overrides: Record<string, unknown>): CatalogListing {
  const parsed = parseCatalogListing({ id: "cozy", type: "module", name: "Cozy", version: "1.0.0", ...overrides });
  if (!parsed) {
    throw new Error("test listing did not parse");
  }
  return parsed;
}

describe("moduleListingStaysOnConvex", () => {
  test("a module or theme installs on the engine", () => {
    expect(moduleListingStaysOnConvex(listing({ moduleKey: "cozy" }))).toBeNull();
    expect(moduleListingStaysOnConvex(listing({ type: "theme", moduleKey: "cozy" }))).toBeNull();
    expect(moduleListingStaysOnConvex(listing({}))).toBeNull();
  });

  test("a later edition installs on the engine too", () => {
    expect(moduleListingStaysOnConvex(listing({ id: "cozy-v2", moduleKey: "cozy", edition: 2 }))).toBeNull();
    expect(
      moduleListingStaysOnConvex(listing({ id: "cozy-v2", type: "theme", moduleKey: "cozy", edition: 2 }))
    ).toBeNull();
  });

  test("a listing that is not a module stays on the Convex path, which refuses it", () => {
    expect(moduleListingStaysOnConvex(listing({ type: "overlay" }))).not.toBeNull();
  });
});
