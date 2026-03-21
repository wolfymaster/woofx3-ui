export interface PaginationParams {
  page?: number;
  pageSize?: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

export interface StreamStatus {
  isLive: boolean;
  uptime: string;
  viewerCount: number;
  startedAt?: string;
}

// Configuration field types for dynamic forms
export type ConfigFieldType = 'string' | 'number' | 'boolean' | 'select' | 'multiselect' | 'range' | 'color' | 'media' | 'json';

export interface ConfigFieldOption {
  value: string;
  label: string;
}

export interface ConfigField {
  id: string;
  name: string;
  type: ConfigFieldType;
  label: string;
  description?: string;
  required?: boolean;
  placeholder?: string;
  defaultValue?: unknown;
  options?: ConfigFieldOption[];
  // For number/range fields
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  // For media fields
  mediaType?: 'image' | 'audio' | 'video';
  // Validation
  validation?: {
    pattern?: string;
    message?: string;
  };
}

export interface TriggerDefinition {
  id: string;
  moduleId: string;
  name: string;
  description: string;
  icon: string; // Icon name (e.g., 'MessageCircle', 'UserPlus')
  category: string;
  color?: string;
  config: {
    fields: ConfigField[];
    supportsTiers?: boolean;
    tierLabel?: string;
  };
}

export interface ActionDefinition {
  id: string;
  moduleId: string;
  name: string;
  description: string;
  icon: string;
  category: string;
  color?: string;
  config: {
    fields: ConfigField[];
  };
}

export interface Module {
  id: string;
  name: string;
  slug: string;
  description: string;
  category: string;
  version: string;
  author: string;
  isInstalled: boolean;
  isEnabled: boolean;
  triggers: string[];
  actions: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ModulesQuery extends PaginationParams {
  category?: string;
  search?: string;
  installed?: boolean;
}

export interface WorkflowStats {
  runsToday: number;
  successRate: number;
}

export interface Workflow {
  id: string;
  name: string;
  description: string;
  accountId: string;
  isEnabled: boolean;
  nodes: unknown[];
  edges: unknown[];
  stats: WorkflowStats;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowsQuery extends PaginationParams {
  accountId?: string;
  enabled?: boolean;
}

export interface CreateWorkflowInput {
  name: string;
  description?: string;
  accountId: string;
  isEnabled?: boolean;
  nodes?: unknown[];
  edges?: unknown[];
}

export interface UpdateWorkflowInput {
  name?: string;
  description?: string;
  isEnabled?: boolean;
  nodes?: unknown[];
  edges?: unknown[];
}

export interface Asset {
  id: string;
  name: string;
  type: string;
  mimeType: string;
  size: number;
  url: string;
  accountId: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface AssetsQuery extends PaginationParams {
  accountId?: string;
  type?: string;
  search?: string;
}

export interface CreateAssetInput {
  name: string;
  type: string;
  mimeType?: string;
  size?: number;
  tags?: string[];
}

export interface Widget {
  id: string;
  type: string;
  name: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
  rotation: number;
  opacity: number;
  zIndex: number;
  locked: boolean;
  visible: boolean;
  properties: Record<string, unknown>;
}

export interface Scene {
  id: string;
  name: string;
  description: string;
  accountId: string;
  width: number;
  height: number;
  backgroundColor: string;
  widgets: Widget[];
  createdAt: string;
  updatedAt: string;
}

export interface ScenesQuery extends PaginationParams {
  accountId?: string;
}

export interface CreateSceneInput {
  name: string;
  description?: string;
  accountId: string;
  width?: number;
  height?: number;
  backgroundColor?: string;
  widgets?: Widget[];
}

export interface UpdateSceneInput {
  name?: string;
  description?: string;
  width?: number;
  height?: number;
  backgroundColor?: string;
  widgets?: Widget[];
}

export interface DashboardStats {
  activeWorkflows: number;
  totalWorkflows: number;
  installedModules: number;
  totalModules: number;
  totalAssets: number;
  totalAssetsSize: number;
  eventsToday: number;
  systemHealth: {
    cpu: number;
    memory: number;
    storage: number;
    apiRateLimit: { used: number; total: number };
  };
}

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: 'owner' | 'admin' | 'member';
  status: 'active' | 'invited' | 'inactive';
  joinedAt: string;
  avatarUrl?: string;
}

export interface WorkflowRun {
  id: string;
  workflowId: string;
  workflowName: string;
  status: 'success' | 'failed' | 'running';
  startedAt: string;
  duration: number;
  trigger: string;
}

export interface WorkflowRunsQuery {
  workflowId?: string;
  accountId?: string;
  limit?: number;
}

export interface ChatMessage {
  id: string;
  user: string;
  message: string;
  timestamp: string;
  badges: string[];
  color: string;
}

export interface StreamEvent {
  id: string;
  type: 'follow' | 'subscription' | 'donation' | 'raid' | 'cheer' | 'gift';
  user: string;
  amount?: number;
  message?: string;
  timestamp: string;
}

export interface StreamEventsQuery {
  accountId: string;
  limit?: number;
  types?: string[];
}

export interface UserPreferences {
  email: boolean;
  push: boolean;
  workflow: boolean;
  marketing: boolean;
}

export interface DashboardModule {
  id: string;
  type: string;
  title: string;
  config?: Record<string, unknown>;
}

