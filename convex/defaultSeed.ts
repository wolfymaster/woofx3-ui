import { getAuthUserId } from "@convex-dev/auth/server";
import {
  DEFAULT_ALERT_ITEMS,
  DEFAULT_ALERTS_PACK_ID,
  type DefaultSceneOutcome,
  defaultAlertStatus,
  defaultAlertsPack,
  readDefaultAlertImages,
  seedDefaultScene,
} from "@shared/default-seed";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { type ActionCtx, query } from "./_generated/server";
import { fetchEngineCapabilities, hasEngineCapability } from "./lib/engineCapabilities";
import { createEngineRpcSession, type EngineApi } from "./lib/engineInstanceUrl";
import { getInstanceMembership } from "./lib/teamAccess";
import { installSeedPack } from "./starterPacks";

// Applies the default seed (shared/default-seed.ts) during setup apply: the
// overlay scene, then the alerts. Each outcome is recorded on instanceSetup, so
// a failed alert does not hide the ones that worked and a retry skips them.

export type DefaultSeedRecord = NonNullable<Doc<"instanceSetup">["defaultSeed"]>;
type AlertRecord = DefaultSeedRecord["alerts"][number];

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function applyScene(engine: EngineApi, previous: DefaultSceneOutcome | undefined): Promise<DefaultSceneOutcome> {
  if (previous?.engineSceneId !== undefined) {
    return previous;
  }
  try {
    return await seedDefaultScene(engine);
  } catch (err) {
    return { status: "pending", error: errorMessage(err) };
  }
}

async function applyAlerts(
  ctx: ActionCtx,
  instanceId: Id<"instances">,
  engine: EngineApi,
  bundle: { url: string; clientId: string; clientSecret: string },
  previous: DefaultSeedRecord | undefined
): Promise<Pick<DefaultSeedRecord, "alerts" | "alertImages">> {
  const everyAlert = (status: AlertRecord["status"], error: string): AlertRecord[] =>
    DEFAULT_ALERT_ITEMS.map((item) => ({ itemId: item.id, status, error }));
  if (
    previous !== undefined &&
    DEFAULT_ALERT_ITEMS.every((item) =>
      previous.alerts.some((alert) => alert.itemId === item.id && alert.status === "installed")
    )
  ) {
    return { alerts: previous.alerts, alertImages: previous.alertImages };
  }
  try {
    if (!hasEngineCapability(await fetchEngineCapabilities(bundle), "alerts.compositionLayout")) {
      return { alerts: everyAlert("failed", "Requires engine update") };
    }
    const imagesBaseUrl = await readDefaultAlertImages(engine);
    const outcomes = await installSeedPack(ctx, instanceId, defaultAlertsPack(imagesBaseUrl));
    return {
      alerts: outcomes.map((outcome) => ({
        itemId: outcome.itemId,
        status: defaultAlertStatus(outcome.outcome),
        error: outcome.message,
      })),
      alertImages: imagesBaseUrl === null ? "omitted" : "included",
    };
  } catch (err) {
    return { alerts: everyAlert("pending", errorMessage(err)) };
  }
}

/** Runs the seed's steps on a registered engine. Never throws: each step's failure is in its outcome. */
export async function applyDefaultSeed(
  ctx: ActionCtx,
  instanceId: Id<"instances">,
  previous: DefaultSeedRecord | undefined
): Promise<DefaultSeedRecord> {
  const bundle = await ctx.runQuery(internal.engineSyncInternal.getInstanceBundle, { instanceId });
  if (!bundle) {
    const error = "Instance is not registered with the engine";
    return {
      scene: { status: "pending", error },
      alerts: DEFAULT_ALERT_ITEMS.map((item) => ({ itemId: item.id, status: "pending", error })),
    };
  }
  const engine = createEngineRpcSession<EngineApi>(bundle.url, bundle.clientId, bundle.clientSecret);
  const scene = await applyScene(engine, previous?.scene);
  const alerts = await applyAlerts(ctx, instanceId, engine, bundle, previous);
  return { scene, ...alerts };
}

export interface DefaultSeedStatus {
  scene: DefaultSceneOutcome;
  alerts: {
    itemId: string;
    /** The event the alert's workflow listens for. */
    event: string;
    status: AlertRecord["status"];
    /** The engine's id of the workflow, once its create has been confirmed. */
    engineWorkflowId?: string;
    error?: string;
  }[];
  alertImagesOmitted: boolean;
}

/** Where the instance's default seed stands; null for a non-member. */
export const status = query({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, { instanceId }): Promise<DefaultSeedStatus | null> => {
    const userId = await getAuthUserId(ctx);
    if (!userId || !(await getInstanceMembership(ctx, instanceId, userId))) {
      return null;
    }
    const row = await ctx.db
      .query("instanceSetup")
      .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
      .first();
    const seed = row?.defaultSeed;
    const alerts: DefaultSeedStatus["alerts"] = [];
    for (const item of DEFAULT_ALERT_ITEMS) {
      const ledger = await ctx.db
        .query("starterPackItems")
        .withIndex("by_instance_item", (q) =>
          q.eq("instanceId", instanceId).eq("packId", DEFAULT_ALERTS_PACK_ID).eq("itemId", item.id)
        )
        .first();
      const recorded = seed?.alerts.find((alert) => alert.itemId === item.id);
      alerts.push({
        itemId: item.id,
        event: item.trigger.event,
        // A create confirmed after the run gave up on it is in the ledger first.
        status: ledger?.status === "installed" ? "installed" : (recorded?.status ?? "pending"),
        engineWorkflowId: ledger?.engineId,
        error: ledger?.status === "installed" ? undefined : recorded?.error,
      });
    }
    return {
      scene: seed?.scene ?? { status: "pending" },
      alerts,
      alertImagesOmitted: seed?.alertImages === "omitted",
    };
  },
});
