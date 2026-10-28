import { type AlertStepSource, alertTargetUses, alertWidgetNamesAcross } from "@shared/alert-widgets";
import { BUILTIN_MODULE_LABEL } from "@shared/module-labels";
import { ENGINE_CAPABILITIES } from "@woofx3/api";
import { GatewayUnsupportedError } from "@/engine/errors";
import type { ScenesGateway } from "@/engine/gateway";
import type { AlertTargetUsage, NewScene, SceneChanges, SceneRecord, SceneWidgetCatalogRow } from "@/engine/types";
import { commandsRead } from "./commands";
import { directKeys as k } from "./keys";
import { toSceneRecord, toSceneWidgetCatalogRow } from "./map/scenes";
import { type EngineRead, useEngineQuery, useEngineRequest } from "./query";
import type { DirectRuntime } from "./runtime";
import { readAllWorkflows } from "./workflow-pages";

/**
 * Throws for an engine that cannot hand over whole scenes: its scene list
 * leaves out what the screens draw, so there is nothing true to show.
 */
function requireSnapshots(runtime: DirectRuntime, member: string): void {
  if (!runtime.supports(ENGINE_CAPABILITIES.scenesSnapshots)) {
    throw new GatewayUnsupportedError(member);
  }
}

function scenesRead(runtime: DirectRuntime): EngineRead<SceneRecord[]> {
  return {
    queryKey: k.scenes.list(),
    queryFn: async () => {
      requireSnapshots(runtime, "scenes.useScenes");
      const { scenes } = await runtime.call("listSceneSnapshots", (api) => api.listSceneSnapshots());
      return scenes.map(toSceneRecord);
    },
  };
}

function sceneRead(runtime: DirectRuntime, engineSceneId: string): EngineRead<SceneRecord | null> {
  return {
    queryKey: k.scenes.detail(engineSceneId),
    queryFn: async () => {
      requireSnapshots(runtime, "scenes.useScene");
      const snapshot = await runtime.call("getSceneSnapshot", (api) => api.getSceneSnapshot(engineSceneId));
      return snapshot === null ? null : toSceneRecord(snapshot);
    },
  };
}

function widgetCatalogRead(runtime: DirectRuntime): EngineRead<SceneWidgetCatalogRow[]> {
  return {
    queryKey: k.scenes.widgetCatalog(),
    queryFn: async () => {
      const [{ widgets }, modules] = await Promise.all([
        runtime.call("getAvailableWidgets", (api) => api.getAvailableWidgets()),
        runtime.call("listEngineModules", (api) => api.listEngineModules()),
      ]);
      const moduleNames = new Map(modules.map((module) => [module.moduleId, module.name]));
      return widgets.map((widget) => toSceneWidgetCatalogRow(widget, moduleNames, BUILTIN_MODULE_LABEL));
    },
  };
}

/** The canonical ids of the installed widgets that host alerts, read through the catalog's cache entry. */
async function alertWidgetIds(runtime: DirectRuntime): Promise<Set<string>> {
  const catalog = await runtime.queryClient.fetchQuery(widgetCatalogRead(runtime));
  return new Set(catalog.filter((row) => row.hostsSurface === "alert").map((row) => row.widgetId));
}

function alertWidgetNamesRead(runtime: DirectRuntime): EngineRead<string[]> {
  return {
    queryKey: k.scenes.alertWidgetNames(),
    queryFn: async () => {
      const [scenes, ids] = await Promise.all([
        runtime.queryClient.fetchQuery(scenesRead(runtime)),
        alertWidgetIds(runtime),
      ]);
      return alertWidgetNamesAcross(
        scenes.map((scene) => scene.widgets),
        ids
      );
    },
  };
}

function alertTargetUsageRead(runtime: DirectRuntime, engineSceneId: string): EngineRead<AlertTargetUsage> {
  return {
    queryKey: k.scenes.alertTargetUsage(engineSceneId),
    queryFn: async () => {
      const [scenes, ids, commands, workflows] = await Promise.all([
        runtime.queryClient.fetchQuery(scenesRead(runtime)),
        alertWidgetIds(runtime),
        runtime.queryClient.fetchQuery(commandsRead(runtime)),
        readAllWorkflows(runtime),
      ]);
      const elsewhere = alertWidgetNamesAcross(
        scenes.filter((scene) => scene.engineSceneId !== engineSceneId).map((scene) => scene.widgets),
        ids
      );
      const sources: AlertStepSource[] = [
        ...workflows.map(
          (workflow): AlertStepSource => ({
            kind: "workflow",
            name: workflow.definition?.name || workflow.id,
            steps: workflow.definition?.tasks ?? [],
          })
        ),
        ...commands.map(
          (command): AlertStepSource => ({
            kind: "command",
            name: `!${command.command}`,
            steps: command.actions,
          })
        ),
      ];
      return { alertWidgetIds: Array.from(ids), elsewhere, uses: alertTargetUses(sources) };
    },
  };
}

/**
 * Overlay scenes and the widgets they place, read from the engine and kept
 * current by its `scene.*` events of kind `scene` and its widget events. The
 * alert widget names and target usage are worked out from those same reads,
 * the commands and the workflows, as the Convex gateway works them out from
 * its cache. A write resolves once the engine has answered and the scenes
 * are marked stale.
 */
export function directScenesGateway(runtime: DirectRuntime): ScenesGateway {
  const invalidateScenes = () => runtime.queryClient.invalidateQueries({ queryKey: k.scenes.all });

  const create = async (scene: NewScene) => {
    const created = await runtime.call("createScene", (api) =>
      api.createScene({
        name: scene.name,
        description: scene.description,
        widgetsJson: scene.widgetsJson ?? "[]",
        layoutJson: scene.layoutJson ?? "{}",
      })
    );
    await invalidateScenes();
    return { engineSceneId: created.id };
  };

  const update = async (engineSceneId: string, changes: SceneChanges) => {
    const { success } = await runtime.call("updateScene", (api) =>
      api.updateScene(engineSceneId, {
        name: changes.name,
        description: changes.description,
        widgetsJson: changes.widgetsJson,
        layoutJson: changes.layoutJson,
      })
    );
    await invalidateScenes();
    return { success };
  };

  const remove = async (engineSceneId: string) => {
    const { success } = await runtime.call("deleteScene", (api) => api.deleteScene(engineSceneId));
    await invalidateScenes();
    return { success };
  };

  const widgetThemes = (widgetCanonicalId: string) =>
    runtime.call("listWidgetThemes", (api) => api.listWidgetThemes(widgetCanonicalId));

  const editorSession = (engineSceneId: string) =>
    runtime.call("getSceneEditorSession", (api) => api.getSceneEditorSession(engineSceneId));

  const repair = (engineSceneId: string) => runtime.call("repairScene", (api) => api.repairScene(engineSceneId));

  return {
    useScenes: (options) => useEngineQuery(runtime, scenesRead(runtime), { enabled: options?.enabled }),
    useScene: (engineSceneId) => useEngineQuery(runtime, sceneRead(runtime, engineSceneId)),
    useWidgetCatalog: (options) => useEngineQuery(runtime, widgetCatalogRead(runtime), { enabled: options?.enabled }),
    useAlertWidgetNames: (options) =>
      useEngineQuery(runtime, alertWidgetNamesRead(runtime), { enabled: options?.enabled }),
    useAlertTargetUsage: (engineSceneId) => useEngineQuery(runtime, alertTargetUsageRead(runtime, engineSceneId)),
    useCreateRequest: () => useEngineRequest(create),
    useUpdateRequest: () => useEngineRequest(update),
    useRemoveRequest: () => useEngineRequest(remove),
    useWidgetThemesRequest: () => useEngineRequest(widgetThemes),
    useEditorSessionRequest: () => useEngineRequest(editorSession),
    useRepairRequest: () => useEngineRequest(repair),
  };
}
