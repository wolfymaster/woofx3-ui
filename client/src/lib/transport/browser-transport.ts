// BrowserTransport — wraps the woofx3 SDK's capnweb WebSocket client for
// direct browser→engine communication. Authenticates via the SDK's
// createEngineBrowserSession (which handles gateway.authenticate + promise
// pipelining under the hood).
//
// Stream events arrive as engine pushes over this session; workflow runs are
// still polled, since the engine exposes no subscription for them.

import { isLegacyCapabilitiesError, parseEngineCapabilities } from "@convex/lib/engineCapabilities";
import type {
  EventLogPage,
  EventLogQuery,
  EventLogSelection,
  EventLogSettings,
  StreamEventFrame,
  Woofx3EngineApi,
} from "@woofx3/api";
import { createEngineBrowserSession, type EngineBrowserSession, type RpcTarget } from "@woofx3/api/client";
import { createReconnectBackoff } from "@/lib/reconnect-backoff";
import { $documentVisible } from "@/lib/stores";
import { startVisibleInterval } from "@/lib/visible-interval";
import { $engineConnected } from "./engine-connection";
import type { ChatMessage, EngineModule, StreamStatus, WoofxTransport, Workflow, WorkflowRun } from "./interface";
import { listenerTakes, type StreamListener, streamTypesUnion } from "./stream-listeners";

/**
 * Local intersection: Woofx3EngineApi with an extra method the engine
 * exposes but hasn't made it into the shared interface yet. Retire each
 * override as the shared surface catches up.
 */
interface BrowserEngineApi extends RpcTarget, Woofx3EngineApi {
  setEngineModuleState(name: string, state: string): Promise<{ success: boolean }>;
}

const POLL_INTERVAL_RUNS = 10000;
/**
 * How long a change to the listeners' event types waits before it is
 * registered: a widget changing its types unsubscribes and resubscribes in one
 * commit, and several widgets mount together, so this keeps that to one call.
 */
const STREAM_REGISTRATION_DELAY_MS = 100;
/** `registeredStreamTypes` for a registration without types, which no union's key can equal. */
const FIXED_STREAM_SET = "*";

interface Credentials {
  url: string;
  clientId: string;
  clientSecret: string;
}

export class BrowserTransport implements WoofxTransport {
  private session: EngineBrowserSession<BrowserEngineApi> | null = null;
  /** url|clientId|clientSecret of the live session, so connect() can no-op. */
  private target: string | null = null;
  /** Held so a reconnect can re-authenticate without another connect() call. */
  private credentials: Credentials | null = null;
  private streamListeners = new Set<StreamListener>();
  /**
   * The event types registered with the engine on the live session, joined
   * with commas; null while nothing is registered. Compared against the
   * listeners' union to skip a registration that would change nothing.
   */
  private registeredStreamTypes: string | null = null;
  /**
   * Whether the live session's engine pushes per-subscriber types (capability
   * `events.log`); null until it has answered. An engine without them adds a
   * subscription on every call instead of replacing one, so it is registered
   * once, without types.
   */
  private streamTypesSupported: boolean | null = null;
  private streamRegistrationTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private backoff = createReconnectBackoff();
  /**
   * Bumped by every connect() and disconnect(). A broken-session callback or a
   * pending retry carries the generation it was created under and does nothing
   * if that no longer matches — dispose() can itself break the session, and a
   * timer must not resurrect a target the caller has already moved off.
   */
  private generation = 0;

  connect(url: string, clientId?: string, clientSecret?: string): void {
    // Idempotent for an unchanged target. `useSyncEngineTransport` re-runs
    // whenever the Convex instance row's object identity changes, which is any
    // update at all -- rebuilding the socket each time would drop every
    // registered stream subscription with it.
    const target = `${url}|${clientId ?? ""}|${clientSecret ?? ""}`;
    if (this.session && this.target === target) {
      return;
    }

    this.target = target;
    this.teardown();
    this.generation += 1;

    if (!url || !clientId || !clientSecret) {
      // Without credentials we can't build an authenticated session. The
      // old transport allowed an unauthenticated "ping-only" mode; nothing
      // in the current UI uses that path, so drop it.
      this.credentials = null;
      return;
    }

    this.credentials = { url, clientId, clientSecret };
    this.backoff.reset();
    this.openSession(this.generation);
  }

  disconnect(): void {
    this.generation += 1;
    this.teardown();
    // Cleared last: its absence is what stops a reconnect being scheduled.
    this.credentials = null;
    this.target = null;
  }

  isConnected(): boolean {
    return $engineConnected.get() && !!this.session;
  }

  reconnectNow(): void {
    // A session that exists is either working or about to report itself
    // broken; replacing it would drop its stream subscription for nothing.
    if (!this.credentials || this.session) {
      return;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.backoff.reset();
    this.openSession(this.generation);
  }

  /** Drop the live session and any pending retry, without touching credentials. */
  private teardown(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.session) {
      this.session.dispose();
      this.session = null;
    }
    $engineConnected.set(false);
    this.registeredStreamTypes = null;
    this.streamTypesSupported = null;
  }

  private openSession(generation: number): void {
    const credentials = this.credentials;
    if (!credentials || generation !== this.generation) {
      return;
    }

    try {
      const fallback = typeof window !== "undefined" && window.location.protocol === "https:" ? "wss" : "ws";
      const session = createEngineBrowserSession<BrowserEngineApi>(
        credentials.url,
        credentials.clientId,
        credentials.clientSecret,
        fallback
      );
      this.session = session;

      session.onBroken(() => {
        if (generation !== this.generation || this.session !== session) {
          return;
        }
        console.warn("[Transport] Engine session broken; reconnecting");
        this.session = null;
        $engineConnected.set(false);
        this.registeredStreamTypes = null;
        this.streamTypesSupported = null;
        this.scheduleReconnect(generation);
      });

      // Connected and the backoff reset both wait for a proven round trip, not
      // construction: createEngineBrowserSession does not await authenticate,
      // so a socket that is about to fail, or credentials the engine rejects,
      // still build cleanly. ping is pipelined through the authenticated stub,
      // so its success proves both the socket and the credentials. Resetting
      // the backoff earlier would turn a dead engine into a one-second retry
      // loop; reporting connected earlier would show a green status for it.
      void session.api
        .ping()
        .then(() => {
          if (generation === this.generation && this.session === session) {
            this.backoff.reset();
            $engineConnected.set(true);
          }
        })
        .catch(() => {
          // A failure here means the session is unusable; onBroken drives the
          // retry, so there is nothing to do but leave the backoff advancing.
        });

      this.detectStreamTypes(session);
    } catch (err) {
      $engineConnected.set(false);
      this.session = null;
      console.warn("[Transport] Failed to connect:", err);
      this.scheduleReconnect(generation);
    }
  }

  private scheduleReconnect(generation: number): void {
    if (this.reconnectTimer || !this.credentials || generation !== this.generation) {
      return;
    }
    const delay = this.backoff.next();
    console.warn(`[Transport] Reconnecting in ${delay}ms (attempt ${this.backoff.attempts})`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.openSession(generation);
    }, delay);
  }

  private getApi(): BrowserEngineApi {
    if (!this.session) {
      throw new Error("Not connected to woofx3 instance");
    }
    return this.session.api;
  }

  async getStreamStatus(_instanceId: string): Promise<StreamStatus> {
    try {
      const result = await this.getApi().getStreamStatus();
      return result as StreamStatus;
    } catch {
      return { isLive: false, uptime: "00:00:00", viewerCount: 0 };
    }
  }

  subscribeChatMessages(_instanceId: string, _callback: (msg: ChatMessage) => void): () => void {
    // Engine no longer exposes getChatMessages / sendChatMessage. Keep the
    // transport method so dashboard widgets compile; inbound chat will need
    // a different delivery path before this can do work.
    return () => {};
  }

  /**
   * One engine subscription, fanned out locally: a capnweb stub per widget
   * would multiply pushes across the socket for no gain. The engine pushes
   * exactly the types it was last asked for, and asking again replaces that,
   * so the subscription carries the union of every listener's types and is
   * registered again whenever the union changes, and after a reconnect. Each
   * listener gets only frames of its own types.
   */
  subscribeStreamEvents(
    _instanceId: string,
    types: readonly string[] | null,
    callback: (frame: StreamEventFrame) => void
  ): () => void {
    const listener: StreamListener = { types: types ? new Set(types) : null, callback };
    this.streamListeners.add(listener);
    this.scheduleStreamRegistration();
    return () => {
      this.streamListeners.delete(listener);
      this.scheduleStreamRegistration();
    };
  }

  /** Asks the session's engine whether it takes per-subscriber types, then registers the listeners. */
  private detectStreamTypes(session: EngineBrowserSession<BrowserEngineApi>): void {
    session.api
      .getEngineCapabilities()
      .then((raw) => parseEngineCapabilities(raw).capabilities.includes("events.log"))
      .catch((err: unknown) => {
        // Unreadable is read as unsupported: the push then carries the
        // engine's fixed set, which is less than asked for but never doubled.
        if (!isLegacyCapabilitiesError(err)) {
          console.warn("[Transport] Could not read the engine's capabilities:", err);
        }
        return false;
      })
      .then((supported) => {
        if (this.session !== session) {
          return;
        }
        this.streamTypesSupported = supported;
        this.registerStreamTypes();
      });
  }

  private scheduleStreamRegistration(): void {
    if (this.streamRegistrationTimer) {
      return;
    }
    this.streamRegistrationTimer = setTimeout(() => {
      this.streamRegistrationTimer = null;
      this.registerStreamTypes();
    }, STREAM_REGISTRATION_DELAY_MS);
  }

  /**
   * Registers the listeners' union with the engine when it differs from what
   * the session has. An empty union is registered too once anything was, so
   * the engine stops pushing types nobody listens to; with nothing registered
   * yet and nothing wanted, there is nothing to ask for.
   *
   * An engine without per-subscriber types is registered once, without them,
   * and pushes its fixed set; each listener still takes only its own types.
   */
  private registerStreamTypes(): void {
    const session = this.session;
    const supported = this.streamTypesSupported;
    if (!session || supported === null) {
      return;
    }
    const listeners = Array.from(this.streamListeners);
    if (this.registeredStreamTypes === null && listeners.length === 0) {
      return;
    }
    const types = supported ? streamTypesUnion(listeners) : undefined;
    const key = types ? types.join(",") : FIXED_STREAM_SET;
    if (key === this.registeredStreamTypes || (!supported && this.registeredStreamTypes !== null)) {
      return;
    }
    this.registeredStreamTypes = key;
    const subscriber = {
      onStreamEvent: async (frame: StreamEventFrame) => {
        this.streamListeners.forEach((listener) => {
          if (listenerTakes(listener, frame.type)) {
            listener.callback(frame);
          }
        });
      },
    };
    (types
      ? session.api.subscribeStreamEvents(subscriber, types)
      : session.api.subscribeStreamEvents(subscriber)
    ).catch((err: unknown) => {
      // Only the latest registration counts; a later one that already
      // replaced this one is left alone.
      if (this.session === session && this.registeredStreamTypes === key) {
        this.registeredStreamTypes = null;
      }
      console.warn("[Transport] Failed to subscribe to stream events:", err);
    });
  }

  async listEvents(_instanceId: string, query?: EventLogQuery): Promise<EventLogPage> {
    return this.getApi().listEvents(query);
  }

  async getEventLogSettings(_instanceId: string): Promise<EventLogSettings> {
    return this.getApi().getEventLogSettings();
  }

  async setEventLogSelection(_instanceId: string, selection: EventLogSelection): Promise<EventLogSettings> {
    return this.getApi().setEventLogSelection(selection);
  }

  /** Polled only while the tab is visible; returning to the tab polls at once. */
  subscribeWorkflowRuns(_instanceId: string, callback: (run: WorkflowRun) => void): () => void {
    const poll = async () => {
      // Read through the live session each tick rather than capturing `api`:
      // a reconnect replaces the session, and a captured stub would keep
      // polling a dead one.
      const api = this.session?.api;
      if (!api) {
        return;
      }
      try {
        const runs = await api.getWorkflowRuns();
        for (const r of runs) {
          callback(r as unknown as WorkflowRun);
        }
      } catch {
        // Silently ignore
      }
    };

    return startVisibleInterval(
      () => {
        void poll();
      },
      POLL_INTERVAL_RUNS,
      $documentVisible
    );
  }

  async getWorkflows(_instanceId: string): Promise<Workflow[]> {
    const result = await this.getApi().getWorkflows();
    return (result?.workflows ?? []) as unknown as Workflow[];
  }

  /**
   * Asks the engine to run a workflow and returns the correlation id for that
   * request, not an execution id: the engine mints an execution id only when
   * the run actually begins, after this call has returned. The run's outcome is
   * reported against the id returned here.
   */
  async executeWorkflow(_instanceId: string, workflowId: string): Promise<string> {
    const result = await this.getApi().triggerWorkflowByName(workflowId, {}, "user", undefined, "dashboard");
    return result.triggerId;
  }

  async getModuleState(_instanceId: string, moduleId: string): Promise<unknown> {
    return this.getApi().getModule(moduleId);
  }

  async listEngineModules(_instanceId: string): Promise<EngineModule[]> {
    const result = await this.getApi().listEngineModules();
    return result as EngineModule[];
  }

  async uninstallEngineModule(_instanceId: string, name: string): Promise<void> {
    await this.getApi().uninstallEngineModule(name);
  }

  async setEngineModuleState(_instanceId: string, name: string, state: string): Promise<void> {
    await this.getApi().setEngineModuleState(name, state);
  }
}
