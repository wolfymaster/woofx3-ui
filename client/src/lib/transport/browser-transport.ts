// BrowserTransport — wraps the Cap'n Web RPC client for direct browser→woofx3 communication.
// Uses polling for subscriptions since the woofx3 API is currently point-in-time.

import { newWebSocketRpcSession, RpcStub } from "capnweb";
import type {
  WoofxTransport,
  StreamStatus,
  ChatMessage,
  StreamEvent,
  WorkflowRun,
  Workflow,
  CreateWorkflowInput,
} from "./interface";

// Minimal RPC API contract for the woofx3 instance connection
interface WoofxRpcApi {
  getStreamStatus(instanceId: string): Promise<StreamStatus>;
  sendChatMessage(instanceId: string, message: string): Promise<unknown>;
  getChatMessages(instanceId: string, limit: number): Promise<unknown[]>;
  getStreamEvents(query: { accountId: string; limit?: number }): Promise<unknown[]>;
  getWorkflowRuns(query: { accountId: string }): Promise<unknown[]>;
  getWorkflows(query: { accountId: string }): Promise<{ items?: unknown[] }>;
  createWorkflow(input: Record<string, unknown>): Promise<unknown>;
  updateWorkflow(id: string, updates: Record<string, unknown>): Promise<unknown>;
  deleteWorkflow(id: string): Promise<unknown>;
  triggerWorkflowByName(id: string, params: Record<string, unknown>, source: string): Promise<unknown>;
  getModule(id: string): Promise<unknown>;
}

const POLL_INTERVAL_CHAT = 3000;
const POLL_INTERVAL_EVENTS = 5000;
const POLL_INTERVAL_RUNS = 10000;

function buildWebSocketUrl(engineUrl: string, apiKey?: string): string {
  let url: string;

  if (engineUrl.includes("://")) {
    try {
      const parsed = new URL(engineUrl);
      const protocol = parsed.protocol === "https:" ? "wss:" : "ws:";
      url = `${protocol}//${parsed.host}/api`;
    } catch {
      throw new Error(`Invalid engine URL: ${engineUrl}`);
    }
  } else {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    url = `${protocol}//${engineUrl}/api`;
  }

  if (apiKey) {
    url += `?apiKey=${encodeURIComponent(apiKey)}`;
  }
  return url;
}

export class BrowserTransport implements WoofxTransport {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private session: any = null;
  private connected = false;

  connect(url: string, apiKey?: string): void {
    if (this.session) {
      this.session[Symbol.dispose]();
      this.session = null;
      this.connected = false;
    }

    if (!url) return;

    try {
      const wsUrl = buildWebSocketUrl(url, apiKey);
      this.session = newWebSocketRpcSession<WoofxRpcApi>(wsUrl) as any;
      this.connected = true;
      console.log("[Transport] Connected to woofx3 at", wsUrl);
    } catch (err) {
      this.connected = false;
      console.warn("[Transport] Failed to connect:", err);
    }
  }

  disconnect(): void {
    if (this.session) {
      this.session[Symbol.dispose]();
      this.session = null;
    }
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected && !!this.session;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private getSession(): any {
    if (!this.session) throw new Error("Not connected to woofx3 instance");
    return this.session;
  }

  async getStreamStatus(instanceId: string): Promise<StreamStatus> {
    try {
      const result = await this.getSession().getStreamStatus(instanceId);
      return result as StreamStatus;
    } catch {
      return { isLive: false, uptime: "00:00:00", viewerCount: 0 };
    }
  }

  async sendChatMessage(instanceId: string, message: string): Promise<void> {
    await this.getSession().sendChatMessage(instanceId, message);
  }

  subscribeChatMessages(
    instanceId: string,
    callback: (msg: ChatMessage) => void
  ): () => void {
    let lastId: string | null = null;
    const session = this.session;
    if (!session) return () => {};

    const interval = setInterval(async () => {
      try {
        const messages = await session.getChatMessages(instanceId, 50);
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
    let lastId: string | null = null;
    const session = this.session;
    if (!session) return () => {};

    const interval = setInterval(async () => {
      try {
        const events = await session.getStreamEvents({
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
    const session = this.session;
    if (!session) return () => {};

    const interval = setInterval(async () => {
      try {
        const runs = await session.getWorkflowRuns({ accountId: instanceId });
        runs.forEach((r: any) => callback(r as WorkflowRun));
      } catch {
        // Silently ignore
      }
    }, POLL_INTERVAL_RUNS);

    return () => clearInterval(interval);
  }

  async getWorkflows(instanceId: string): Promise<Workflow[]> {
    const result = await this.getSession().getWorkflows({
      accountId: instanceId,
    });
    return (result.items || []) as Workflow[];
  }

  async createWorkflow(
    instanceId: string,
    workflow: CreateWorkflowInput
  ): Promise<Workflow> {
    const result = await this.getSession().createWorkflow({
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
    const result = await this.getSession().updateWorkflow(
      workflowId,
      updates as any
    );
    return result as Workflow;
  }

  async deleteWorkflow(instanceId: string, workflowId: string): Promise<void> {
    await this.getSession().deleteWorkflow(workflowId);
  }

  async executeWorkflow(instanceId: string, workflowId: string): Promise<string> {
    const result = await this.getSession().triggerWorkflowByName(
      workflowId,
      {},
      "user"
    );
    return (result as any).executionId || workflowId;
  }

  async getModuleState(instanceId: string, moduleId: string): Promise<unknown> {
    const result = await this.getSession().getModule(moduleId);
    return result;
  }
}
