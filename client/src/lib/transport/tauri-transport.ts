// TauriTransport — stub for Tauri desktop app.
// When the app runs in Tauri, this transport will use Tauri IPC commands
// to communicate with the native Rust layer, which then proxies to woofx3
// via a direct WebSocket connection (no CORS issues, native networking).
//
// Implementation will use: import { invoke } from '@tauri-apps/api/tauri'
// and Rust commands defined in src-tauri/src/main.rs

import type {
  WoofxTransport,
  StreamStatus,
  ChatMessage,
  StreamEvent,
  WorkflowRun,
  Workflow,
  CreateWorkflowInput,
} from "./interface";

export class TauriTransport implements WoofxTransport {
  connect(url: string, apiKey?: string): void {
    // TODO: invoke('connect_woofx3', { url, apiKey })
    throw new Error("TauriTransport not yet implemented");
  }

  disconnect(): void {
    // TODO: invoke('disconnect_woofx3')
    throw new Error("TauriTransport not yet implemented");
  }

  isConnected(): boolean {
    return false;
  }

  async getStreamStatus(instanceId: string): Promise<StreamStatus> {
    // TODO: invoke('get_stream_status', { instanceId })
    throw new Error("TauriTransport not yet implemented");
  }

  async sendChatMessage(instanceId: string, message: string): Promise<void> {
    // TODO: invoke('send_chat_message', { instanceId, message })
    throw new Error("TauriTransport not yet implemented");
  }

  subscribeChatMessages(
    instanceId: string,
    callback: (msg: ChatMessage) => void
  ): () => void {
    // TODO: Tauri event listener on 'chat-message' events emitted from Rust
    throw new Error("TauriTransport not yet implemented");
  }

  subscribeStreamEvents(
    instanceId: string,
    callback: (event: StreamEvent) => void
  ): () => void {
    // TODO: Tauri event listener on 'stream-event' events
    throw new Error("TauriTransport not yet implemented");
  }

  subscribeWorkflowRuns(
    instanceId: string,
    callback: (run: WorkflowRun) => void
  ): () => void {
    // TODO: Tauri event listener on 'workflow-run' events
    throw new Error("TauriTransport not yet implemented");
  }

  async getWorkflows(instanceId: string): Promise<Workflow[]> {
    // TODO: invoke('get_workflows', { instanceId })
    throw new Error("TauriTransport not yet implemented");
  }

  async createWorkflow(
    instanceId: string,
    workflow: CreateWorkflowInput
  ): Promise<Workflow> {
    // TODO: invoke('create_workflow', { instanceId, workflow })
    throw new Error("TauriTransport not yet implemented");
  }

  async updateWorkflow(
    instanceId: string,
    workflowId: string,
    updates: Partial<CreateWorkflowInput>
  ): Promise<Workflow> {
    // TODO: invoke('update_workflow', { instanceId, workflowId, updates })
    throw new Error("TauriTransport not yet implemented");
  }

  async deleteWorkflow(instanceId: string, workflowId: string): Promise<void> {
    // TODO: invoke('delete_workflow', { instanceId, workflowId })
    throw new Error("TauriTransport not yet implemented");
  }

  async executeWorkflow(instanceId: string, workflowId: string): Promise<string> {
    // TODO: invoke('execute_workflow', { instanceId, workflowId })
    throw new Error("TauriTransport not yet implemented");
  }

  async getModuleState(instanceId: string, moduleId: string): Promise<unknown> {
    // TODO: invoke('get_module_state', { instanceId, moduleId })
    throw new Error("TauriTransport not yet implemented");
  }
}
