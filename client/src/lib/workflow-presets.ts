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

export type FieldType = 'number' | 'range' | 'text' | 'select' | 'media' | 'toggle';

export interface ConfigField {
  id: string;
  label: string;
  type: FieldType;
  required?: boolean;
  placeholder?: string;
  unit?: string;
  options?: { value: string; label: string }[];
  min?: number;
  max?: number;
  defaultValue?: any;
  mediaType?: 'image' | 'audio' | 'video';
}

export interface TriggerConfig {
  fields: ConfigField[];
  supportsTiers?: boolean;
  tierLabel?: string;
}

export interface ConfigValue {
  type: 'single' | 'range';
  value?: number;
  min?: number;
  max?: number;
}

export interface TriggerConfigValues {
  [fieldId: string]: string | number | boolean | ConfigValue | null;
}

export interface TriggerPreset {
  id: string;
  name: string;
  description: string;
  icon: LucideIcon;
  category: 'chat' | 'events' | 'time' | 'stream';
  color: string;
  config?: TriggerConfig;
}

export interface ActionPreset {
  id: string;
  name: string;
  description: string;
  icon: LucideIcon;
  category: 'alerts' | 'chat' | 'scene' | 'audio' | 'integration';
  color: string;
  config?: {
    fields: ConfigField[];
  };
}

export interface TierConfig {
  id: string;
  values: TriggerConfigValues;
  action: ActionPreset | null;
  actionConfig: TriggerConfigValues;
}

export const triggerPresets: TriggerPreset[] = [
  {
    id: 'trigger-chat-command',
    name: 'Chat Command',
    description: 'When someone uses a chat command',
    icon: MessageCircle,
    category: 'chat',
    color: 'text-blue-500',
    config: {
      fields: [
        { id: 'command', label: 'Command', type: 'text', required: true, placeholder: '!hello' },
        { id: 'cooldown', label: 'Cooldown', type: 'number', unit: 'seconds', min: 0, max: 3600, defaultValue: 5 },
        { id: 'modOnly', label: 'Mods Only', type: 'toggle', defaultValue: false },
      ],
    },
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
    config: {
      supportsTiers: true,
      tierLabel: 'subs',
      fields: [
        { 
          id: 'amount', 
          label: 'Sub Count', 
          type: 'range', 
          required: true, 
          min: 1, 
          max: 1000,
          defaultValue: { type: 'single', value: 1 },
        },
        { 
          id: 'subTier', 
          label: 'Sub Tier', 
          type: 'select', 
          options: [
            { value: 'any', label: 'Any Tier' },
            { value: 'tier1', label: 'Tier 1' },
            { value: 'tier2', label: 'Tier 2' },
            { value: 'tier3', label: 'Tier 3' },
          ],
          defaultValue: 'any',
        },
      ],
    },
  },
  {
    id: 'trigger-donation',
    name: 'Donation',
    description: 'When someone donates to your channel',
    icon: Heart,
    category: 'events',
    color: 'text-pink-500',
    config: {
      supportsTiers: true,
      tierLabel: 'dollars',
      fields: [
        { 
          id: 'amount', 
          label: 'Amount', 
          type: 'range', 
          required: true,
          unit: '$',
          min: 1, 
          max: 10000,
          defaultValue: { type: 'single', value: 5 },
        },
      ],
    },
  },
  {
    id: 'trigger-cheer',
    name: 'Cheer (Bits)',
    description: 'When someone cheers with bits',
    icon: Gift,
    category: 'events',
    color: 'text-yellow-500',
    config: {
      supportsTiers: true,
      tierLabel: 'bits',
      fields: [
        { 
          id: 'amount', 
          label: 'Bits Amount', 
          type: 'range', 
          required: true,
          min: 1, 
          max: 100000,
          defaultValue: { type: 'single', value: 100 },
        },
      ],
    },
  },
  {
    id: 'trigger-raid',
    name: 'Raid',
    description: 'When another streamer raids your channel',
    icon: Zap,
    category: 'events',
    color: 'text-orange-500',
    config: {
      fields: [
        { 
          id: 'viewers', 
          label: 'Viewer Count', 
          type: 'range',
          min: 1, 
          max: 100000,
          defaultValue: { type: 'single', value: 1 },
        },
      ],
    },
  },
  {
    id: 'trigger-scheduled',
    name: 'Scheduled Time',
    description: 'Run at a specific time or interval',
    icon: Clock,
    category: 'time',
    color: 'text-cyan-500',
    config: {
      fields: [
        { 
          id: 'interval', 
          label: 'Run Every', 
          type: 'number', 
          unit: 'minutes',
          min: 1, 
          max: 1440,
          defaultValue: 30,
        },
      ],
    },
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
    config: {
      fields: [
        { id: 'message', label: 'Alert Message', type: 'text', placeholder: 'Thanks for the support!' },
        { id: 'duration', label: 'Duration', type: 'number', unit: 'seconds', min: 1, max: 30, defaultValue: 5 },
        { id: 'image', label: 'Alert Image', type: 'media', mediaType: 'image' },
      ],
    },
  },
  {
    id: 'action-play-sound',
    name: 'Play Sound',
    description: 'Play a sound effect',
    icon: Volume2,
    category: 'audio',
    color: 'text-green-500',
    config: {
      fields: [
        { id: 'sound', label: 'Sound File', type: 'media', mediaType: 'audio', required: true },
        { id: 'volume', label: 'Volume', type: 'number', unit: '%', min: 0, max: 100, defaultValue: 80 },
      ],
    },
  },
  {
    id: 'action-send-message',
    name: 'Send Chat Message',
    description: 'Send a message to chat',
    icon: Send,
    category: 'chat',
    color: 'text-blue-500',
    config: {
      fields: [
        { id: 'message', label: 'Message', type: 'text', required: true, placeholder: 'Thanks {user}!' },
      ],
    },
  },
  {
    id: 'action-change-scene',
    name: 'Change Scene',
    description: 'Switch to a different scene',
    icon: Image,
    category: 'scene',
    color: 'text-purple-500',
    config: {
      fields: [
        { 
          id: 'scene', 
          label: 'Scene', 
          type: 'select', 
          required: true,
          options: [
            { value: 'main', label: 'Main Scene' },
            { value: 'brb', label: 'BRB Screen' },
            { value: 'starting', label: 'Starting Soon' },
            { value: 'ending', label: 'Stream Ending' },
          ],
        },
      ],
    },
  },
  {
    id: 'action-start-timer',
    name: 'Start Timer',
    description: 'Start a countdown or stopwatch',
    icon: Play,
    category: 'scene',
    color: 'text-cyan-500',
    config: {
      fields: [
        { id: 'duration', label: 'Duration', type: 'number', unit: 'seconds', min: 1, max: 3600, defaultValue: 60 },
        { id: 'message', label: 'Timer Label', type: 'text', placeholder: 'Break time!' },
      ],
    },
  },
  {
    id: 'action-pause-alerts',
    name: 'Pause Alerts',
    description: 'Temporarily pause all alerts',
    icon: Pause,
    category: 'alerts',
    color: 'text-orange-500',
    config: {
      fields: [
        { id: 'duration', label: 'Pause Duration', type: 'number', unit: 'seconds', min: 1, max: 3600, defaultValue: 30 },
      ],
    },
  },
  {
    id: 'action-refresh-widget',
    name: 'Refresh Widget',
    description: 'Refresh a browser source or widget',
    icon: RefreshCw,
    category: 'scene',
    color: 'text-pink-500',
    config: {
      fields: [
        { id: 'widget', label: 'Widget Name', type: 'text', required: true, placeholder: 'Chat Widget' },
      ],
    },
  },
  {
    id: 'action-trigger-integration',
    name: 'Trigger Integration',
    description: 'Send data to an external service',
    icon: Settings,
    category: 'integration',
    color: 'text-gray-500',
    config: {
      fields: [
        { 
          id: 'service', 
          label: 'Service', 
          type: 'select',
          required: true,
          options: [
            { value: 'discord', label: 'Discord Webhook' },
            { value: 'twitter', label: 'Twitter/X' },
            { value: 'obs', label: 'OBS WebSocket' },
          ],
        },
      ],
    },
  },
];

export function getDefaultConfigValues(fields: ConfigField[]): TriggerConfigValues {
  const values: TriggerConfigValues = {};
  fields.forEach(field => {
    if (field.defaultValue !== undefined) {
      values[field.id] = field.defaultValue;
    } else if (field.type === 'range') {
      values[field.id] = { type: 'single', value: field.min || 1 };
    } else if (field.type === 'number') {
      values[field.id] = field.min || 0;
    } else if (field.type === 'toggle') {
      values[field.id] = false;
    } else {
      values[field.id] = '';
    }
  });
  return values;
}

export function formatConfigValue(value: ConfigValue | number | string | boolean | null, unit?: string): string {
  if (value === null || value === undefined) return '';
  
  if (typeof value === 'object' && 'type' in value) {
    const cv = value as ConfigValue;
    if (cv.type === 'single') {
      return `${cv.value}${unit ? ` ${unit}` : ''}`;
    } else {
      return `${cv.min}-${cv.max}${unit ? ` ${unit}` : ''}`;
    }
  }
  
  return `${value}${unit ? ` ${unit}` : ''}`;
}

export function generateWorkflowFromPresets(
  trigger: TriggerPreset,
  action: ActionPreset,
  triggerConfig?: TriggerConfigValues,
  actionConfig?: TriggerConfigValues
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
        config: triggerConfig || {},
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
        config: actionConfig || {},
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

export function generateMultiTierWorkflow(
  trigger: TriggerPreset,
  tiers: TierConfig[]
): { name: string; description: string; nodes: any[]; edges: any[] } {
  const tierLabels = tiers.map(t => {
    const amount = t.values.amount as ConfigValue;
    if (amount?.type === 'range') {
      return `${amount.min}-${amount.max}`;
    }
    return amount?.value?.toString() || '?';
  });
  
  const name = `${trigger.name} Automation (${tierLabels.join(', ')} ${trigger.config?.tierLabel || ''})`;
  const description = `Multi-tier ${trigger.name.toLowerCase()} automation with ${tiers.length} trigger${tiers.length > 1 ? 's' : ''}.`;

  const nodes: any[] = [];
  const edges: any[] = [];
  const ySpacing = 140;

  tiers.forEach((tier, index) => {
    const yPos = 100 + (index * ySpacing);
    const triggerId = `trigger-node-${index}`;
    const actionId = `action-node-${index}`;
    
    const amount = tier.values.amount as ConfigValue;
    const labelSuffix = amount?.type === 'range' 
      ? `${amount.min}-${amount.max} ${trigger.config?.tierLabel || ''}`
      : `${amount?.value || '?'} ${trigger.config?.tierLabel || ''}`;

    nodes.push({
      id: triggerId,
      type: 'trigger',
      position: { x: 100, y: yPos },
      data: {
        label: `${trigger.name} (${labelSuffix})`,
        triggerId: trigger.id,
        category: trigger.category,
        config: tier.values,
      },
    });

    if (tier.action) {
      nodes.push({
        id: actionId,
        type: 'action',
        position: { x: 450, y: yPos },
        data: {
          label: tier.action.name,
          actionId: tier.action.id,
          category: tier.action.category,
          config: tier.actionConfig,
        },
      });

      edges.push({
        id: `edge-${index}`,
        source: triggerId,
        target: actionId,
        type: 'smoothstep',
      });
    }
  });

  return { name, description, nodes, edges };
}
