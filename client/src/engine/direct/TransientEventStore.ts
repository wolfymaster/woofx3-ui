import { type CallbackEnvelope, type CallbackEventByType, EngineEventType } from "@woofx3/api";
import type { TransientEvent } from "@/engine/types";
import type { Clock } from "@/lib/engine-session/deps";

type TransientDraft = Omit<TransientEvent, "expiresAt">;

type Projection<T extends EngineEventType> = (event: CallbackEventByType[T]) => TransientDraft | null;

type RunLifecycleType =
  | typeof EngineEventType.WORKFLOW_RUN_STARTED
  | typeof EngineEventType.WORKFLOW_RUN_COMPLETED
  | typeof EngineEventType.WORKFLOW_RUN_FAILED
  | typeof EngineEventType.WORKFLOW_RUN_CANCELLED;

/**
 * A run somebody is waiting on, keyed by the `triggerId` its request carried
 * so the caller can follow it before the run exists. A run nobody asked for
 * has no key and nothing to record.
 */
function runLifecycle<T extends RunLifecycleType>(
  status: TransientEvent["status"],
  messageOf: (event: CallbackEventByType[T]) => string | undefined
): Projection<T> {
  return (event) =>
    event.triggerId
      ? {
          correlationKey: event.triggerId,
          type: event.type,
          status,
          message: messageOf(event),
          data: {
            workflowId: event.workflowId,
            executionId: event.executionId,
            triggeredBy: event.triggeredBy,
            occurredAt: event.occurredAt,
          },
        }
      : null;
}

/**
 * The transient events each engine event leaves, matching what the Convex
 * gateway's webhook writes for it (convex/http.ts, convex/moduleWebhook.ts),
 * so a screen reads the same keys, types and messages under either gateway.
 * An event type with no row leaves none.
 */
const PROJECTIONS: { readonly [T in EngineEventType]?: Projection<T> } = {
  [EngineEventType.ENGINE_RESPONSE_RECEIVED]: (event) => ({
    correlationKey: event.correlationKey,
    type: "engine.response",
    status: event.status,
    message: event.error,
    data: event.data,
  }),
  [EngineEventType.WORKFLOW_RUN_STARTED]: runLifecycle("progress", () => undefined),
  [EngineEventType.WORKFLOW_RUN_COMPLETED]: runLifecycle("success", () => undefined),
  [EngineEventType.WORKFLOW_RUN_FAILED]: runLifecycle("error", (event) => event.error),
  [EngineEventType.WORKFLOW_RUN_CANCELLED]: runLifecycle("error", (event) => event.reason),
  [EngineEventType.MODULE_INSTALLED]: (event) => ({
    correlationKey: event.moduleKey,
    type: "module.install",
    status: "success",
    message: `Module ${event.moduleName}@${event.version} installed successfully.`,
  }),
  [EngineEventType.MODULE_INSTALL_FAILED]: (event) => ({
    correlationKey: event.moduleKey,
    type: "module.install",
    status: "error",
    message: event.error || "Module installation failed on the engine.",
    data: { moduleName: event.moduleName, moduleVersion: event.version },
  }),
  [EngineEventType.MODULE_DELETED]: (event) => ({
    correlationKey: event.moduleKey,
    type: "module.uninstall",
    status: "success",
    message: `Module ${event.moduleName} removed.`,
    data: { moduleName: event.moduleName },
  }),
  [EngineEventType.MODULE_DELETE_FAILED]: (event) => ({
    correlationKey: event.moduleKey,
    type: "module.uninstall",
    status: "error",
    message: event.error || "Module delete was refused by the engine.",
    data: { moduleName: event.moduleName, conflicts: event.inUseResources ?? [] },
  }),
  [EngineEventType.MODULE_STORAGE_CHANGED]: (event) => ({
    correlationKey: `${event.moduleId}:${event.key}`,
    type: "module.storage.changed",
    status: "success",
    data: {
      moduleId: event.moduleId,
      key: event.key,
      value: event.value,
      previousValue: event.previousValue,
      occurredAt: event.occurredAt,
    },
  }),
  [EngineEventType.WIDGET_STATUS_CHANGED]: (event) => ({
    correlationKey: event.widgetCanonicalId ?? `${event.moduleId}:${event.instanceId}:${event.key}`,
    type: "widget.status.changed",
    status: "success",
    data: {
      moduleId: event.moduleId,
      widgetInstanceId: event.instanceId,
      widgetCanonicalId: event.widgetCanonicalId,
      key: event.key,
      value: event.value,
      occurredAt: event.occurredAt,
    },
  }),
};

/** The transient event an engine event leaves, or null when it leaves none. */
export function transientOf(envelope: CallbackEnvelope): TransientDraft | null {
  const project = PROJECTIONS[envelope.type] as Projection<EngineEventType> | undefined;
  return project ? project(envelope.data as CallbackEventByType[EngineEventType]) : null;
}

export interface TransientEventStoreConfig {
  ttlMs: number;
  perKey: number;
}

const NONE: readonly TransientEvent[] = [];

/**
 * The transient events the engine stream left, by correlation key, oldest
 * first. Each expires `ttlMs` after it arrived. Expired entries are dropped
 * when their key is next read or written rather than on a timer, so the store
 * owns no timers; a read never returns one.
 *
 * A key's list is replaced, never mutated, so a snapshot read twice without
 * a change between is the same array (`useSyncExternalStore` requires it).
 */
export class TransientEventStore {
  private readonly byKey = new Map<string, readonly TransientEvent[]>();
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly clock: Clock,
    private readonly config: TransientEventStoreConfig
  ) {}

  /** Records the transient `envelope` leaves, if any. */
  ingest(envelope: CallbackEnvelope): void {
    const draft = transientOf(envelope);
    if (draft === null) {
      return;
    }
    const event: TransientEvent = { ...draft, expiresAt: this.clock.now() + this.config.ttlMs };
    const kept = [...this.events(draft.correlationKey), event].slice(-this.config.perKey);
    this.byKey.set(draft.correlationKey, kept);
    this.notify();
  }

  /** The newest live event under `correlationKey`, or null when there is none. */
  latest(correlationKey: string): TransientEvent | null {
    return this.events(correlationKey).at(-1) ?? null;
  }

  /** Every live event under `correlationKey`, oldest first. */
  events(correlationKey: string): readonly TransientEvent[] {
    const stored = this.byKey.get(correlationKey);
    if (stored === undefined) {
      return NONE;
    }
    const now = this.clock.now();
    if (stored.every((event) => event.expiresAt > now)) {
      return stored;
    }
    const live = stored.filter((event) => event.expiresAt > now);
    if (live.length === 0) {
      this.byKey.delete(correlationKey);
      return NONE;
    }
    this.byKey.set(correlationKey, live);
    return live;
  }

  /** Drops every event: what was recorded belonged to an engine the gateway no longer talks to. */
  clear(): void {
    this.byKey.clear();
    this.notify();
  }

  /** Calls `listener` whenever any key's events may have changed; returns the unsubscribe. */
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}
