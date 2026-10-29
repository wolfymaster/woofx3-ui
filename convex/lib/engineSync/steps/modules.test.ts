import { describe, expect, test } from "bun:test";
import { getFunctionName } from "convex/server";
import type { Id } from "../../../_generated/dataModel";
import type { ActionCtx } from "../../../_generated/server";
import type { EngineApi } from "../../engineInstanceUrl";
import { modulesStep } from "./modules";

function run(modules: Record<string, unknown>[]) {
  const sent: { name: string; args: Record<string, unknown> }[] = [];
  const ctx = {
    runMutation: async (ref: Parameters<typeof getFunctionName>[0], args: Record<string, unknown>) => {
      sent.push({ name: getFunctionName(ref), args });
      return { itemsProcessed: modules.length };
    },
  } as unknown as ActionCtx;
  const newApi = () => ({ listEngineModules: async () => modules }) as unknown as EngineApi;
  return { sent, done: modulesStep.run({ ctx, newApi, instanceId: "instance1" as Id<"instances"> }) };
}

const base = {
  name: "Cozy",
  version: "2.0.0",
  state: "active",
  createdByType: "USER",
  moduleId: "cozy",
  moduleKey: "cozy:2.0.0:abcdef0",
  manifest: { description: "Warm alerts" },
};

describe("modulesStep", () => {
  test("forwards the listing and edition the engine recorded for a module", async () => {
    const t = run([{ ...base, marketplaceListingId: "cozy-v2", marketplaceEdition: 2 }]);
    await t.done;
    const [snapshot] = t.sent[0].args.snapshots as Record<string, unknown>[];
    expect(t.sent[0].name).toBe("engineSyncInternal:reconcileModules");
    expect(snapshot.marketplaceListingId).toBe("cozy-v2");
    expect(snapshot.marketplaceEdition).toBe(2);
  });

  test("forwards the uploaded archive a module came from, and whether the engine ships it", async () => {
    const t = run([
      { ...base, uploadResourceId: "res-1", createdByType: "USER" },
      { ...base, moduleId: "woofx3", moduleKey: "woofx3:1.0.0:abcdef1", createdByType: "SYSTEM" },
    ]);
    await t.done;
    const [uploaded, bundled] = t.sent[0].args.snapshots as Record<string, unknown>[];
    expect([uploaded.uploadResourceId, uploaded.builtIn]).toEqual(["res-1", false]);
    expect([bundled.uploadResourceId, bundled.builtIn]).toEqual([undefined, true]);
  });

  test("an engine that predates provenance sends neither field, and none is invented", async () => {
    const t = run([base]);
    await t.done;
    const [snapshot] = t.sent[0].args.snapshots as Record<string, unknown>[];
    expect("marketplaceListingId" in snapshot).toBe(false);
    expect("marketplaceEdition" in snapshot).toBe(false);
    expect("uploadResourceId" in snapshot).toBe(false);
  });
});
