
export interface Module {
  id: string;
  name: string;
  slug: string;
  description: string;
  category: string;
  iconUrl?: string;
  version: string;
  author: string;
  isInstalled: boolean;
  isEnabled: boolean;
  triggers: TriggerDefinition[];
  actions: ActionDefinition[];
  createdAt: string;
  updatedAt: string;
}

export interface TriggerDefinition {
  id: string;
  name: string;
  description: string;
  icon?: string;
  parameters: ParameterDefinition[];
}

export interface ActionDefinition {
  id: string;
  name: string;
  description: string;
  icon?: string;
  parameters: ParameterDefinition[];
}

export interface ParameterDefinition {
  id: string;
  name: string;
  type: 'string' | 'number' | 'boolean' | 'select' | 'multiselect' | 'file' | 'color' | 'json';
  label: string;
  description?: string;
  required: boolean;
  defaultValue?: unknown;
  options?: { label: string; value: string }[];
  validation?: {
    min?: number;
    max?: number;
    pattern?: string;
    message?: string;
  };
}

export interface Workflow {
  id: string;
  name: string;
  description?: string;
  accountId: string;
  isEnabled: boolean;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowNode {
  id: string;
  type: 'trigger' | 'action' | 'condition' | 'delay';
  moduleId: string;
  definitionId: string;
  position: { x: number; y: number };
  data: {
    label: string;
    description?: string;
    icon?: string;
    parameters: Record<string, unknown>;
  };
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
  label?: string;
  condition?: string;
}

export interface Asset {
  id: string;
  name: string;
  type: 'image' | 'video' | 'audio' | 'font' | 'other';
  mimeType: string;
  size: number;
  url: string;
  thumbnailUrl?: string;
  accountId: string;
  folderId?: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface AssetFolder {
  id: string;
  name: string;
  parentId?: string;
  accountId: string;
  createdAt: string;
}

export interface Scene {
  id: string;
  name: string;
  description?: string;
  accountId: string;
  width: number;
  height: number;
  backgroundColor: string;
  widgets: Widget[];
  createdAt: string;
  updatedAt: string;
}

export interface Widget {
  id: string;
  type: 'text' | 'image' | 'video' | 'shape' | 'timer' | 'chat' | 'alert' | 'custom';
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

export interface ThemePreset {
  id: string;
  name: string;
  colors: {
    primary: string;
    primaryForeground: string;
    background: string;
    foreground: string;
    card: string;
    cardForeground: string;
    muted: string;
    mutedForeground: string;
    accent: string;
    accentForeground: string;
    sidebar: string;
    sidebarForeground: string;
  };
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

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export type LoadingState = 'idle' | 'loading' | 'success' | 'error';

export interface NavigationItem {
  id: string;
  label: string;
  icon: string;
  href?: string;
  children?: NavigationItem[];
  badge?: string | number;
}
