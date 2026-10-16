import type { EventLogPage, EventLogQuery, EventLogSelection, EventLogSettings, StreamEventFrame } from "@woofx3/api";

// WoofxTransport — abstracts communication with a woofx3 instance.
// The browser (BrowserTransport) connects directly via WebSocket.
// All data returned here is woofx3-owned runtime data, NOT Convex data.

export interface StreamStatus {
  isLive: boolean;
  uptime: string;
  viewerCount: number;
  title?: string;
  category?: string;
}

export interface ChatMessage {
  id: string;
  userId: string;
  username: string;
  displayName: string;
  message: string;
  color?: string;
  badges?: string[];
  timestamp: Date;
}

export interface WorkflowRun {
  id: string;
  workflowId: string;
  workflowName: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  startedAt: Date;
  completedAt?: Date;
  triggeredBy?: string;
  error?: string;
  progress?: number;
}

export interface Workflow {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  steps: WorkflowStep[];
  variables?: Record<string, string>;
  onSuccess?: string;
  onFailure?: string;
  maxRetries?: number;
  timeoutSeconds?: number;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface WorkflowStep {
  id: string;
  name: string;
  type: string;
  parameters?: Record<string, unknown>;
  onSuccess?: string;
  onFailure?: string;
  timeoutSeconds?: number;
  retryAttempts?: number;
  async?: boolean;
}

export interface EngineModule {
  name: string;
  version: string;
  state: string;
}

export interface WoofxTransport {
  // Connection lifecycle
  connect(url: string, clientId?: string, clientSecret?: string): void;
  disconnect(): void;
  isConnected(): boolean;
  /** Retry a dropped connection at once instead of waiting out the backoff; a no-op while a session is open. */
  reconnectNow(): void;

  // Stream status (one-off polling)
  getStreamStatus(instanceId: string): Promise<StreamStatus>;

  // Chat (inbound subscription only — outbound send was removed from the engine)
  subscribeChatMessages(instanceId: string, callback: (msg: ChatMessage) => void): () => void;

  // Stream events. Carries the engine's CloudEvent frame verbatim; wording it
  // is the consumer's job (lib/activity-feed.ts reads it through the trigger
  // catalog), so this transport does not introduce a second event vocabulary
  // alongside the shared contract.
  //
  // `types` are the event types (CloudEvent `type`) the callback takes; the
  // engine is asked to push only what some listener takes. `types` null takes
  // every frame that arrives and asks for nothing: for an engine that predates
  // per-subscriber types (capability `events.log`), which pushes its own fixed
  // set whatever it is asked.
  subscribeStreamEvents(
    instanceId: string,
    types: readonly string[] | null,
    callback: (frame: StreamEventFrame) => void
  ): () => void;
  /**
   * A page of the engine's event log, newest first: the history behind
   * `subscribeStreamEvents`, in the same frame shape. Needs `events.log`.
   */
  listEvents(instanceId: string, query?: EventLogQuery): Promise<EventLogPage>;
  /** Which event types the engine logs and pushes, and which it offers. Needs `events.log`. */
  getEventLogSettings(instanceId: string): Promise<EventLogSettings>;
  /** Replaces the engine's selection and returns the settings it results in. Needs `events.log`. */
  setEventLogSelection(instanceId: string, selection: EventLogSelection): Promise<EventLogSettings>;

  // Workflow runs
  subscribeWorkflowRuns(instanceId: string, callback: (run: WorkflowRun) => void): () => void;

  // Workflow read / ad-hoc execute only. Create/update/delete now go through
  // the Convex `workflowActions` surface (createFromDefinition, etc.) — the
  // engine mints ids and webhook-echoes state back to Convex.
  getWorkflows(instanceId: string): Promise<Workflow[]>;
  executeWorkflow(instanceId: string, workflowId: string): Promise<string>;

  // Module state (runtime data owned by woofx3)
  getModuleState(instanceId: string, moduleId: string): Promise<unknown>;
  listEngineModules(instanceId: string): Promise<EngineModule[]>;
  uninstallEngineModule(instanceId: string, name: string): Promise<void>;
  setEngineModuleState(instanceId: string, name: string, state: string): Promise<void>;
}
