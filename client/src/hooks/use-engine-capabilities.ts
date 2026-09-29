import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { EngineCapability, EngineCapabilityReport } from "@convex/lib/engineCapabilities";
import { useAction } from "convex/react";
import { ConvexError } from "convex/values";
import { useCallback, useEffect, useSyncExternalStore } from "react";
import {
  type CapabilitySupport,
  capabilitySupport,
  createReconnectDetector,
  type EngineCapabilitiesState,
} from "@/lib/engine-capabilities";
import { $engineConnected } from "@/lib/transport/engine-connection";

const LOADING: EngineCapabilitiesState = { status: "loading" };

// One answer per instance for the whole page session, shared by every
// component that asks. An engine's features change only when it is updated,
// which restarts it and drops the live session, so a reconnect clears the
// cache and the mounted hooks ask again.
const entries = new Map<string, EngineCapabilitiesState>();
const inFlight = new Set<string>();
/** Bumped by a reconnect, so an answer asked for before it is not cached after it. */
let generation = 0;
const listeners = new Set<() => void>();

function notify(): void {
  listeners.forEach((listener) => {
    listener();
  });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const isReconnect = createReconnectDetector();
$engineConnected.subscribe((connected) => {
  if (isReconnect(connected)) {
    generation += 1;
    entries.clear();
    inFlight.clear();
    notify();
  }
});

function requestErrorMessage(err: unknown): string {
  if (err instanceof ConvexError && typeof err.data === "string") {
    return err.data;
  }
  return err instanceof Error ? err.message : String(err);
}

function load(instanceId: string, fetchReport: () => Promise<EngineCapabilityReport>): void {
  if (inFlight.has(instanceId)) {
    return;
  }
  inFlight.add(instanceId);
  const startedIn = generation;
  const settle = (state: EngineCapabilitiesState) => {
    if (startedIn !== generation) {
      return;
    }
    inFlight.delete(instanceId);
    entries.set(instanceId, state);
    notify();
  };
  fetchReport().then(
    (report) => settle({ status: "ready", report }),
    (err: unknown) => settle({ status: "error", message: requestErrorMessage(err) })
  );
}

export interface EngineCapabilities {
  state: EngineCapabilitiesState;
  /** Support for a feature needing every id in `required`. */
  support: (...required: EngineCapability[]) => CapabilitySupport;
  /** Ask the engine again, e.g. after an error. */
  refresh: () => void;
}

/**
 * The features the instance's engine supports, cached for the page session and
 * asked again when the engine reconnects. See lib/engine-capabilities.ts for
 * turning the answer into a gate.
 */
export function useEngineCapabilities(instanceId: Id<"instances"> | undefined): EngineCapabilities {
  const getCapabilities = useAction(api.engineCapabilities.get);
  const key = instanceId ?? "";
  const state = useSyncExternalStore(subscribe, () => (key ? (entries.get(key) ?? LOADING) : LOADING));
  const cached = key !== "" && entries.has(key);

  const fetchReport = useCallback(() => {
    if (!instanceId) {
      throw new Error("useEngineCapabilities: fetch without an instance");
    }
    return getCapabilities({ instanceId });
  }, [instanceId, getCapabilities]);

  useEffect(() => {
    if (instanceId && !cached) {
      load(instanceId, fetchReport);
    }
  }, [instanceId, cached, fetchReport]);

  const refresh = useCallback(() => {
    if (instanceId) {
      entries.delete(instanceId);
      notify();
    }
  }, [instanceId]);

  const support = useCallback((...required: EngineCapability[]) => capabilitySupport(state, required), [state]);

  return { state, support, refresh };
}
