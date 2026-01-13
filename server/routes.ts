import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";

interface PaginatedResponse<T> {
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

function paginate<T>(items: T[], page: number, pageSize: number): PaginatedResponse<T> {
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

const mockUser = {
  id: 'user-1',
  email: 'alex@streamcontrol.io',
  displayName: 'Alex Chen',
  role: 'owner',
  teamIds: ['team-1'],
  accountIds: ['account-1', 'account-2'],
  createdAt: '2024-01-01T00:00:00Z',
};

const mockTeams = [
  { id: 'team-1', name: 'Demo Team', slug: 'demo-team', ownerId: 'user-1', createdAt: '2024-01-01T00:00:00Z' },
  { id: 'team-2', name: 'Production Team', slug: 'production-team', ownerId: 'user-1', createdAt: '2024-01-15T00:00:00Z' },
];

const mockAccounts = [
  { id: 'account-1', name: 'Main Channel', slug: 'main-channel', teamId: 'team-1', createdAt: '2024-01-01T00:00:00Z' },
  { id: 'account-2', name: 'Gaming Channel', slug: 'gaming-channel', teamId: 'team-1', createdAt: '2024-01-05T00:00:00Z' },
];

let mockModules = [
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

let mockWorkflows = [
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

let mockAssets = [
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

let mockScenes = [
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

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  app.get('/api/user', (req: Request, res: Response) => {
    res.json(mockUser);
  });

  app.get('/api/teams', (req: Request, res: Response) => {
    res.json(mockTeams);
  });

  app.get('/api/teams/:id', (req: Request, res: Response) => {
    const team = mockTeams.find(t => t.id === req.params.id);
    if (!team) {
      return res.status(404).json({ code: 'NOT_FOUND', message: 'Team not found' });
    }
    res.json(team);
  });

  app.get('/api/accounts', (req: Request, res: Response) => {
    const { teamId } = req.query;
    let accounts = mockAccounts;
    if (teamId) {
      accounts = accounts.filter(a => a.teamId === teamId);
    }
    res.json(accounts);
  });

  app.get('/api/accounts/:id', (req: Request, res: Response) => {
    const account = mockAccounts.find(a => a.id === req.params.id);
    if (!account) {
      return res.status(404).json({ code: 'NOT_FOUND', message: 'Account not found' });
    }
    res.json(account);
  });

  app.get('/api/modules', (req: Request, res: Response) => {
    const { page = '1', pageSize = '20', category, search, installed } = req.query;
    let modules = [...mockModules];

    if (category) {
      modules = modules.filter(m => m.category === category);
    }
    if (search) {
      const query = String(search).toLowerCase();
      modules = modules.filter(m =>
        m.name.toLowerCase().includes(query) ||
        m.description.toLowerCase().includes(query)
      );
    }
    if (installed === 'true') {
      modules = modules.filter(m => m.isInstalled);
    }

    res.json(paginate(modules, parseInt(page as string), parseInt(pageSize as string)));
  });

  app.get('/api/modules/:id', (req: Request, res: Response) => {
    const module = mockModules.find(m => m.id === req.params.id);
    if (!module) {
      return res.status(404).json({ code: 'NOT_FOUND', message: 'Module not found' });
    }
    res.json(module);
  });

  app.post('/api/modules/:id/install', (req: Request, res: Response) => {
    const module = mockModules.find(m => m.id === req.params.id);
    if (!module) {
      return res.status(404).json({ code: 'NOT_FOUND', message: 'Module not found' });
    }
    module.isInstalled = true;
    module.isEnabled = true;
    module.updatedAt = new Date().toISOString();
    res.json(module);
  });

  app.post('/api/modules/:id/uninstall', (req: Request, res: Response) => {
    const module = mockModules.find(m => m.id === req.params.id);
    if (!module) {
      return res.status(404).json({ code: 'NOT_FOUND', message: 'Module not found' });
    }
    module.isInstalled = false;
    module.isEnabled = false;
    module.updatedAt = new Date().toISOString();
    res.json(module);
  });

  app.get('/api/workflows', (req: Request, res: Response) => {
    const { page = '1', pageSize = '20', accountId, enabled } = req.query;
    let workflows = [...mockWorkflows];

    if (accountId) {
      workflows = workflows.filter(w => w.accountId === accountId);
    }
    if (enabled === 'true') {
      workflows = workflows.filter(w => w.isEnabled);
    } else if (enabled === 'false') {
      workflows = workflows.filter(w => !w.isEnabled);
    }

    res.json(paginate(workflows, parseInt(page as string), parseInt(pageSize as string)));
  });

  app.get('/api/workflows/:id', (req: Request, res: Response) => {
    const workflow = mockWorkflows.find(w => w.id === req.params.id);
    if (!workflow) {
      return res.status(404).json({ code: 'NOT_FOUND', message: 'Workflow not found' });
    }
    res.json(workflow);
  });

  app.post('/api/workflows', (req: Request, res: Response) => {
    const newWorkflow = {
      id: `wf-${Date.now()}`,
      ...req.body,
      nodes: req.body.nodes || [],
      edges: req.body.edges || [],
      stats: { runsToday: 0, successRate: 100 },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    mockWorkflows.push(newWorkflow);
    res.status(201).json(newWorkflow);
  });

  app.patch('/api/workflows/:id', (req: Request, res: Response) => {
    const index = mockWorkflows.findIndex(w => w.id === req.params.id);
    if (index === -1) {
      return res.status(404).json({ code: 'NOT_FOUND', message: 'Workflow not found' });
    }
    mockWorkflows[index] = {
      ...mockWorkflows[index],
      ...req.body,
      updatedAt: new Date().toISOString(),
    };
    res.json(mockWorkflows[index]);
  });

  app.delete('/api/workflows/:id', (req: Request, res: Response) => {
    const index = mockWorkflows.findIndex(w => w.id === req.params.id);
    if (index === -1) {
      return res.status(404).json({ code: 'NOT_FOUND', message: 'Workflow not found' });
    }
    mockWorkflows.splice(index, 1);
    res.status(204).send();
  });

  app.get('/api/assets', (req: Request, res: Response) => {
    const { page = '1', pageSize = '20', accountId, type, search } = req.query;
    let assets = [...mockAssets];

    if (accountId) {
      assets = assets.filter(a => a.accountId === accountId);
    }
    if (type) {
      assets = assets.filter(a => a.type === type);
    }
    if (search) {
      const query = String(search).toLowerCase();
      assets = assets.filter(a =>
        a.name.toLowerCase().includes(query) ||
        a.tags.some(t => t.toLowerCase().includes(query))
      );
    }

    res.json(paginate(assets, parseInt(page as string), parseInt(pageSize as string)));
  });

  app.get('/api/assets/:id', (req: Request, res: Response) => {
    const asset = mockAssets.find(a => a.id === req.params.id);
    if (!asset) {
      return res.status(404).json({ code: 'NOT_FOUND', message: 'Asset not found' });
    }
    res.json(asset);
  });

  app.delete('/api/assets/:id', (req: Request, res: Response) => {
    const index = mockAssets.findIndex(a => a.id === req.params.id);
    if (index === -1) {
      return res.status(404).json({ code: 'NOT_FOUND', message: 'Asset not found' });
    }
    mockAssets.splice(index, 1);
    res.status(204).send();
  });

  app.post('/api/assets', (req: Request, res: Response) => {
    const { name, type, mimeType, size, tags = [] } = req.body;
    if (!name || !type) {
      return res.status(400).json({ code: 'BAD_REQUEST', message: 'Name and type are required' });
    }
    const newAsset = {
      id: `asset-${Date.now()}`,
      name,
      type,
      mimeType: mimeType || 'application/octet-stream',
      size: size || 0,
      url: `/assets/${name}`,
      accountId: 'account-1',
      tags,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    mockAssets.unshift(newAsset);
    res.status(201).json(newAsset);
  });

  app.get('/api/scenes', (req: Request, res: Response) => {
    const { page = '1', pageSize = '20', accountId } = req.query;
    let scenes = [...mockScenes];

    if (accountId) {
      scenes = scenes.filter(s => s.accountId === accountId);
    }

    res.json(paginate(scenes, parseInt(page as string), parseInt(pageSize as string)));
  });

  app.get('/api/scenes/:id', (req: Request, res: Response) => {
    const scene = mockScenes.find(s => s.id === req.params.id);
    if (!scene) {
      return res.status(404).json({ code: 'NOT_FOUND', message: 'Scene not found' });
    }
    res.json(scene);
  });

  app.post('/api/scenes', (req: Request, res: Response) => {
    const newScene = {
      id: `scene-${Date.now()}`,
      ...req.body,
      widgets: req.body.widgets || [],
      width: req.body.width || 1920,
      height: req.body.height || 1080,
      backgroundColor: req.body.backgroundColor || 'transparent',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    mockScenes.push(newScene);
    res.status(201).json(newScene);
  });

  app.patch('/api/scenes/:id', (req: Request, res: Response) => {
    const index = mockScenes.findIndex(s => s.id === req.params.id);
    if (index === -1) {
      return res.status(404).json({ code: 'NOT_FOUND', message: 'Scene not found' });
    }
    mockScenes[index] = {
      ...mockScenes[index],
      ...req.body,
      updatedAt: new Date().toISOString(),
    };
    res.json(mockScenes[index]);
  });

  app.delete('/api/scenes/:id', (req: Request, res: Response) => {
    const index = mockScenes.findIndex(s => s.id === req.params.id);
    if (index === -1) {
      return res.status(404).json({ code: 'NOT_FOUND', message: 'Scene not found' });
    }
    mockScenes.splice(index, 1);
    res.status(204).send();
  });

  app.get('/api/stats/dashboard', (req: Request, res: Response) => {
    res.json({
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
    });
  });

  return httpServer;
}
