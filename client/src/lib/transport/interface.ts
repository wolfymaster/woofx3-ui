// WoofxTransport — abstracts communication with a woofx3 instance.
// The browser (BrowserTransport) connects directly via WebSocket.
// Tauri (TauriTransport) will use IPC → Rust → WebSocket.
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

export interface StreamEvent {
  id: string;
  type: 'follow' | 'subscribe' | 'gift' | 'bits' | 'raid' | 'cheer' | 'custom';
  userId?: string;
  username?: string;
  amount?: number;
  viewerCount?: number;
  message?: string;
  metadata?: Record<string, unknown>;
  timestamp: Date;
}

export interface WorkflowRun {
  id: string;
  workflowId: string;
  workflowName: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
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

export interface CreateWorkflowInput {
  name: string;
  description?: string;
  enabled?: boolean;
  steps: WorkflowStep[];
  variables?: Record<string, string>;
}

export interface WoofxTransport {
  // Connection lifecycle
  connect(url: string, apiKey?: string): void;
  disconnect(): void;
  isConnected(): boolean;

  // Stream status (one-off polling)
  getStreamStatus(instanceId: string): Promise<StreamStatus>;

  // Chat
  sendChatMessage(instanceId: string, message: string): Promise<void>;
  subscribeChatMessages(
    instanceId: string,
    callback: (msg: ChatMessage) => void
  ): () => void;

  // Stream events
  subscribeStreamEvents(
    instanceId: string,
    callback: (event: StreamEvent) => void
  ): () => void;

  // Workflow runs
  subscribeWorkflowRuns(
    instanceId: string,
    callback: (run: WorkflowRun) => void
  ): () => void;

  // Workflow CRUD
  getWorkflows(instanceId: string): Promise<Workflow[]>;
  createWorkflow(instanceId: string, workflow: CreateWorkflowInput): Promise<Workflow>;
  updateWorkflow(instanceId: string, workflowId: string, updates: Partial<CreateWorkflowInput>): Promise<Workflow>;
  deleteWorkflow(instanceId: string, workflowId: string): Promise<void>;
  executeWorkflow(instanceId: string, workflowId: string): Promise<string>;

  // Module state (runtime data owned by woofx3)
  getModuleState(instanceId: string, moduleId: string): Promise<unknown>;
}
