// BrowserTransport — wraps the woofx3 SDK's capnweb WebSocket client for
// direct browser→engine communication. Authenticates via the SDK's
// createEngineBrowserSession (which handles gateway.authenticate + promise
// pipelining under the hood). Subscriptions are polling-based since the
// engine's current Api surface is point-in-time.

import type { Woofx3EngineApi } from "@woofx3/api";
import { createEngineBrowserSession, type EngineBrowserSession, type RpcTarget } from "@woofx3/api/client";
import type {
  ChatMessage,
  CreateWorkflowInput,
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

const POLL_INTERVAL_CHAT = 3000;
const POLL_INTERVAL_EVENTS = 5000;
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

  async getStreamStatus(instanceId: string): Promise<StreamStatus> {
    try {
      const result = await this.getApi().getStreamStatus(instanceId);
      return result as StreamStatus;
    } catch {
      return { isLive: false, uptime: "00:00:00", viewerCount: 0 };
    }
  }

  async sendChatMessage(instanceId: string, message: string): Promise<void> {
    await this.getApi().sendChatMessage(instanceId, message);
  }

  subscribeChatMessages(instanceId: string, callback: (msg: ChatMessage) => void): () => void {
    const api = this.session?.api;
    if (!api) {
      return () => {};
    }

    let lastId: string | null = null;
    const interval = setInterval(async () => {
      try {
        const messages = await api.getChatMessages(instanceId, 50);
        const newMessages = lastId ? messages.filter((m) => m.id > lastId!) : messages;
        if (newMessages.length > 0) {
          lastId = newMessages[newMessages.length - 1].id;
          newMessages.forEach((m) => callback(m as unknown as ChatMessage));
        }
      } catch {
        // Silently ignore connection errors during polling
      }
    }, POLL_INTERVAL_CHAT);

    return () => clearInterval(interval);
  }

  subscribeStreamEvents(instanceId: string, callback: (event: StreamEvent) => void): () => void {
    const api = this.session?.api;
    if (!api) {
      return () => {};
    }

    let lastId: string | null = null;
    const interval = setInterval(async () => {
      try {
        const events = await api.getStreamEvents({
          accountId: instanceId,
          limit: 20,
        });
        const newEvents = lastId ? events.filter((e) => e.id > lastId!) : events;
        if (newEvents.length > 0) {
          lastId = newEvents[newEvents.length - 1].id;
          newEvents.forEach((e) => callback(e as unknown as StreamEvent));
        }
      } catch {
        // Silently ignore
      }
    }, POLL_INTERVAL_EVENTS);

    return () => clearInterval(interval);
  }

  subscribeWorkflowRuns(instanceId: string, callback: (run: WorkflowRun) => void): () => void {
    const api = this.session?.api;
    if (!api) {
      return () => {};
    }

    const interval = setInterval(async () => {
      try {
        const runs = await api.getWorkflowRuns({ accountId: instanceId });
        runs.forEach((r) => callback(r as unknown as WorkflowRun));
      } catch {
        // Silently ignore
      }
    }, POLL_INTERVAL_RUNS);

    return () => clearInterval(interval);
  }

  async getWorkflows(instanceId: string): Promise<Workflow[]> {
    const result = await this.getApi().getWorkflows({
      accountId: instanceId,
    });
    return (result?.workflows ?? []) as unknown as Workflow[];
  }

  async createWorkflow(instanceId: string, workflow: CreateWorkflowInput): Promise<Workflow> {
    const result = await this.getApi().createWorkflow({
      name: workflow.name,
      description: workflow.description,
      accountId: instanceId,
      isEnabled: workflow.enabled,
      steps: workflow.steps,
    });
    return result as unknown as Workflow;
  }

  async updateWorkflow(
    _instanceId: string,
    workflowId: string,
    updates: Partial<CreateWorkflowInput>
  ): Promise<Workflow> {
    const result = await this.getApi().updateWorkflow(workflowId, {
      name: updates.name,
      description: updates.description,
      isEnabled: updates.enabled,
      steps: updates.steps,
    });
    return result as unknown as Workflow;
  }

  async deleteWorkflow(_instanceId: string, workflowId: string): Promise<void> {
    await this.getApi().deleteWorkflow(workflowId);
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
