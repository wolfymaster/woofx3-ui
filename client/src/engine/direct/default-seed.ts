import {
  DEFAULT_ALERT_ITEMS,
  DEFAULT_ALERTS_PACK_ID,
  type DefaultSeedEngine,
  defaultAlertStatus,
  defaultAlertsPack,
  defaultAlertsToInstall,
  readDefaultAlertImages,
  seedDefaultScene,
} from "@shared/default-seed";
import { starterItemKey } from "@shared/starter-packs";
import type { UISetting } from "@woofx3/api";
import { useMemo } from "react";
import { z } from "zod";
import type { DefaultSeedGateway } from "@/engine/gateway";
import type { DefaultSeedStatus, OverlayDoneOutcome } from "@/engine/types";
import { directKeys as k } from "./keys";
import { useEngineQuery, useEngineRequest } from "./query";
import type { DirectRuntime } from "./runtime";
import { installPackItems, ledgerEngineId } from "./starter-packs";
import { parseSetting, putUISetting, toSettingValue, UI_SETTING_NAMESPACES, uiSettingsRead } from "./ui-settings";
import { readAllWorkflows } from "./workflow-pages";

// The seed's outcomes live in one UI setting, beside the starter pack ledger
// that names the alerts' workflows. Nothing here reads whether a scene or
// workflow still exists: recorded means seeded, which is what keeps something
// the streamer deleted from coming back.

const RECORD_KEY = "state";
const OVERLAY_DONE_KEY = "overlay-done";
const MEMBER = "defaultSeed.useApplyRequest";
const MARK_MEMBER = "defaultSeed.useMarkOverlayDoneRequest";

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
const overlayDoneSchema = z.object({ outcome: z.enum(["finished", "skipped"]) });

function seedEngine(runtime: DirectRuntime): DefaultSeedEngine {
  return {
    getEngineInfo: () => runtime.call("getEngineInfo", (api) => api.getEngineInfo()),
    listEngineModules: () => runtime.call("listEngineModules", (api) => api.listEngineModules()),
    getAvailableWidgets: () => runtime.call("getAvailableWidgets", (api) => api.getAvailableWidgets()),
    listSceneSnapshots: () => runtime.call("listSceneSnapshots", (api) => api.listSceneSnapshots()),
    listWorkflows: () => readAllWorkflows(runtime),
    createScene: (scene) => runtime.call("createScene", (api) => api.createScene(scene)),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The gateway's status from the seed's record and the ledger's settings. */
export function defaultSeedStatus(
  record: SeedRecord | null,
  ledger: readonly UISetting[],
  overlayDone: DefaultSeedStatus["overlayDone"] = null
): DefaultSeedStatus {
  return {
    neverSeeded: false,
    overlayDone,
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
  const recordRead = uiSettingsRead(runtime, UI_SETTING_NAMESPACES.defaultSeed);
  const ledgerRead = uiSettingsRead(runtime, UI_SETTING_NAMESPACES.starterPacks);
  const claimed = new Set<string>();

  const readRecord = (settings: readonly UISetting[]): SeedRecord | null => {
    const setting = settings.find((entry) => entry.key === RECORD_KEY);
    return setting === undefined ? null : parseSetting(runtime.logger, recordSchema, setting);
  };

  const readOverlayDone = (settings: readonly UISetting[]): DefaultSeedStatus["overlayDone"] => {
    const setting = settings.find((entry) => entry.key === OVERLAY_DONE_KEY);
    return setting === undefined ? null : parseSetting(runtime.logger, overlayDoneSchema, setting);
  };

  const useStatus: DefaultSeedGateway["useStatus"] = () => {
    const record = useEngineQuery(runtime, recordRead);
    const ledger = useEngineQuery(runtime, ledgerRead);
    return useMemo(() => {
      if (record === undefined || ledger === undefined) {
        return undefined;
      }
      return defaultSeedStatus(readRecord(record), ledger, readOverlayDone(record));
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
      const imagesBaseUrl = await readDefaultAlertImages(engine);
      alertImagesOmitted = imagesBaseUrl === null;
      const ledger = await runtime.call("listUISettings", (api) =>
        api.listUISettings(UI_SETTING_NAMESPACES.starterPacks)
      );
      const seeded = DEFAULT_ALERT_ITEMS.flatMap((item) => {
        const engineId = ledgerEngineId(ledger, starterItemKey(DEFAULT_ALERTS_PACK_ID, item.id));
        return engineId === undefined ? [] : [engineId];
      });
      const { pack, coveredItemIds } = defaultAlertsToInstall(
        defaultAlertsPack(imagesBaseUrl),
        await engine.listWorkflows(),
        new Set(seeded)
      );
      const outcomes = await installPackItems(runtime, pack, {}, claimed, true);
      alerts = [
        ...outcomes.map((outcome) => ({
          itemId: outcome.itemId,
          status: defaultAlertStatus(outcome.outcome),
          error: outcome.message,
        })),
        ...coveredItemIds.map((itemId): SeedRecord["alerts"][number] => ({ itemId, status: "installed" })),
      ];
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

  const markOverlayDone = async (outcome: OverlayDoneOutcome) => {
    const recorded = readOverlayDone(
      await runtime.call("listUISettings", (api) => api.listUISettings(UI_SETTING_NAMESPACES.defaultSeed))
    );
    if (recorded?.outcome === "finished" || recorded?.outcome === outcome) {
      return;
    }
    await putUISetting(runtime, UI_SETTING_NAMESPACES.defaultSeed, OVERLAY_DONE_KEY, { outcome }, MARK_MEMBER);
  };

  return {
    useStatus,
    useApplyRequest: () => useEngineRequest(apply),
    useMarkOverlayDoneRequest: () => useEngineRequest(markOverlayDone),
  };
}
