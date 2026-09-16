// BrowserTransport — wraps the woofx3 SDK's capnweb WebSocket client for
// direct browser→engine communication. Authenticates via the SDK's
// createEngineBrowserSession (which handles gateway.authenticate + promise
// pipelining under the hood). Subscriptions are polling-based since the
// engine's current Api surface is point-in-time.

import type { StreamEventFrame, Woofx3EngineApi } from "@woofx3/api";
import { createEngineBrowserSession, type EngineBrowserSession, type RpcTarget } from "@woofx3/api/client";
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

export class BrowserTransport implements WoofxTransport {
  private session: EngineBrowserSession<BrowserEngineApi> | null = null;
  private connected = false;
  /** url|clientId|clientSecret of the live session, so connect() can no-op. */
  private target: string | null = null;
  private streamListeners = new Set<(frame: StreamEventFrame) => void>();
  private streamRegistered = false;

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

    if (this.session) {
      this.session.dispose();
      this.session = null;
      this.connected = false;
      this.streamRegistered = false;
    }

    if (!url || !clientId || !clientSecret) {
      // Without credentials we can't build an authenticated session. The
      // old transport allowed an unauthenticated "ping-only" mode; nothing
      // in the current UI uses that path, so drop it.
      return;
    }

    try {
      const fallback = typeof window !== "undefined" && window.location.protocol === "https:" ? "wss" : "ws";
      this.session = createEngineBrowserSession<BrowserEngineApi>(url, clientId, clientSecret, fallback);
      this.connected = true;
      console.log("[Transport] Connected to woofx3 at", url);
      this.ensureStreamSubscription();
    } catch (err) {
      this.connected = false;
      console.warn("[Transport] Failed to connect:", err);
    }
  }

  disconnect(): void {
    if (this.session) {
      this.session.dispose();
      this.session = null;
    }
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected && !!this.session;
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
    // a different delivery path (e.g. webhooks) before this can do work.
    return () => {};
  }

  /**
   * One engine subscription, fanned out locally to every listener: the frames
   * are identical for all of them, and a capnweb stub per widget would multiply
   * pushes across the socket for no gain.
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
    const api = this.session?.api;
    if (!api) {
      return () => {};
    }

    const interval = setInterval(async () => {
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
