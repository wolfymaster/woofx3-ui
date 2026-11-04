import { useStore } from "@nanostores/react";
import { atom } from "nanostores";
import { useCallback, useEffect, useState } from "react";
import { useEngineGateway, useEngineScope } from "@/engine/context";
import type { EventLogSettings } from "@/engine/types";
import { withEventTypeEnabled } from "@/lib/activity-feed";
import { useLogger } from "@/lib/logger-context";

/** `error`: the settings could not be read; asked again on reconnect. */
export type EventLogSettingsState =
  | { status: "loading" }
  | { status: "ready"; settings: EventLogSettings }
  | { status: "error"; message: string };

/**
 * The settings by instance, shared by every Events widget on the page: the
 * selection is one per engine, so a change made in one widget shows in all.
 */
const $settingsByInstance = atom<Readonly<Record<string, EventLogSettings>>>({});

function storeSettings(instanceId: string, settings: EventLogSettings): void {
  $settingsByInstance.set({ ...$settingsByInstance.get(), [instanceId]: settings });
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export interface EventLogSettingsHandle {
  state: EventLogSettingsState;
  /** True while a change is being saved; one change at a time, since each builds on the last. */
  saving: boolean;
  /** Read the settings again, e.g. when the filter opens, to pick up newly installed modules. */
  refresh: () => void;
  /** Turn one event type on or off for the engine. Rejects when the engine refuses. */
  setEnabled: (type: string, enabled: boolean) => Promise<void>;
}

/**
 * The engine's event-type selection (see `EventLogSettings`): which types it
 * logs and pushes, its defaults and what it offers. Read on mount, on every
 * reconnect and on `refresh`.
 */
export function useEventLogSettings(): EventLogSettingsHandle {
  const logger = useLogger();
  const { instanceId } = useEngineScope();
  const { eventLog } = useEngineGateway();
  const getEventLogSettings = eventLog.useSettingsRequest();
  const setEventLogSelection = eventLog.useSetSelectionRequest();
  const connected = useEngineGateway().session.useConnected();
  const settingsByInstance = useStore($settingsByInstance);
  const settings = instanceId ? settingsByInstance[instanceId] : undefined;
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [readCount, setReadCount] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: readCount asks again on refresh
  useEffect(() => {
    if (!instanceId || !connected) {
      return;
    }
    let cancelled = false;
    getEventLogSettings()
      .then((next) => {
        if (!cancelled) {
          storeSettings(instanceId, next);
          setError(null);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          logger.warn("[Events] Could not read the engine's event selection", { error: err });
          setError(errorMessage(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [instanceId, connected, readCount, getEventLogSettings]);

  const refresh = useCallback(() => {
    setReadCount((count) => count + 1);
  }, []);

  const setEnabled = useCallback(
    async (type: string, enabled: boolean) => {
      if (!instanceId || !settings) {
        throw new Error("The engine's event selection has not been read yet");
      }
      setSaving(true);
      try {
        const selection = withEventTypeEnabled(settings.selection, settings.defaults, type, enabled);
        storeSettings(instanceId, await setEventLogSelection(selection));
      } finally {
        setSaving(false);
      }
    },
    [instanceId, settings, setEventLogSelection]
  );

  return { state: settingsState(settings, error), saving, refresh, setEnabled };
}

function settingsState(settings: EventLogSettings | undefined, error: string | null): EventLogSettingsState {
  if (settings) {
    return { status: "ready", settings };
  }
  if (error) {
    return { status: "error", message: error };
  }
  return { status: "loading" };
}
