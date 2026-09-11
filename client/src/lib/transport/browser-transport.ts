// BrowserTransport — wraps the woofx3 SDK's capnweb WebSocket client for
// direct browser→engine communication. Authenticates via the SDK's
// createEngineBrowserSession (which handles gateway.authenticate + promise
// pipelining under the hood). Subscriptions are polling-based since the
// engine's current Api surface is point-in-time.

import type { Woofx3EngineApi } from "@woofx3/api";
import { createEngineBrowserSession, type EngineBrowserSession, type RpcTarget } from "@woofx3/api/client";
import type {
  ChatMessage,
  EngineModule,
  StreamEvent,
  StreamStatus,
  WoofxTransport,
  Workflow,
  WorkflowRun,
} from "./interface";

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

  connect(url: string, clientId?: string, clientSecret?: string): void {
    if (this.session) {
      this.session.dispose();
      this.session = null;
      this.connected = false;
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

  subscribeStreamEvents(_instanceId: string, _callback: (event: StreamEvent) => void): () => void {
    // Engine no longer exposes getStreamEvents for browser polling.
    return () => {};
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
