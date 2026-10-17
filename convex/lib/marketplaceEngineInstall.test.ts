import { describe, expect, test } from "bun:test";
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
import { FEATURE_FLAGS, isFeatureFlagKey } from "./featureFlags";
import {
  ENGINE_INSTALL_FLAG,
  type EngineInstallGate,
  engineMarketplaceRefusal,
  inspectThroughEngine,
  installBundleThroughEngine,
  installModuleThroughEngine,
  type MarketplaceEngine,
  type ModuleInstallProgress,
  marketplaceEngineFor,
  moduleFilesFromInspection,
  moduleInstallProgress,
  routeThroughEngine,
  setupReviewFromInspection,
  versionFromModuleKey,
} from "./marketplaceEngineInstall";
import { notPurchasedMessage } from "./marketplaceEntitlement";

const LISTING = "obs-scenes";
const TOKEN = "header.claims.signature";
const SHA = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
const KEY = `${LISTING}:1.4.2:${SHA.slice(0, 7)}`;

const CAPABLE: EngineCapabilityReport = { legacy: false, capabilities: ["modules.marketplaceInstall"] };
const NOT_CAPABLE: EngineCapabilityReport = { legacy: false, capabilities: ["modules.files"] };

/** A gate that records which inputs it was asked for. */
function gate(overrides: Partial<{ access: "public" | "dev"; flag: boolean; report: EngineCapabilityReport }> = {}) {
  const asked: string[] = [];
  const value: EngineInstallGate = {
    access: overrides.access ?? "public",
    flagOn: async () => {
      asked.push("flag");
      return overrides.flag ?? true;
    },
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

function moduleInstallDeps(answer: () => Promise<EngineModuleInstallResult>, name: () => Promise<string>) {
  const engine = fakeEngine({ installMarketplaceListing: answer });
  const emitted: { progress: ModuleInstallProgress; since: number }[] = [];
  let tokens = 0;
  return {
    engine,
    emitted,
    tokensMinted: () => tokens,
    deps: {
      engine: engine.open,
      buyerToken: async () => {
        tokens += 1;
        return TOKEN;
      },
      listingName: name,
      emitProgress: async (progress: ModuleInstallProgress, since: number) => {
        emitted.push({ progress, since });
      },
      now: () => 1_000,
    },
  };
}

const APPROVAL = { listingId: LISTING, approvedPermissions: ["chat.read"], approvedLocalEndpoints: ["obs"] };

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
  test("takes the engine path only with the flag on, the capability reported and public access", async () => {
    const { gate: g, asked } = gate();
    expect(await routeThroughEngine(g)).toBe(true);
    expect(asked).toEqual(["flag", "capabilities"]);
  });

  test("flag off keeps the Convex path without asking the engine anything", async () => {
    const { gate: g, asked } = gate({ flag: false });
    expect(await routeThroughEngine(g)).toBe(false);
    expect(asked).toEqual(["flag"]);
  });

  test("an engine without the capability keeps the Convex path", async () => {
    expect(await routeThroughEngine(gate({ report: NOT_CAPABLE }).gate)).toBe(false);
    expect(await routeThroughEngine(gate({ report: LEGACY_ENGINE_REPORT }).gate)).toBe(false);
  });

  test("dev access keeps the Convex path before the flag is read", async () => {
    const { gate: g, asked } = gate({ access: "dev" });
    expect(await routeThroughEngine(g)).toBe(false);
    expect(asked).toEqual([]);
  });

  test("an engine that cannot report capabilities keeps the Convex path", async () => {
    const g: EngineInstallGate = {
      access: "public",
      flagOn: async () => true,
      capabilities: async () => {
        throw new Error("fetch failed");
      },
    };
    expect(await routeThroughEngine(g)).toBe(false);
  });
});

describe("marketplaceEngineFor", () => {
  const instanceId = "instance1" as Id<"instances">;

  function fakeCtx(instance: Record<string, unknown> | null, flag: boolean) {
    const queries: string[] = [];
    const ctx = {
      runQuery: async (ref: Parameters<typeof getFunctionName>[0], args: Record<string, unknown>) => {
        const name = getFunctionName(ref);
        queries.push(name);
        if (name === "instances:getInternal") {
          return instance;
        }
        if (name === "featureFlags:isOnForInstance") {
          expect(args).toEqual({ key: ENGINE_INSTALL_FLAG, instanceId });
          return flag;
        }
        throw new Error(`unexpected query ${name}`);
      },
    } as unknown as ActionCtx;
    return { ctx, queries };
  }

  const registered = { url: "https://engine.example", clientId: "c", clientSecret: "s", accountId: "a" };

  test("flag off answers the Convex path after reading only Convex", async () => {
    const { ctx, queries } = fakeCtx(registered, false);
    expect(await marketplaceEngineFor(ctx, instanceId)).toBeNull();
    expect(queries).toEqual(["instances:getInternal", "featureFlags:isOnForInstance"]);
  });

  test("dev access answers the Convex path without reading the flag", async () => {
    const { ctx, queries } = fakeCtx({ ...registered, marketplaceDevAccess: true }, true);
    expect(await marketplaceEngineFor(ctx, instanceId)).toBeNull();
    expect(queries).toEqual(["instances:getInternal"]);
  });

  test("an instance not registered with its engine answers the Convex path", async () => {
    expect(await marketplaceEngineFor(fakeCtx({ ...registered, clientSecret: undefined }, true).ctx, instanceId)).toBe(
      null
    );
    expect(await marketplaceEngineFor(fakeCtx(null, true).ctx, instanceId)).toBeNull();
  });
});

describe("the flag", () => {
  test("is declared, so an operator can target it", () => {
    expect(isFeatureFlagKey(ENGINE_INSTALL_FLAG)).toBe(true);
    expect(FEATURE_FLAGS[ENGINE_INSTALL_FLAG].removeBy).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("installModuleThroughEngine", () => {
  test("installs with a fresh buyer token and the approvals, then reports progress in the Convex path's words", async () => {
    const t = moduleInstallDeps(
      async () => ({ status: "installed", moduleKey: KEY }),
      async () => "OBS Scenes"
    );
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
  });

  test("an already installed build answers like a fresh install and leaves the engine's success event alone", async () => {
    const t = moduleInstallDeps(
      async () => ({ status: "installed", moduleKey: KEY, alreadyInstalled: true }),
      async () => "OBS Scenes"
    );
    expect(await installModuleThroughEngine(t.deps, APPROVAL)).toEqual({ status: "installed", moduleKey: KEY });
    expect(t.emitted).toEqual([]);
  });

  test("names the listing by id when its name cannot be read", async () => {
    const t = moduleInstallDeps(
      async () => ({ status: "installed", moduleKey: KEY }),
      async () => {
        throw new Error("marketplace down");
      }
    );
    await installModuleThroughEngine(t.deps, APPROVAL);
    expect(t.emitted[0].progress.message).toBe(`Installing ${LISTING}@1.4.2 from marketplace...`);
  });

  test("passes needs_approval through in the Convex path's shape, without progress", async () => {
    const t = moduleInstallDeps(
      async () => ({
        status: "needs_approval",
        name: "OBS Scenes",
        version: "1.5.0",
        unapproved: ["chat.write"],
        unapprovedLocalEndpoints: ["obs-2"],
      }),
      async () => "OBS Scenes"
    );
    expect(await installModuleThroughEngine(t.deps, APPROVAL)).toEqual({
      status: "needs_approval",
      name: "OBS Scenes",
      version: "1.5.0",
      unapproved: ["chat.write"],
      unapprovedLocalEndpoints: ["obs-2"],
    });
    expect(t.emitted).toEqual([]);
  });

  test("payment_required is the refusal requireEntitlement raises", async () => {
    const t = moduleInstallDeps(
      async () => ({ status: "payment_required", name: "OBS Scenes", version: "1.4.2" }),
      async () => "OBS Scenes"
    );
    expect(await convexErrorMessage(installModuleThroughEngine(t.deps, APPROVAL))).toBe(
      "OBS Scenes has not been purchased on this account."
    );
    expect(notPurchasedMessage("OBS Scenes")).toBe("OBS Scenes has not been purchased on this account.");
    expect(t.emitted).toEqual([]);
  });

  test("an engine failure propagates and reports no progress", async () => {
    const t = moduleInstallDeps(
      async () => {
        throw new Error("Marketplace archive does not match the marketplace's sha256 hash");
      },
      async () => "OBS Scenes"
    );
    await expect(installModuleThroughEngine(t.deps, APPROVAL)).rejects.toThrow("sha256");
    expect(t.emitted).toEqual([]);
  });
});

describe("versionFromModuleKey", () => {
  test("reads the version out of the pinned key format", () => {
    expect(versionFromModuleKey(LISTING, KEY)).toBe("1.4.2");
    expect(versionFromModuleKey("a", "a:2.0.0-beta.1:1234567")).toBe("2.0.0-beta.1");
  });

  test("refuses a key in any other format", () => {
    expect(() => versionFromModuleKey(LISTING, `other:1.4.2:${SHA.slice(0, 7)}`)).toThrow();
    expect(() => versionFromModuleKey(LISTING, `${LISTING}:1.4.2`)).toThrow();
    expect(() => versionFromModuleKey(LISTING, LISTING)).toThrow();
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

  test("payment_required is the refusal requireEntitlement raises", async () => {
    const t = deps(async () => ({ status: "payment_required", name: "Cozy Cats", version: "1.0.0" }));
    expect(await convexErrorMessage(installBundleThroughEngine(t.deps, "cozy"))).toBe(
      "Cozy Cats has not been purchased on this account."
    );
  });

  test("a missing listing reads as the Convex path's not-found", async () => {
    const t = deps(async () => {
      throw new Error("Marketplace GET /catalog/cozy failed with 404 (not_found: listing not found)");
    });
    expect(await convexErrorMessage(installBundleThroughEngine(t.deps, "cozy"))).toBe(
      "Marketplace listing cozy was not found"
    );
  });

  test("a module listing is refused with the same text, visible to the browser", async () => {
    const t = deps(async () => {
      throw new Error("OBS Scenes is a module listing and does not install as a bundle");
    });
    expect(await convexErrorMessage(installBundleThroughEngine(t.deps, "obs-scenes"))).toBe(
      "OBS Scenes is a module listing and does not install as a bundle"
    );
  });

  test("any other failure propagates unchanged", async () => {
    const failure = new Error("Marketplace POST /catalog/cozy/acquire failed with 409 (superseded)");
    const t = deps(async () => {
      throw failure;
    });
    await expect(installBundleThroughEngine(t.deps, "cozy")).rejects.toBe(failure);
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
    const inspection = await inspectThroughEngine(
      { engine: engine.open, buyerToken: async () => TOKEN },
      LISTING,
      LISTING
    );
    expect(engine.calls).toEqual([{ method: "inspectMarketplaceListing", args: [LISTING, TOKEN] }]);
    expect(moduleFilesFromInspection(inspection)).toEqual({
      available: true,
      files: [
        { path: "manifest.json", size: 120 },
        { path: "src/index.ts", size: 900 },
      ],
    });
  });

  test("a download refused to the buyer is the Convex path's purchase refusal", async () => {
    for (const status of [401, 402, 403]) {
      const engine = fakeEngine({
        inspectMarketplaceListing: async () => {
          throw new Error(`Marketplace GET /modules/${LISTING}/download failed with ${status} (forbidden)`);
        },
      });
      expect(
        await convexErrorMessage(
          inspectThroughEngine({ engine: engine.open, buyerToken: async () => TOKEN }, LISTING, LISTING)
        )
      ).toBe(notPurchasedMessage(LISTING));
    }
  });

  test("any other failure propagates unchanged", async () => {
    const failure = new Error("Marketplace archive does not match the marketplace's sha256 hash");
    const engine = fakeEngine({
      inspectMarketplaceListing: async () => {
        throw failure;
      },
    });
    await expect(
      inspectThroughEngine({ engine: engine.open, buyerToken: async () => TOKEN }, LISTING, LISTING)
    ).rejects.toBe(failure);
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

describe("engineMarketplaceRefusal", () => {
  test("reads the engine's marketplace error format", () => {
    expect(engineMarketplaceRefusal(new Error("Marketplace GET /catalog/x failed with 404 (not_found: gone)"))).toEqual(
      { method: "GET", path: "/catalog/x", status: 404 }
    );
    expect(engineMarketplaceRefusal(new Error("Marketplace POST /catalog/x/acquire failed with 409"))).toEqual({
      method: "POST",
      path: "/catalog/x/acquire",
      status: 409,
    });
  });

  test("is null for any other error", () => {
    expect(engineMarketplaceRefusal(new Error("fetch failed"))).toBeNull();
    expect(engineMarketplaceRefusal(null)).toBeNull();
  });
});
