import { useEffect } from "react";
import { useEngineGateway, useEngineScope } from "@/engine/context";
import type { AlertComposition } from "@/engine/types";
import { useLogger } from "@/lib/logger-context";

export interface AlertLibrary {
  /** The library by name, undefined while loading. */
  alerts: AlertComposition[] | undefined;
}

/** Instances whose cache was caught up with the engine this page session. */
const refreshed = new Set<string>();

/**
 * The instance's alert library, from the cache the engine's webhooks keep.
 * The first use per page session also reads the engine's whole library into
 * the cache, for alerts it holds that no webhook brought (made before the
 * dashboard cached them, or while it was unreachable).
 */
export function useAlertLibrary(): AlertLibrary {
  const logger = useLogger();
  const { instanceId } = useEngineScope();
  const { alertLibrary } = useEngineGateway();
  const alerts = alertLibrary.useAlerts();
  const refresh = alertLibrary.useRefreshRequest();

  useEffect(() => {
    if (!instanceId || refreshed.has(instanceId)) {
      return;
    }
    refreshed.add(instanceId);
    refresh().catch((error: unknown) => {
      // The cache still has whatever the webhooks brought; the next editor to mount tries again.
      refreshed.delete(instanceId);
      logger.warn("[alert library] refresh failed", { error });
    });
  }, [instanceId, refresh, logger]);

  return { alerts };
}

/** One library alert by the engine's id; null until its webhook arrives or once it is deleted. */
export function useLibraryAlert(engineCompositionId: string) {
  return useEngineGateway().alertLibrary.useAlert(engineCompositionId);
}

export function useCreateLibraryAlertRequest() {
  return useEngineGateway().alertLibrary.useCreateRequest();
}

export function useRemoveLibraryAlertRequest() {
  return useEngineGateway().alertLibrary.useRemoveRequest();
}

/** A short-lived URL of the engine's composition preview page; null when the engine has none. */
export function useCompositionPreviewUrlRequest() {
  return useEngineGateway().alertLibrary.usePreviewUrlRequest();
}
