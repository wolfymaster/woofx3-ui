// BrowserTransport — wraps the Cap'n Web RPC client for direct browser→woofx3 communication.
// Authenticates via gateway.authenticate(clientId, clientSecret) per the ApiGateway pattern.
// Uses polling for subscriptions since the woofx3 API is currently point-in-time.

import { newWebSocketRpcSession, RpcTarget } from "capnweb";
import type { ApiGatewayContract } from "@woofx3/api/rpc";
import type { Woofx3EngineApi } from "@woofx3/api";
import type {
  WoofxTransport,
  StreamStatus,
  ChatMessage,
  StreamEvent,
  WorkflowRun,
  Workflow,
  CreateWorkflowInput,
  EngineModule,
} from "./interface";

/**
 * Local intersection: Woofx3EngineApi with an extra method the engine
 * exposes but hasn't made it into the shared interface yet. Retire each
 * override as the shared surface catches up.
 */
interface BrowserEngineApi extends RpcTarget, Woofx3EngineApi {
  setEngineModuleState(name: string, state: string): Promise<{ success: boolean }>;
}

/** Gateway over WebSocket — same shape as HTTP batch, different transport. */
interface BrowserGateway extends RpcTarget, ApiGatewayContract {
  authenticate(clientId: string, clientSecret: string): Promise<BrowserEngineApi>;
}

const POLL_INTERVAL_CHAT = 3000;
const POLL_INTERVAL_EVENTS = 5000;
const POLL_INTERVAL_RUNS = 10000;

function buildWebSocketUrl(engineUrl: string): string {
  if (engineUrl.includes("://")) {
    try {
      const parsed = new URL(engineUrl);
      const protocol = parsed.protocol === "https:" ? "wss:" : "ws:";
      return `${protocol}//${parsed.host}/api`;
    } catch {
      throw new Error(`Invalid engine URL: ${engineUrl}`);
    }
  }
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${engineUrl}/api`;
}

export class BrowserTransport implements WoofxTransport {
  private gateway: any = null;
  private api: any = null;
  private connected = false;

  connect(url: string, clientId?: string, clientSecret?: string): void {
    if (this.gateway) {
      this.gateway[Symbol.dispose]();
      this.gateway = null;
      this.api = null;
      this.connected = false;
    }

    if (!url) {
      return;
    }

    try {
      const wsUrl = buildWebSocketUrl(url);
      this.gateway = newWebSocketRpcSession<BrowserGateway>(wsUrl) as any;

      if (clientId && clientSecret) {
        // Authenticate via gateway — capnweb promise pipelining means
        // this + the first API call happen in a single round trip.
        this.api = this.gateway.authenticate(clientId, clientSecret);
      } else {
        // No credentials — gateway is available but API calls will fail.
        // This allows ping() to work for connection testing.
        this.api = null;
      }

      this.connected = true;
      console.log("[Transport] Connected to woofx3 at", wsUrl);
    } catch (err) {
      this.connected = false;
      console.warn("[Transport] Failed to connect:", err);
    }
  }

  disconnect(): void {
    if (this.gateway) {
      this.gateway[Symbol.dispose]();
      this.gateway = null;
    }
    this.api = null;
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected && !!this.api;
  }

  private getApi(): any {
    if (!this.api) {
      throw new Error("Not connected to woofx3 instance");
    }
    return this.api;
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

  subscribeChatMessages(
    instanceId: string,
    callback: (msg: ChatMessage) => void
  ): () => void {
    const api = this.api;
    if (!api) {
      return () => {};
    }

    let lastId: string | null = null;
    const interval = setInterval(async () => {
      try {
        const messages = await api.getChatMessages(instanceId, 50);
        const newMessages = lastId
          ? messages.filter((m: any) => m.id > lastId!)
          : messages;
        if (newMessages.length > 0) {
          lastId = newMessages[newMessages.length - 1].id;
          newMessages.forEach((m: any) => callback(m as ChatMessage));
        }
      } catch {
        // Silently ignore connection errors during polling
      }
    }, POLL_INTERVAL_CHAT);

    return () => clearInterval(interval);
  }

  subscribeStreamEvents(
    instanceId: string,
    callback: (event: StreamEvent) => void
  ): () => void {
    const api = this.api;
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
        const newEvents = lastId
          ? events.filter((e: any) => e.id > lastId!)
          : events;
        if (newEvents.length > 0) {
          lastId = newEvents[newEvents.length - 1].id;
          newEvents.forEach((e: any) => callback(e as StreamEvent));
        }
      } catch {
        // Silently ignore
      }
    }, POLL_INTERVAL_EVENTS);

    return () => clearInterval(interval);
  }

  subscribeWorkflowRuns(
    instanceId: string,
    callback: (run: WorkflowRun) => void
  ): () => void {
    const api = this.api;
    if (!api) {
      return () => {};
    }

    const interval = setInterval(async () => {
      try {
        const runs = await api.getWorkflowRuns({ accountId: instanceId });
        runs.forEach((r: any) => callback(r as WorkflowRun));
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

  async createWorkflow(
    instanceId: string,
    workflow: CreateWorkflowInput
  ): Promise<Workflow> {
    const result = await this.getApi().createWorkflow({
      ...workflow,
      applicationId: instanceId,
      createdBy: "user",
    } as any);
    return result as Workflow;
  }

  async updateWorkflow(
    instanceId: string,
    workflowId: string,
    updates: Partial<CreateWorkflowInput>
  ): Promise<Workflow> {
    const result = await this.getApi().updateWorkflow(
      workflowId,
      updates as any
    );
    return result as Workflow;
  }

  async deleteWorkflow(instanceId: string, workflowId: string): Promise<void> {
    await this.getApi().deleteWorkflow(workflowId);
  }

  async executeWorkflow(instanceId: string, workflowId: string): Promise<string> {
    const result = await this.getApi().triggerWorkflowByName(
      workflowId,
      {},
      "user"
    );
    return (result as any).executionId || workflowId;
  }

  async getModuleState(instanceId: string, moduleId: string): Promise<unknown> {
    const result = await this.getApi().getModule(moduleId);
    return result;
  }

  async listEngineModules(instanceId: string): Promise<EngineModule[]> {
    const result = await this.getApi().listEngineModules();
    return result as EngineModule[];
  }

  async uninstallEngineModule(instanceId: string, name: string): Promise<void> {
    await this.getApi().uninstallEngineModule(name);
  }

  async setEngineModuleState(instanceId: string, name: string, state: string): Promise<void> {
    await this.getApi().setEngineModuleState(name, state);
  }
}
