import { RpcTarget } from "capnweb";
import type {
  StreamControlApi,
  User,
  Team,
  Account,
  Module,
  ModulesQuery,
  Workflow,
  WorkflowsQuery,
  CreateWorkflowInput,
  UpdateWorkflowInput,
  Asset,
  AssetsQuery,
  CreateAssetInput,
  Scene,
  ScenesQuery,
  CreateSceneInput,
  UpdateSceneInput,
  DashboardStats,
  PaginatedResponse,
} from "../shared/api";

function paginate<T>(items: T[], page: number = 1, pageSize: number = 20): PaginatedResponse<T> {
  const totalItems = items.length;
  const totalPages = Math.ceil(totalItems / pageSize);
  const start = (page - 1) * pageSize;
  const end = start + pageSize;

  return {
    data: items.slice(start, end),
    pagination: {
      page,
      pageSize,
      totalItems,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1,
    },
  };
}

const mockUser: User = {
  id: 'user-1',
  email: 'alex@streamcontrol.io',
  displayName: 'Alex Chen',
  role: 'owner',
  teamIds: ['team-1'],
  accountIds: ['account-1', 'account-2'],
  createdAt: '2024-01-01T00:00:00Z',
};

const mockTeams: Team[] = [
  { id: 'team-1', name: 'Demo Team', slug: 'demo-team', ownerId: 'user-1', createdAt: '2024-01-01T00:00:00Z' },
  { id: 'team-2', name: 'Production Team', slug: 'production-team', ownerId: 'user-1', createdAt: '2024-01-15T00:00:00Z' },
];

const mockAccounts: Account[] = [
  { id: 'account-1', name: 'Main Channel', slug: 'main-channel', teamId: 'team-1', createdAt: '2024-01-01T00:00:00Z' },
  { id: 'account-2', name: 'Gaming Channel', slug: 'gaming-channel', teamId: 'team-1', createdAt: '2024-01-05T00:00:00Z' },
];

let mockModules: Module[] = [
  {
    id: 'mod-1',
    name: 'Twitch Integration',
    slug: 'twitch-integration',
    description: 'Connect your Twitch channel with comprehensive API support for chat, events, and channel points.',
    category: 'Integrations',
    version: '2.1.0',
    author: 'StreamControl Team',
    isInstalled: true,
    isEnabled: true,
    triggers: [],
    actions: [],
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-10T00:00:00Z',
  },
  {
    id: 'mod-2',
    name: 'Chat Commands',
    slug: 'chat-commands',
    description: 'Create custom chat commands with variables, cooldowns, and permission levels.',
    category: 'Chat',
    version: '1.5.2',
    author: 'StreamControl Team',
    isInstalled: true,
    isEnabled: true,
    triggers: [],
    actions: [],
    createdAt: '2024-01-02T00:00:00Z',
    updatedAt: '2024-01-08T00:00:00Z',
  },
  {
    id: 'mod-3',
    name: 'Alert Box Pro',
    slug: 'alert-box-pro',
    description: 'Advanced alert system with custom animations, sounds, and TTS support for all event types.',
    category: 'Alerts',
    version: '3.0.1',
    author: 'StreamControl Team',
    isInstalled: true,
    isEnabled: false,
    triggers: [],
    actions: [],
    createdAt: '2024-01-03T00:00:00Z',
    updatedAt: '2024-01-12T00:00:00Z',
  },
  {
    id: 'mod-4',
    name: 'Sound Effects',
    slug: 'sound-effects',
    description: 'Trigger sound effects from chat commands, channel points, or workflow events.',
    category: 'Audio',
    version: '1.2.0',
    author: 'Community',
    isInstalled: false,
    isEnabled: false,
    triggers: [],
    actions: [],
    createdAt: '2024-01-04T00:00:00Z',
    updatedAt: '2024-01-05T00:00:00Z',
  },
  {
    id: 'mod-5',
    name: 'Media Controls',
    slug: 'media-controls',
    description: 'Let viewers control media playback through chat commands and channel point redemptions.',
    category: 'Media',
    version: '2.0.0',
    author: 'Community',
    isInstalled: false,
    isEnabled: false,
    triggers: [],
    actions: [],
    createdAt: '2024-01-05T00:00:00Z',
    updatedAt: '2024-01-09T00:00:00Z',
  },
  {
    id: 'mod-6',
    name: 'Auto Moderation',
    slug: 'auto-moderation',
    description: 'Intelligent chat moderation with customizable filters, warnings, and timeout automation.',
    category: 'Chat',
    version: '1.8.0',
    author: 'StreamControl Team',
    isInstalled: false,
    isEnabled: false,
    triggers: [],
    actions: [],
    createdAt: '2024-01-06T00:00:00Z',
    updatedAt: '2024-01-11T00:00:00Z',
  },
  {
    id: 'mod-7',
    name: 'Viewer Games',
    slug: 'viewer-games',
    description: 'Interactive mini-games for your viewers including predictions, trivia, and gambling.',
    category: 'Automation',
    version: '1.0.0',
    author: 'Community',
    isInstalled: false,
    isEnabled: false,
    triggers: [],
    actions: [],
    createdAt: '2024-01-07T00:00:00Z',
    updatedAt: '2024-01-07T00:00:00Z',
  },
  {
    id: 'mod-8',
    name: 'Scene Transitions',
    slug: 'scene-transitions',
    description: 'Beautiful animated transitions between scenes with customizable effects.',
    category: 'Effects',
    version: '1.3.0',
    author: 'Community',
    isInstalled: false,
    isEnabled: false,
    triggers: [],
    actions: [],
    createdAt: '2024-01-08T00:00:00Z',
    updatedAt: '2024-01-06T00:00:00Z',
  },
];

let mockWorkflows: Workflow[] = [
  {
    id: 'wf-1',
    name: 'Chat Commands Handler',
    description: 'Responds to custom chat commands with configurable responses and cooldowns.',
    accountId: 'account-1',
    isEnabled: true,
    nodes: [],
    edges: [],
    stats: { runsToday: 156, successRate: 99.2 },
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-10T00:00:00Z',
  },
  {
    id: 'wf-2',
    name: 'Follow Alert System',
    description: 'Triggers alerts and sounds when new followers join the channel.',
    accountId: 'account-1',
    isEnabled: true,
    nodes: [],
    edges: [],
    stats: { runsToday: 23, successRate: 100 },
    createdAt: '2024-01-02T00:00:00Z',
    updatedAt: '2024-01-09T00:00:00Z',
  },
  {
    id: 'wf-3',
    name: 'Donation Processing',
    description: 'Handles donation events with TTS, overlays, and thank you messages.',
    accountId: 'account-1',
    isEnabled: true,
    nodes: [],
    edges: [],
    stats: { runsToday: 8, successRate: 100 },
    createdAt: '2024-01-03T00:00:00Z',
    updatedAt: '2024-01-08T00:00:00Z',
  },
  {
    id: 'wf-4',
    name: 'Channel Point Rewards',
    description: 'Manages custom channel point redemptions and their actions.',
    accountId: 'account-1',
    isEnabled: true,
    nodes: [],
    edges: [],
    stats: { runsToday: 89, successRate: 97.8 },
    createdAt: '2024-01-04T00:00:00Z',
    updatedAt: '2024-01-07T00:00:00Z',
  },
  {
    id: 'wf-5',
    name: 'Raid Handler',
    description: 'Welcomes raiders with special messages and scene transitions.',
    accountId: 'account-1',
    isEnabled: false,
    nodes: [],
    edges: [],
    stats: { runsToday: 2, successRate: 50 },
    createdAt: '2024-01-05T00:00:00Z',
    updatedAt: '2024-01-06T00:00:00Z',
  },
  {
    id: 'wf-6',
    name: 'Subscriber Celebration',
    description: 'Special effects and messages for new and recurring subscribers.',
    accountId: 'account-1',
    isEnabled: true,
    nodes: [],
    edges: [],
    stats: { runsToday: 12, successRate: 100 },
    createdAt: '2024-01-06T00:00:00Z',
    updatedAt: '2024-01-05T00:00:00Z',
  },
];

let mockAssets: Asset[] = [
  { id: 'asset-1', name: 'alert-sound.mp3', type: 'audio', mimeType: 'audio/mp3', size: 245000, url: '/assets/alert-sound.mp3', accountId: 'account-1', tags: ['alerts', 'sounds'], createdAt: '2024-01-10T00:00:00Z', updatedAt: '2024-01-10T00:00:00Z' },
  { id: 'asset-2', name: 'follow-animation.webm', type: 'video', mimeType: 'video/webm', size: 1240000, url: '/assets/follow-animation.webm', accountId: 'account-1', tags: ['animations', 'follow'], createdAt: '2024-01-09T00:00:00Z', updatedAt: '2024-01-09T00:00:00Z' },
  { id: 'asset-3', name: 'overlay-frame.png', type: 'image', mimeType: 'image/png', size: 520000, url: '/assets/overlay-frame.png', accountId: 'account-1', tags: ['overlay', 'frame'], createdAt: '2024-01-08T00:00:00Z', updatedAt: '2024-01-08T00:00:00Z' },
  { id: 'asset-4', name: 'donation-chime.wav', type: 'audio', mimeType: 'audio/wav', size: 180000, url: '/assets/donation-chime.wav', accountId: 'account-1', tags: ['donations', 'sounds'], createdAt: '2024-01-07T00:00:00Z', updatedAt: '2024-01-07T00:00:00Z' },
  { id: 'asset-5', name: 'sub-badge-tier1.png', type: 'image', mimeType: 'image/png', size: 45000, url: '/assets/sub-badge-tier1.png', accountId: 'account-1', tags: ['badges', 'subscriber'], createdAt: '2024-01-06T00:00:00Z', updatedAt: '2024-01-06T00:00:00Z' },
  { id: 'asset-6', name: 'sub-badge-tier2.png', type: 'image', mimeType: 'image/png', size: 48000, url: '/assets/sub-badge-tier2.png', accountId: 'account-1', tags: ['badges', 'subscriber'], createdAt: '2024-01-06T00:00:00Z', updatedAt: '2024-01-06T00:00:00Z' },
  { id: 'asset-7', name: 'sub-badge-tier3.png', type: 'image', mimeType: 'image/png', size: 52000, url: '/assets/sub-badge-tier3.png', accountId: 'account-1', tags: ['badges', 'subscriber'], createdAt: '2024-01-06T00:00:00Z', updatedAt: '2024-01-06T00:00:00Z' },
  { id: 'asset-8', name: 'intro-video.mp4', type: 'video', mimeType: 'video/mp4', size: 15240000, url: '/assets/intro-video.mp4', accountId: 'account-1', tags: ['intro', 'video'], createdAt: '2024-01-05T00:00:00Z', updatedAt: '2024-01-05T00:00:00Z' },
  { id: 'asset-9', name: 'background-music.mp3', type: 'audio', mimeType: 'audio/mp3', size: 4500000, url: '/assets/background-music.mp3', accountId: 'account-1', tags: ['music', 'background'], createdAt: '2024-01-04T00:00:00Z', updatedAt: '2024-01-04T00:00:00Z' },
  { id: 'asset-10', name: 'channel-logo.svg', type: 'image', mimeType: 'image/svg+xml', size: 12000, url: '/assets/channel-logo.svg', accountId: 'account-1', tags: ['branding', 'logo'], createdAt: '2024-01-03T00:00:00Z', updatedAt: '2024-01-03T00:00:00Z' },
  { id: 'asset-11', name: 'emote-pack.zip', type: 'other', mimeType: 'application/zip', size: 2400000, url: '/assets/emote-pack.zip', accountId: 'account-1', tags: ['emotes'], createdAt: '2024-01-02T00:00:00Z', updatedAt: '2024-01-02T00:00:00Z' },
  { id: 'asset-12', name: 'custom-font.woff2', type: 'font', mimeType: 'font/woff2', size: 85000, url: '/assets/custom-font.woff2', accountId: 'account-1', tags: ['fonts', 'typography'], createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z' },
];

let mockScenes: Scene[] = [
  {
    id: 'scene-1',
    name: 'Main Overlay',
    description: 'Primary streaming overlay with chat and alerts',
    accountId: 'account-1',
    width: 1920,
    height: 1080,
    backgroundColor: 'transparent',
    widgets: [
      { id: 'w1', type: 'text', name: 'Stream Title', position: { x: 50, y: 50 }, size: { width: 400, height: 60 }, rotation: 0, opacity: 100, zIndex: 3, locked: false, visible: true, properties: { text: 'Welcome to the Stream!', fontSize: 32, fontFamily: 'Inter', color: '#ffffff', align: 'left' } },
      { id: 'w2', type: 'image', name: 'Logo', position: { x: 1720, y: 50 }, size: { width: 150, height: 150 }, rotation: 0, opacity: 100, zIndex: 2, locked: false, visible: true, properties: { src: '/logo.png' } },
      { id: 'w3', type: 'chat', name: 'Chat Widget', position: { x: 1520, y: 600 }, size: { width: 380, height: 400 }, rotation: 0, opacity: 80, zIndex: 1, locked: false, visible: true, properties: {} },
      { id: 'w4', type: 'shape', name: 'Background Box', position: { x: 30, y: 30 }, size: { width: 440, height: 100 }, rotation: 0, opacity: 50, zIndex: 0, locked: false, visible: true, properties: { fill: '#000000', borderRadius: 8 } },
    ],
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-10T00:00:00Z',
  },
  {
    id: 'scene-2',
    name: 'BRB Screen',
    description: 'Be right back screen with countdown',
    accountId: 'account-1',
    width: 1920,
    height: 1080,
    backgroundColor: '#1a1a2e',
    widgets: [],
    createdAt: '2024-01-02T00:00:00Z',
    updatedAt: '2024-01-08T00:00:00Z',
  },
  {
    id: 'scene-3',
    name: 'Starting Soon',
    description: 'Pre-stream countdown screen',
    accountId: 'account-1',
    width: 1920,
    height: 1080,
    backgroundColor: '#16213e',
    widgets: [],
    createdAt: '2024-01-03T00:00:00Z',
    updatedAt: '2024-01-05T00:00:00Z',
  },
];

export class StreamControlApiServer extends RpcTarget implements StreamControlApi {
  async getUser(): Promise<User> {
    return mockUser;
  }

  async getTeams(): Promise<Team[]> {
    return mockTeams;
  }

  async getTeam(id: string): Promise<Team | null> {
    return mockTeams.find(t => t.id === id) || null;
  }

  async getAccounts(teamId?: string): Promise<Account[]> {
    if (teamId) {
      return mockAccounts.filter(a => a.teamId === teamId);
    }
    return mockAccounts;
  }

  async getAccount(id: string): Promise<Account | null> {
    return mockAccounts.find(a => a.id === id) || null;
  }

  async getModules(query?: ModulesQuery): Promise<PaginatedResponse<Module>> {
    let modules = [...mockModules];

    if (query?.category) {
      modules = modules.filter(m => m.category === query.category);
    }
    if (query?.search) {
      const searchLower = query.search.toLowerCase();
      modules = modules.filter(m =>
        m.name.toLowerCase().includes(searchLower) ||
        m.description.toLowerCase().includes(searchLower)
      );
    }
    if (query?.installed) {
      modules = modules.filter(m => m.isInstalled);
    }

    return paginate(modules, query?.page, query?.pageSize);
  }

  async getModule(id: string): Promise<Module | null> {
    return mockModules.find(m => m.id === id) || null;
  }

  async installModule(id: string): Promise<Module> {
    const module = mockModules.find(m => m.id === id);
    if (!module) {
      throw new Error('Module not found');
    }
    module.isInstalled = true;
    module.isEnabled = true;
    module.updatedAt = new Date().toISOString();
    return module;
  }

  async uninstallModule(id: string): Promise<Module> {
    const module = mockModules.find(m => m.id === id);
    if (!module) {
      throw new Error('Module not found');
    }
    module.isInstalled = false;
    module.isEnabled = false;
    module.updatedAt = new Date().toISOString();
    return module;
  }

  async getWorkflows(query?: WorkflowsQuery): Promise<PaginatedResponse<Workflow>> {
    let workflows = [...mockWorkflows];

    if (query?.accountId) {
      workflows = workflows.filter(w => w.accountId === query.accountId);
    }
    if (query?.enabled !== undefined) {
      workflows = workflows.filter(w => w.isEnabled === query.enabled);
    }

    return paginate(workflows, query?.page, query?.pageSize);
  }

  async getWorkflow(id: string): Promise<Workflow | null> {
    return mockWorkflows.find(w => w.id === id) || null;
  }

  async createWorkflow(input: CreateWorkflowInput): Promise<Workflow> {
    const newWorkflow: Workflow = {
      id: `wf-${Date.now()}`,
      name: input.name,
      description: input.description || '',
      accountId: input.accountId,
      isEnabled: input.isEnabled ?? true,
      nodes: input.nodes || [],
      edges: input.edges || [],
      stats: { runsToday: 0, successRate: 100 },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    mockWorkflows.push(newWorkflow);
    return newWorkflow;
  }

  async updateWorkflow(id: string, input: UpdateWorkflowInput): Promise<Workflow | null> {
    const index = mockWorkflows.findIndex(w => w.id === id);
    if (index === -1) {
      return null;
    }
    mockWorkflows[index] = {
      ...mockWorkflows[index],
      ...input,
      updatedAt: new Date().toISOString(),
    };
    return mockWorkflows[index];
  }

  async deleteWorkflow(id: string): Promise<boolean> {
    const index = mockWorkflows.findIndex(w => w.id === id);
    if (index === -1) {
      return false;
    }
    mockWorkflows.splice(index, 1);
    return true;
  }

  async getAssets(query?: AssetsQuery): Promise<PaginatedResponse<Asset>> {
    let assets = [...mockAssets];

    if (query?.accountId) {
      assets = assets.filter(a => a.accountId === query.accountId);
    }
    if (query?.type) {
      assets = assets.filter(a => a.type === query.type);
    }
    if (query?.search) {
      const searchLower = query.search.toLowerCase();
      assets = assets.filter(a =>
        a.name.toLowerCase().includes(searchLower) ||
        a.tags.some(t => t.toLowerCase().includes(searchLower))
      );
    }

    return paginate(assets, query?.page, query?.pageSize);
  }

  async getAsset(id: string): Promise<Asset | null> {
    return mockAssets.find(a => a.id === id) || null;
  }

  async createAsset(input: CreateAssetInput): Promise<Asset> {
    const newAsset: Asset = {
      id: `asset-${Date.now()}`,
      name: input.name,
      type: input.type,
      mimeType: input.mimeType || 'application/octet-stream',
      size: input.size || 0,
      url: `/assets/${input.name}`,
      accountId: 'account-1',
      tags: input.tags || [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    mockAssets.unshift(newAsset);
    return newAsset;
  }

  async deleteAsset(id: string): Promise<boolean> {
    const index = mockAssets.findIndex(a => a.id === id);
    if (index === -1) {
      return false;
    }
    mockAssets.splice(index, 1);
    return true;
  }

  async getScenes(query?: ScenesQuery): Promise<PaginatedResponse<Scene>> {
    let scenes = [...mockScenes];

    if (query?.accountId) {
      scenes = scenes.filter(s => s.accountId === query.accountId);
    }

    return paginate(scenes, query?.page, query?.pageSize);
  }

  async getScene(id: string): Promise<Scene | null> {
    return mockScenes.find(s => s.id === id) || null;
  }

  async createScene(input: CreateSceneInput): Promise<Scene> {
    const newScene: Scene = {
      id: `scene-${Date.now()}`,
      name: input.name,
      description: input.description || '',
      accountId: input.accountId,
      width: input.width || 1920,
      height: input.height || 1080,
      backgroundColor: input.backgroundColor || 'transparent',
      widgets: input.widgets || [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    mockScenes.push(newScene);
    return newScene;
  }

  async updateScene(id: string, input: UpdateSceneInput): Promise<Scene | null> {
    const index = mockScenes.findIndex(s => s.id === id);
    if (index === -1) {
      return null;
    }
    mockScenes[index] = {
      ...mockScenes[index],
      ...input,
      updatedAt: new Date().toISOString(),
    };
    return mockScenes[index];
  }

  async deleteScene(id: string): Promise<boolean> {
    const index = mockScenes.findIndex(s => s.id === id);
    if (index === -1) {
      return false;
    }
    mockScenes.splice(index, 1);
    return true;
  }

  async getDashboardStats(): Promise<DashboardStats> {
    return {
      activeWorkflows: mockWorkflows.filter(w => w.isEnabled).length,
      totalWorkflows: mockWorkflows.length,
      installedModules: mockModules.filter(m => m.isInstalled).length,
      totalModules: mockModules.length,
      totalAssets: mockAssets.length,
      totalAssetsSize: mockAssets.reduce((sum, a) => sum + a.size, 0),
      eventsToday: mockWorkflows.reduce((sum, w) => sum + w.stats.runsToday, 0),
      systemHealth: {
        cpu: 24,
        memory: 68,
        storage: 45,
        apiRateLimit: { used: 1234, total: 10000 },
      },
    };
  }
}
