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

export interface User {
  id: string;
  email: string;
  displayName: string;
  role: string;
  teamIds: string[];
  accountIds: string[];
  createdAt: string;
}

export interface Team {
  id: string;
  name: string;
  slug: string;
  ownerId: string;
  createdAt: string;
}

export interface Account {
  id: string;
  name: string;
  slug: string;
  teamId: string;
  createdAt: string;
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

export interface StreamControlApi {
  getUser(): Promise<User>;

  getTeams(): Promise<Team[]>;
  getTeam(id: string): Promise<Team | null>;

  getAccounts(teamId?: string): Promise<Account[]>;
  getAccount(id: string): Promise<Account | null>;

  getModules(query?: ModulesQuery): Promise<PaginatedResponse<Module>>;
  getModule(id: string): Promise<Module | null>;
  installModule(id: string): Promise<Module>;
  uninstallModule(id: string): Promise<Module>;

  getWorkflows(query?: WorkflowsQuery): Promise<PaginatedResponse<Workflow>>;
  getWorkflow(id: string): Promise<Workflow | null>;
  createWorkflow(input: CreateWorkflowInput): Promise<Workflow>;
  updateWorkflow(id: string, input: UpdateWorkflowInput): Promise<Workflow | null>;
  deleteWorkflow(id: string): Promise<boolean>;

  getAssets(query?: AssetsQuery): Promise<PaginatedResponse<Asset>>;
  getAsset(id: string): Promise<Asset | null>;
  createAsset(input: CreateAssetInput): Promise<Asset>;
  deleteAsset(id: string): Promise<boolean>;

  getScenes(query?: ScenesQuery): Promise<PaginatedResponse<Scene>>;
  getScene(id: string): Promise<Scene | null>;
  createScene(input: CreateSceneInput): Promise<Scene>;
  updateScene(id: string, input: UpdateSceneInput): Promise<Scene | null>;
  deleteScene(id: string): Promise<boolean>;

  getDashboardStats(): Promise<DashboardStats>;
}
