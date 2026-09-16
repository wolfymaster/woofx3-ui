// BrowserTransport — wraps the woofx3 SDK's capnweb WebSocket client for
// direct browser→engine communication. Authenticates via the SDK's
// createEngineBrowserSession (which handles gateway.authenticate + promise
// pipelining under the hood).
//
// Stream events arrive as engine pushes over this session; workflow runs are
// still polled, since the engine exposes no subscription for them.

import type { StreamEventFrame, Woofx3EngineApi } from "@woofx3/api";
import { createEngineBrowserSession, type EngineBrowserSession, type RpcTarget } from "@woofx3/api/client";
import { createReconnectBackoff } from "@/lib/reconnect-backoff";
import type { ChatMessage, EngineModule, StreamStatus, WoofxTransport, Workflow, WorkflowRun } from "./interface";

/**
 * Local intersection: Woofx3EngineApi with an extra method the engine
 * exposes but hasn't made it into the shared interface yet. Retire each
 * override as the shared surface catches up.
 */
interface BrowserEngineApi extends RpcTarget, Woofx3EngineApi {
  setEngineModuleState(name: string, state: string): Promise<{ success: boolean }>;
}

const POLL_INTERVAL_RUNS = 10000;

interface Credentials {
  url: string;
  clientId: string;
  clientSecret: string;
}

export class BrowserTransport implements WoofxTransport {
  private session: EngineBrowserSession<BrowserEngineApi> | null = null;
  private connected = false;
  /** url|clientId|clientSecret of the live session, so connect() can no-op. */
  private target: string | null = null;
  /** Held so a reconnect can re-authenticate without another connect() call. */
  private credentials: Credentials | null = null;
  private streamListeners = new Set<(frame: StreamEventFrame) => void>();
  private streamRegistered = false;
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
    return this.connected && !!this.session;
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
    this.connected = false;
    this.streamRegistered = false;
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
      this.connected = true;

      session.onBroken(() => {
        if (generation !== this.generation || this.session !== session) {
          return;
        }
        console.warn("[Transport] Engine session broken; reconnecting");
        this.session = null;
        this.connected = false;
        this.streamRegistered = false;
        this.scheduleReconnect(generation);
      });

      // The backoff resets on a proven round trip, not on construction:
      // createEngineBrowserSession does not await authenticate, so a socket
      // that is about to fail still builds cleanly. Resetting there would turn
      // a dead engine into a one-second retry loop. ping costs nothing and
      // works whether or not anything is subscribed.
      void session.api
        .ping()
        .then(() => {
          if (generation === this.generation && this.session === session) {
            this.backoff.reset();
          }
        })
        .catch(() => {
          // A failure here means the session is unusable; onBroken drives the
          // retry, so there is nothing to do but leave the backoff advancing.
        });

      this.ensureStreamSubscription();
    } catch (err) {
      this.connected = false;
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
   * One engine subscription, fanned out locally to every listener: the frames
   * are identical for all of them, and a capnweb stub per widget would multiply
   * pushes across the socket for no gain.
   *
   * The returned unsubscribe only drops the local listener. The engine-side
   * registration lives as long as the session, and is re-established after a
   * reconnect by openSession.
   */
  subscribeStreamEvents(_instanceId: string, callback: (frame: StreamEventFrame) => void): () => void {
    this.streamListeners.add(callback);
    this.ensureStreamSubscription();
    return () => {
      this.streamListeners.delete(callback);
    };
  }

  private ensureStreamSubscription(): void {
    if (this.streamRegistered || !this.session || this.streamListeners.size === 0) {
      return;
    }
    this.streamRegistered = true;
    this.session.api
      .subscribeStreamEvents({
        // forEach rather than for...of: this project's tsc target predates
        // downlevel Set iteration, so the loop form does not compile.
        onStreamEvent: async (frame: StreamEventFrame) => {
          this.streamListeners.forEach((listener) => {
            listener(frame);
          });
        },
      })
      .catch((err: unknown) => {
        this.streamRegistered = false;
        console.warn("[Transport] Failed to subscribe to stream events:", err);
      });
  }

  subscribeWorkflowRuns(_instanceId: string, callback: (run: WorkflowRun) => void): () => void {
    const interval = setInterval(async () => {
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
    }, POLL_INTERVAL_RUNS);

    return () => clearInterval(interval);
  }

  async getWorkflows(_instanceId: string): Promise<Workflow[]> {
    const result = await this.getApi().getWorkflows();
    return (result?.workflows ?? []) as unknown as Workflow[];
  }

  async executeWorkflow(_instanceId: string, workflowId: string): Promise<string> {
    const result = await this.getApi().triggerWorkflowByName(workflowId, {}, "user");
    return result.executionId || workflowId;
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
