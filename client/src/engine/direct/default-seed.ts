import {
  DEFAULT_ALERT_ITEMS,
  DEFAULT_ALERTS_PACK_ID,
  type DefaultSeedEngine,
  defaultAlertStatus,
  defaultAlertsPack,
  readDefaultAlertImages,
  seedDefaultScene,
} from "@shared/default-seed";
import { starterItemKey } from "@shared/starter-packs";
import { ENGINE_CAPABILITIES, type UISetting } from "@woofx3/api";
import { useMemo } from "react";
import { z } from "zod";
import type { DefaultSeedGateway } from "@/engine/gateway";
import type { DefaultSeedStatus } from "@/engine/types";
import { directKeys as k } from "./keys";
import { useEngineQuery, useEngineRequest } from "./query";
import type { DirectRuntime } from "./runtime";
import { installPackItems, ledgerEngineId } from "./starter-packs";
import { parseSetting, putUISetting, toSettingValue, UI_SETTING_NAMESPACES, uiSettingsRead } from "./ui-settings";

// The seed's outcomes live in one UI setting, beside the starter pack ledger
// that names the alerts' workflows. Nothing here reads whether a scene or
// workflow still exists: recorded means seeded, which is what keeps something
// the streamer deleted from coming back.

const RECORD_KEY = "state";
const MEMBER = "defaultSeed.useApplyRequest";

const statusSchema = z.enum(["installed", "pending", "failed"]);
const recordSchema = z.object({
  scene: z.object({
    status: statusSchema,
    engineSceneId: z.string().optional(),
    error: z.string().optional(),
  }),
  alerts: z.array(z.object({ itemId: z.string(), status: statusSchema, error: z.string().optional() })),
  alertImagesOmitted: z.boolean(),
});
type SeedRecord = z.infer<typeof recordSchema>;

function seedEngine(runtime: DirectRuntime): DefaultSeedEngine {
  return {
    getEngineInfo: () => runtime.call("getEngineInfo", (api) => api.getEngineInfo()),
    listEngineModules: () => runtime.call("listEngineModules", (api) => api.listEngineModules()),
    getAvailableWidgets: () => runtime.call("getAvailableWidgets", (api) => api.getAvailableWidgets()),
    getScenes: (query) => runtime.call("getScenes", (api) => api.getScenes(query)),
    createScene: (scene) => runtime.call("createScene", (api) => api.createScene(scene)),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The gateway's status from the seed's record and the ledger's settings. */
export function defaultSeedStatus(record: SeedRecord | null, ledger: readonly UISetting[]): DefaultSeedStatus {
  return {
    scene: record?.scene ?? { status: "pending" },
    alerts: DEFAULT_ALERT_ITEMS.map((item) => {
      const engineWorkflowId = ledgerEngineId(ledger, starterItemKey(DEFAULT_ALERTS_PACK_ID, item.id));
      const recorded = record?.alerts.find((alert) => alert.itemId === item.id);
      return {
        itemId: item.id,
        event: item.trigger.event,
        status: engineWorkflowId !== undefined ? "installed" : (recorded?.status ?? "pending"),
        engineWorkflowId,
        error: engineWorkflowId !== undefined ? undefined : recorded?.error,
      };
    }),
    alertImagesOmitted: record?.alertImagesOmitted ?? false,
  };
}

export function directDefaultSeedGateway(runtime: DirectRuntime): DefaultSeedGateway {
  const recordRead = uiSettingsRead(runtime, UI_SETTING_NAMESPACES.defaultSeed, "defaultSeed.useStatus");
  const ledgerRead = uiSettingsRead(runtime, UI_SETTING_NAMESPACES.starterPacks, "defaultSeed.useStatus");
  const claimed = new Set<string>();

  const readRecord = (settings: readonly UISetting[]): SeedRecord | null => {
    const setting = settings.find((entry) => entry.key === RECORD_KEY);
    return setting === undefined ? null : parseSetting(runtime.logger, recordSchema, setting);
  };

  const useStatus: DefaultSeedGateway["useStatus"] = () => {
    const record = useEngineQuery(runtime, recordRead);
    const ledger = useEngineQuery(runtime, ledgerRead);
    return useMemo(() => {
      if (record === undefined || ledger === undefined) {
        return undefined;
      }
      return defaultSeedStatus(readRecord(record), ledger);
    }, [record, ledger]);
  };

  const apply = async () => {
    const engine = seedEngine(runtime);
    const previous = readRecord(
      await runtime.call("listUISettings", (api) => api.listUISettings(UI_SETTING_NAMESPACES.defaultSeed))
    );
    const scene =
      previous?.scene.engineSceneId !== undefined
        ? previous.scene
        : await seedDefaultScene(engine).catch((error: unknown): SeedRecord["scene"] => ({
            status: "pending",
            error: errorMessage(error),
          }));
    let alerts: SeedRecord["alerts"];
    let alertImagesOmitted = previous?.alertImagesOmitted ?? false;
    try {
      if (!runtime.supports(ENGINE_CAPABILITIES.alertsCompositionLayout)) {
        throw new Error("Requires engine update");
      }
      const imagesBaseUrl = await readDefaultAlertImages(engine);
      alertImagesOmitted = imagesBaseUrl === null;
      const outcomes = await installPackItems(runtime, defaultAlertsPack(imagesBaseUrl), {}, claimed, true);
      alerts = outcomes.map((outcome) => ({
        itemId: outcome.itemId,
        status: defaultAlertStatus(outcome.outcome),
        error: outcome.message,
      }));
    } catch (error) {
      alerts = DEFAULT_ALERT_ITEMS.map((item) => ({
        itemId: item.id,
        status: "failed",
        error: errorMessage(error),
      }));
    }
    await putUISetting(
      runtime,
      UI_SETTING_NAMESPACES.defaultSeed,
      RECORD_KEY,
      toSettingValue(JSON.parse(JSON.stringify({ scene, alerts, alertImagesOmitted }))),
      MEMBER
    );
    await runtime.queryClient.invalidateQueries({ queryKey: k.scenes.all });
  };

  return { useStatus, useApplyRequest: () => useEngineRequest(apply) };
}
