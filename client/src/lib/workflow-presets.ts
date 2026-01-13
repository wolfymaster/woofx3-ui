import { 
  MessageCircle, 
  UserPlus, 
  Star, 
  Gift, 
  Zap, 
  Heart,
  Clock,
  Radio,
  Bell,
  Volume2,
  Image,
  Send,
  Play,
  Pause,
  RefreshCw,
  Settings,
  type LucideIcon
} from 'lucide-react';

export interface ThresholdConfig {
  value: number;
  label: string;
}

export interface TriggerPreset {
  id: string;
  name: string;
  description: string;
  icon: LucideIcon;
  category: 'chat' | 'events' | 'time' | 'stream';
  color: string;
  hasThresholds?: boolean;
  thresholdUnit?: string;
  suggestedThresholds?: number[];
}

export interface ThresholdAction {
  threshold: number;
  action: ActionPreset;
}

export interface ActionPreset {
  id: string;
  name: string;
  description: string;
  icon: LucideIcon;
  category: 'alerts' | 'chat' | 'scene' | 'audio' | 'integration';
  color: string;
}

export const triggerPresets: TriggerPreset[] = [
  {
    id: 'trigger-chat-command',
    name: 'Chat Command',
    description: 'When someone uses a chat command',
    icon: MessageCircle,
    category: 'chat',
    color: 'text-blue-500',
  },
  {
    id: 'trigger-new-follower',
    name: 'New Follower',
    description: 'When someone follows your channel',
    icon: UserPlus,
    category: 'events',
    color: 'text-green-500',
  },
  {
    id: 'trigger-subscription',
    name: 'Subscription',
    description: 'When someone subscribes or resubscribes',
    icon: Star,
    category: 'events',
    color: 'text-purple-500',
    hasThresholds: true,
    thresholdUnit: 'subs',
    suggestedThresholds: [1, 5, 10, 25, 50, 100],
  },
  {
    id: 'trigger-donation',
    name: 'Donation',
    description: 'When someone donates to your channel',
    icon: Heart,
    category: 'events',
    color: 'text-pink-500',
    hasThresholds: true,
    thresholdUnit: 'dollars',
    suggestedThresholds: [5, 10, 25, 50, 100],
  },
  {
    id: 'trigger-cheer',
    name: 'Cheer (Bits)',
    description: 'When someone cheers with bits',
    icon: Gift,
    category: 'events',
    color: 'text-yellow-500',
    hasThresholds: true,
    thresholdUnit: 'bits',
    suggestedThresholds: [100, 500, 1000, 5000, 10000],
  },
  {
    id: 'trigger-raid',
    name: 'Raid',
    description: 'When another streamer raids your channel',
    icon: Zap,
    category: 'events',
    color: 'text-orange-500',
  },
  {
    id: 'trigger-scheduled',
    name: 'Scheduled Time',
    description: 'Run at a specific time or interval',
    icon: Clock,
    category: 'time',
    color: 'text-cyan-500',
  },
  {
    id: 'trigger-stream-start',
    name: 'Stream Start',
    description: 'When you go live',
    icon: Radio,
    category: 'stream',
    color: 'text-red-500',
  },
];

export const actionPresets: ActionPreset[] = [
  {
    id: 'action-show-alert',
    name: 'Show Alert',
    description: 'Display an on-screen alert overlay',
    icon: Bell,
    category: 'alerts',
    color: 'text-yellow-500',
  },
  {
    id: 'action-play-sound',
    name: 'Play Sound',
    description: 'Play a sound effect',
    icon: Volume2,
    category: 'audio',
    color: 'text-green-500',
  },
  {
    id: 'action-send-message',
    name: 'Send Chat Message',
    description: 'Send a message to chat',
    icon: Send,
    category: 'chat',
    color: 'text-blue-500',
  },
  {
    id: 'action-change-scene',
    name: 'Change Scene',
    description: 'Switch to a different scene',
    icon: Image,
    category: 'scene',
    color: 'text-purple-500',
  },
  {
    id: 'action-start-timer',
    name: 'Start Timer',
    description: 'Start a countdown or stopwatch',
    icon: Play,
    category: 'scene',
    color: 'text-cyan-500',
  },
  {
    id: 'action-pause-alerts',
    name: 'Pause Alerts',
    description: 'Temporarily pause all alerts',
    icon: Pause,
    category: 'alerts',
    color: 'text-orange-500',
  },
  {
    id: 'action-refresh-widget',
    name: 'Refresh Widget',
    description: 'Refresh a browser source or widget',
    icon: RefreshCw,
    category: 'scene',
    color: 'text-pink-500',
  },
  {
    id: 'action-trigger-integration',
    name: 'Trigger Integration',
    description: 'Send data to an external service',
    icon: Settings,
    category: 'integration',
    color: 'text-gray-500',
  },
];

export function generateWorkflowFromPresets(
  trigger: TriggerPreset,
  action: ActionPreset
): { name: string; description: string; nodes: any[]; edges: any[] } {
  const name = `${trigger.name} → ${action.name}`;
  const description = `When ${trigger.description.toLowerCase()}, ${action.description.toLowerCase()}.`;

  const nodes = [
    {
      id: 'trigger-node',
      type: 'trigger',
      position: { x: 100, y: 100 },
      data: { 
        label: trigger.name, 
        triggerId: trigger.id,
        category: trigger.category,
      },
    },
    {
      id: 'action-node',
      type: 'action',
      position: { x: 400, y: 100 },
      data: { 
        label: action.name, 
        actionId: action.id,
        category: action.category,
      },
    },
  ];

  const edges = [
    {
      id: 'edge-1',
      source: 'trigger-node',
      target: 'action-node',
      type: 'smoothstep',
    },
  ];

  return { name, description, nodes, edges };
}

export function generateMultiThresholdWorkflow(
  trigger: TriggerPreset,
  thresholdActions: ThresholdAction[]
): { name: string; description: string; nodes: any[]; edges: any[] } {
  const thresholdValues = thresholdActions.map(ta => ta.threshold).sort((a, b) => a - b);
  const name = `${trigger.name} Automation (${thresholdValues.join(', ')} ${trigger.thresholdUnit || ''})`;
  const description = `Multi-tier ${trigger.name.toLowerCase()} automation with ${thresholdActions.length} trigger${thresholdActions.length > 1 ? 's' : ''}.`;

  const nodes: any[] = [];
  const edges: any[] = [];
  const ySpacing = 120;

  thresholdActions.forEach((ta, index) => {
    const yPos = 100 + (index * ySpacing);
    const triggerId = `trigger-node-${index}`;
    const actionId = `action-node-${index}`;

    nodes.push({
      id: triggerId,
      type: 'trigger',
      position: { x: 100, y: yPos },
      data: {
        label: `${trigger.name} (${ta.threshold} ${trigger.thresholdUnit || ''})`,
        triggerId: trigger.id,
        category: trigger.category,
        threshold: ta.threshold,
        thresholdUnit: trigger.thresholdUnit,
      },
    });

    nodes.push({
      id: actionId,
      type: 'action',
      position: { x: 450, y: yPos },
      data: {
        label: ta.action.name,
        actionId: ta.action.id,
        category: ta.action.category,
      },
    });

    edges.push({
      id: `edge-${index}`,
      source: triggerId,
      target: actionId,
      type: 'smoothstep',
    });
  });

  return { name, description, nodes, edges };
}
