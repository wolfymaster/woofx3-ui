/**
 * Seed built-in trigger and action definitions.
 *
 * Run via: bunx convex run seeds/triggerActions:seed
 *
 * Idempotent: drops all known built-in slugs then re-inserts them.
 * Any trigger/action not in BUILTIN_TRIGGER_SLUGS / BUILTIN_ACTION_SLUGS
 * (e.g. module-contributed ones) is left untouched.
 */
import { internalMutation } from "../_generated/server";
import { internal } from "../_generated/api";

// ---------------------------------------------------------------------------
// Known built-in slugs — these are the only records managed by this seed.
// DO NOT rename these slugs; they are referenced by existing workflow JSON.
// ---------------------------------------------------------------------------

const BUILTIN_TRIGGER_SLUGS = [
  "trigger-chat-command",
  "trigger-new-follower",
  "trigger-subscription",
  "trigger-donation",
  "trigger-cheer",
  "trigger-raid",
  "trigger-scheduled",
  "trigger-stream-start",
] as const;

const BUILTIN_ACTION_SLUGS = [
  "action-show-alert",
  "action-play-sound",
  "action-send-message",
  "action-change-scene",
  "action-start-timer",
  "action-pause-alerts",
  "action-refresh-widget",
  "action-trigger-integration",
] as const;

// ---------------------------------------------------------------------------
// Built-in trigger definitions
// (mirrors the data previously in client/src/lib/workflow-presets.ts)
// ---------------------------------------------------------------------------

const BUILTIN_TRIGGERS = [
  {
    slug: "trigger-chat-command",
    name: "Chat Command",
    description: "When someone uses a chat command",
    category: "chat",
    color: "text-blue-500",
    icon: "MessageCircle",
    event: "message.user.twitch",
    allowVariants: true,
    configFields: [
      { id: "command", label: "Command", type: "text", required: true, placeholder: "!hello" },
      { id: "cooldown", label: "Cooldown", type: "number", unit: "seconds", min: 0, max: 3600, defaultValue: 5 },
      { id: "modOnly", label: "Mods Only", type: "toggle", defaultValue: false },
    ],
  },
  {
    slug: "trigger-new-follower",
    name: "New Follower",
    description: "When someone follows your channel",
    category: "events",
    color: "text-green-500",
    icon: "UserPlus",
    event: "follow.user.twitch",
  },
  {
    slug: "trigger-subscription",
    name: "Subscription",
    description: "When someone subscribes or resubscribes",
    category: "events",
    color: "text-purple-500",
    icon: "Star",
    event: "subscribe.user.twitch",
    supportsTiers: true,
    tierLabel: "subs",
    configFields: [
      {
        id: "amount",
        label: "Sub Count",
        type: "range",
        required: true,
        min: 1,
        max: 1000,
        defaultValue: { type: "single", value: 1 },
      },
      {
        id: "subTier",
        label: "Sub Tier",
        type: "select",
        options: [
          { value: "any", label: "Any Tier" },
          { value: "tier1", label: "Tier 1" },
          { value: "tier2", label: "Tier 2" },
          { value: "tier3", label: "Tier 3" },
        ],
        defaultValue: "any",
      },
    ],
  },
  {
    slug: "trigger-donation",
    name: "Donation",
    description: "When someone donates to your channel",
    category: "events",
    color: "text-pink-500",
    icon: "Heart",
    supportsTiers: true,
    tierLabel: "dollars",
    configFields: [
      {
        id: "amount",
        label: "Amount",
        type: "range",
        required: true,
        unit: "$",
        min: 1,
        max: 10000,
        defaultValue: { type: "single", value: 5 },
      },
    ],
  },
  {
    slug: "trigger-cheer",
    name: "Cheer (Bits)",
    description: "When someone cheers with bits",
    category: "events",
    color: "text-yellow-500",
    icon: "Gift",
    event: "cheer.user.twitch",
    supportsTiers: true,
    tierLabel: "bits",
    configFields: [
      {
        id: "amount",
        label: "Bits Amount",
        type: "range",
        required: true,
        min: 1,
        max: 100000,
        defaultValue: { type: "single", value: 100 },
      },
    ],
  },
  {
    slug: "trigger-raid",
    name: "Raid",
    description: "When another streamer raids your channel",
    category: "events",
    color: "text-orange-500",
    icon: "Zap",
    configFields: [
      {
        id: "viewers",
        label: "Viewer Count",
        type: "range",
        min: 1,
        max: 100000,
        defaultValue: { type: "single", value: 1 },
      },
    ],
  },
  {
    slug: "trigger-scheduled",
    name: "Scheduled Time",
    description: "Run at a specific time or interval",
    category: "time",
    color: "text-cyan-500",
    icon: "Clock",
    configFields: [
      {
        id: "interval",
        label: "Run Every",
        type: "number",
        unit: "minutes",
        min: 1,
        max: 1440,
        defaultValue: 30,
      },
    ],
  },
  {
    slug: "trigger-stream-start",
    name: "Stream Start",
    description: "When you go live",
    category: "stream",
    color: "text-red-500",
    icon: "Radio",
    event: "online.user.twitch",
  },
];

// ---------------------------------------------------------------------------
// Built-in action definitions
// ---------------------------------------------------------------------------

const BUILTIN_ACTIONS = [
  {
    slug: "action-show-alert",
    name: "Show Alert",
    description: "Display an on-screen alert overlay",
    category: "alerts",
    color: "text-yellow-500",
    icon: "Bell",
    configFields: [
      { id: "message", label: "Alert Message", type: "text", placeholder: "Thanks for the support!" },
      { id: "duration", label: "Duration", type: "number", unit: "seconds", min: 1, max: 30, defaultValue: 5 },
      { id: "media", label: "Media", type: "media-list" },
    ],
  },
  {
    slug: "action-play-sound",
    name: "Play Sound",
    description: "Play a sound effect",
    category: "audio",
    color: "text-green-500",
    icon: "Volume2",
    configFields: [
      { id: "sound", label: "Sound File", type: "media", mediaType: "audio", required: true },
      { id: "volume", label: "Volume", type: "number", unit: "%", min: 0, max: 100, defaultValue: 80 },
    ],
  },
  {
    slug: "action-send-message",
    name: "Send Chat Message",
    description: "Send a message to chat",
    category: "chat",
    color: "text-blue-500",
    icon: "Send",
    configFields: [
      { id: "message", label: "Message", type: "text", required: true, placeholder: "Thanks {user}!" },
    ],
  },
  {
    slug: "action-change-scene",
    name: "Change Scene",
    description: "Switch to a different scene",
    category: "scene",
    color: "text-purple-500",
    icon: "Image",
    configFields: [
      {
        id: "scene",
        label: "Scene",
        type: "select",
        required: true,
        options: [
          { value: "main", label: "Main Scene" },
          { value: "brb", label: "BRB Screen" },
          { value: "starting", label: "Starting Soon" },
          { value: "ending", label: "Stream Ending" },
        ],
      },
    ],
  },
  {
    slug: "action-start-timer",
    name: "Start Timer",
    description: "Start a countdown or stopwatch",
    category: "scene",
    color: "text-cyan-500",
    icon: "Play",
    configFields: [
      { id: "duration", label: "Duration", type: "number", unit: "seconds", min: 1, max: 3600, defaultValue: 60 },
      { id: "message", label: "Timer Label", type: "text", placeholder: "Break time!" },
    ],
  },
  {
    slug: "action-pause-alerts",
    name: "Pause Alerts",
    description: "Temporarily pause all alerts",
    category: "alerts",
    color: "text-orange-500",
    icon: "Pause",
    configFields: [
      { id: "duration", label: "Pause Duration", type: "number", unit: "seconds", min: 1, max: 3600, defaultValue: 30 },
    ],
  },
  {
    slug: "action-refresh-widget",
    name: "Refresh Widget",
    description: "Refresh a browser source or widget",
    category: "scene",
    color: "text-pink-500",
    icon: "RefreshCw",
    configFields: [
      { id: "widget", label: "Widget Name", type: "text", required: true, placeholder: "Chat Widget" },
    ],
  },
  {
    slug: "action-trigger-integration",
    name: "Trigger Integration",
    description: "Send data to an external service",
    category: "integration",
    color: "text-gray-500",
    icon: "Settings",
    configFields: [
      {
        id: "service",
        label: "Service",
        type: "select",
        required: true,
        options: [
          { value: "discord", label: "Discord Webhook" },
          { value: "twitter", label: "Twitter/X" },
          { value: "obs", label: "OBS WebSocket" },
        ],
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Seed mutation
// ---------------------------------------------------------------------------

export const seed = internalMutation({
  args: {},
  handler: async (ctx) => {
    // Drop all known built-in triggers then re-insert
    for (const slug of BUILTIN_TRIGGER_SLUGS) {
      await ctx.runMutation(internal.triggerDefinitions.removeBySlug, { slug });
    }
    for (const trigger of BUILTIN_TRIGGERS) {
      await ctx.runMutation(internal.triggerDefinitions.upsert, trigger);
    }

    // Drop all known built-in actions then re-insert
    for (const slug of BUILTIN_ACTION_SLUGS) {
      await ctx.runMutation(internal.actionDefinitions.removeBySlug, { slug });
    }
    for (const action of BUILTIN_ACTIONS) {
      await ctx.runMutation(internal.actionDefinitions.upsert, action);
    }

    return {
      triggers: BUILTIN_TRIGGERS.length,
      actions: BUILTIN_ACTIONS.length,
    };
  },
});
