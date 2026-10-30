import { ENGINE_CAPABILITIES } from "@woofx3/api";
import type { AlertLibraryGateway } from "@/engine/gateway";
import type { AlertComposition, CompositionPreviewUrl, NewLibraryAlert } from "@/engine/types";
import { directKeys as k } from "./keys";
import { toAlertComposition } from "./map/alert-library";
import { type EngineRead, useEngineQuery, useEngineRequest } from "./query";
import type { DirectRuntime } from "./runtime";

/** Thrown for a write to an engine with no library; a read of one answers that it holds nothing. */
const NO_LIBRARY = "This engine doesn't keep an alert library. Update the engine to use one.";

function alertsRead(runtime: DirectRuntime): EngineRead<AlertComposition[]> {
  return {
    queryKey: k.alertLibrary.list(),
    queryFn: async () => {
      if (!runtime.supports(ENGINE_CAPABILITIES.compositionsAlerts)) {
        return [];
      }
      const { compositions } = await runtime.call("listAlertCompositions", (api) => api.listAlertCompositions());
      return compositions.map(toAlertComposition).sort((a, b) => a.name.localeCompare(b.name));
    },
  };
}

function alertRead(runtime: DirectRuntime, engineCompositionId: string): EngineRead<AlertComposition | null> {
  return {
    queryKey: k.alertLibrary.detail(engineCompositionId),
    queryFn: async () => {
      if (!runtime.supports(ENGINE_CAPABILITIES.compositionsAlerts)) {
        return null;
      }
      const composition = await runtime.call("getAlertComposition", (api) =>
        api.getAlertComposition(engineCompositionId)
      );
      return composition === null ? null : toAlertComposition(composition);
    },
  };
}

/**
 * The engine's library of reusable alerts, read from the engine and kept
 * current by its `scene.*` events of kind `alert`. A library alert's document
 * changes through the scene editor socket, not here.
 */
export function directAlertLibraryGateway(runtime: DirectRuntime): AlertLibraryGateway {
  const requireLibrary = () => {
    if (!runtime.supports(ENGINE_CAPABILITIES.compositionsAlerts)) {
      throw new Error(NO_LIBRARY);
    }
  };

  // Nothing is cached apart from the engine's answer, so a refresh is a
  // fresh read of the list, counted.
  const refresh = async () => {
    const alerts = await runtime.queryClient.fetchQuery({ ...alertsRead(runtime), staleTime: 0 });
    return { count: alerts.length };
  };

  const create = async (alert: NewLibraryAlert) => {
    const name = alert.name.trim();
    if (name === "") {
      throw new Error("An alert in the library needs a name.");
    }
    requireLibrary();
    const created = await runtime.call("createAlertComposition", (api) =>
      api.createAlertComposition({
        name,
        description: alert.description,
        widgetsJson: alert.widgetsJson,
        layoutJson: alert.layoutJson,
        behaviorsJson: alert.behaviorsJson,
        inputsJson: alert.inputsJson,
      })
    );
    await runtime.queryClient.invalidateQueries({ queryKey: k.alertLibrary.all });
    return { engineCompositionId: created.id };
  };

  const remove = async (engineCompositionId: string) => {
    requireLibrary();
    const { success } = await runtime.call("deleteAlertComposition", (api) =>
      api.deleteAlertComposition(engineCompositionId)
    );
    await runtime.queryClient.invalidateQueries({ queryKey: k.alertLibrary.all });
    return { success };
  };

  const previewUrl = async (): Promise<CompositionPreviewUrl | null> => {
    if (!runtime.supports(ENGINE_CAPABILITIES.compositionsPreview)) {
      return null;
    }
    const requestedAt = runtime.clock.now();
    const answer = await runtime.call("getCompositionPreviewUrl", (api) => api.getCompositionPreviewUrl());
    if (answer === null) {
      return null;
    }
    if (typeof answer.url !== "string" || !(answer.expiresInSeconds > 0)) {
      throw new Error("The engine answered the preview request with something that is not a preview URL.");
    }
    // Counted from before the request, so the page never holds it past the engine's own expiry.
    return { url: answer.url, expiresAt: requestedAt + answer.expiresInSeconds * 1000 };
  };

  return {
    useAlerts: (options) => useEngineQuery(runtime, alertsRead(runtime), { enabled: options?.enabled }),
    useAlert: (engineCompositionId) => useEngineQuery(runtime, alertRead(runtime, engineCompositionId)),
    useRefreshRequest: () => useEngineRequest(refresh),
    useCreateRequest: () => useEngineRequest(create),
    useRemoveRequest: () => useEngineRequest(remove),
    usePreviewUrlRequest: () => useEngineRequest(previewUrl),
  };
}
