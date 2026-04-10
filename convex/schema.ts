import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  ...authTables,

  // accounts: tenant/organization level
  accounts: defineTable({
    name: v.string(),
    ownerId: v.id("users"),
    createdAt: v.number(),
  }).index("by_owner", ["ownerId"]),

  // instances: a single woofx3 deployment
  instances: defineTable({
    accountId: v.id("accounts"),
    name: v.string(),
    url: v.string(), // user-configured (e.g. "localhost:8080" or "https://...")
    applicationId: v.string(), // UUID identifying this woofx3 instance
    createdAt: v.number(),
    // Optional per-instance storage provider override (falls back to STORAGE_PROVIDER env var)
    storageProvider: v.optional(v.union(v.literal("convex"), v.literal("r2"), v.literal("local"))),
  }).index("by_account", ["accountId"]),

  // instanceMembers: users who have access to an instance
  instanceMembers: defineTable({
    instanceId: v.id("instances"),
    userId: v.id("users"),
    role: v.union(v.literal("owner"), v.literal("admin"), v.literal("member")),
  })
    .index("by_user", ["userId"])
    .index("by_instance", ["instanceId"]),

  // platformLinks: OAuth tokens for streaming platforms (Twitch, etc.) per instance
  platformLinks: defineTable({
    instanceId: v.id("instances"),
    platform: v.string(), // "twitch" | future platforms
    platformUserId: v.string(),
    platformUsername: v.string(),
    channelId: v.string(),
    accessToken: v.string(),
    refreshToken: v.string(),
    expiresAt: v.number(),
    scopes: v.array(v.string()),
  }).index("by_instance", ["instanceId"]),

  // folders: virtual organizational folders for assets per instance
  folders: defineTable({
    instanceId: v.id("instances"),
    name: v.string(),
    parentId: v.optional(v.id("folders")),
    createdAt: v.number(),
    createdBy: v.id("users"),
  }).index("by_instance", ["instanceId"]),

  // assets: uploaded files (images/audio/video) — supports multiple storage backends
  assets: defineTable({
    instanceId: v.id("instances"),
    name: v.string(),
    type: v.union(v.literal("image"), v.literal("audio"), v.literal("video")),
    // Virtual folder this asset belongs to (null/absent = root)
    folderId: v.optional(v.id("folders")),
    // Legacy field — present only on records created before the adapter migration.
    // Run convex/migrations/backfillAssetKeys to populate fileKey/storageProvider
    // on these records, then this field can be removed.
    storageId: v.optional(v.id("_storage")),
    // Provider-agnostic file key (storageId string for Convex, object key for R2/local)
    fileKey: v.optional(v.string()),
    // Which storage backend holds this file
    storageProvider: v.optional(v.union(v.literal("convex"), v.literal("r2"), v.literal("local"))),
    mimeType: v.string(),
    size: v.number(),
    createdAt: v.number(),
    createdBy: v.id("users"),
  }).index("by_instance", ["instanceId"]),

  // chatCommands: chat commands configured per instance
  chatCommands: defineTable({
    instanceId: v.id("instances"),
    command: v.string(), // e.g. "!hello"
    type: v.union(
      v.literal("static"), // fixed text response
      v.literal("dynamic"), // template with {{variable}} substitution
      v.literal("function") // invokes a module function
    ),
    response: v.optional(v.string()), // for static type
    template: v.optional(v.string()), // for dynamic type ({{username}}, {{args}}, etc.)
    functionId: v.optional(v.string()), // for function type (module function reference)
    cooldown: v.number(), // seconds between uses
    enabled: v.boolean(),
    createdAt: v.number(),
  }).index("by_instance", ["instanceId"]),

  // moduleRepository: directory of all available modules (seeded by admins or uploaded)
  moduleRepository: defineTable({
    instanceId: v.optional(v.id("instances")),
    name: v.string(),
    description: v.string(),
    version: v.string(),
    tags: v.array(v.string()),
    manifest: v.any(),
    archiveKey: v.string(),
    status: v.optional(
      v.union(
        v.literal("pending"),
        v.literal("delivering"),
        v.literal("installed"),
        v.literal("failed"),
      ),
    ),
    statusMessage: v.optional(v.string()),
  }).index("by_instance", ["instanceId"]),

  // dashboardLayouts: dashboard widget configuration per user/instance
  dashboardLayouts: defineTable({
    instanceId: v.id("instances"),
    userId: v.id("users"),
    modules: v.array(
      v.object({
        id: v.string(),
        type: v.string(),
        title: v.string(),
        config: v.optional(v.any()),
      })
    ),
  }).index("by_instance_user", ["instanceId", "userId"]),

  // triggerDefinitions: UI metadata only; at most one row per stable trigger id (matches engine / module id)
  triggerDefinitions: defineTable({
    slug: v.string(), // stable id, e.g. twitch.channel.follow (namespaced by module)
    name: v.string(),
    description: v.string(),
    category: v.string(),
    color: v.string(),
    icon: v.string(),
    event: v.optional(v.string()),
    allowVariants: v.optional(v.boolean()),
    configFields: v.optional(v.array(v.any())),
    supportsTiers: v.optional(v.boolean()),
    tierLabel: v.optional(v.string()),
    moduleId: v.optional(v.id("moduleRepository")),
  })
    .index("by_slug", ["slug"])
    .index("by_module", ["moduleId"]),

  // actionDefinitions: UI metadata only; at most one row per stable action id
  actionDefinitions: defineTable({
    slug: v.string(),
    name: v.string(),
    description: v.string(),
    category: v.string(),
    color: v.string(),
    icon: v.string(),
    configFields: v.optional(v.array(v.any())),
    moduleId: v.optional(v.id("moduleRepository")),
  })
    .index("by_slug", ["slug"])
    .index("by_module", ["moduleId"]),

  // instanceEnabledTriggers: which trigger ids are enabled for a given instance (module lifecycle)
  instanceEnabledTriggers: defineTable({
    instanceId: v.id("instances"),
    triggerId: v.string(),
  })
    .index("by_instance", ["instanceId"])
    .index("by_instance_trigger", ["instanceId", "triggerId"]),

  // instanceEnabledActions: which action ids are enabled for a given instance
  instanceEnabledActions: defineTable({
    instanceId: v.id("instances"),
    actionId: v.string(),
  })
    .index("by_instance", ["instanceId"])
    .index("by_instance_action", ["instanceId", "actionId"]),

  // workflowTemplates: predefined workflow templates for common Twitch events
  workflowTemplates: defineTable({
    name: v.string(),
    description: v.string(),
    trigger: v.string(), // "follow" | "subscribe" | "bits" | "raid" | "gift"
    workflowJson: v.any(),
  }),

  // workflows: UI workflow state per instance (nodes/edges for visual editor)
  workflows: defineTable({
    instanceId: v.id("instances"),
    engineWorkflowId: v.optional(v.string()), // ID from woofx3 engine after sync
    name: v.string(),
    description: v.optional(v.string()),
    isEnabled: v.boolean(),
    nodes: v.array(v.any()), // ReactFlow node objects
    edges: v.array(v.any()), // ReactFlow edge objects
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_instance", ["instanceId"])
    .index("by_engine_id", ["engineWorkflowId"]),

  // twitchOAuthState: short-lived CSRF state for Twitch OAuth flow
  twitchOAuthState: defineTable({
    state: v.string(),
    redirectTo: v.string(),
    createdAt: v.number(),
  }).index("by_state", ["state"]),

  // twitchPendingAuth: one-time token bridging Convex HTTP callback → frontend signIn
  twitchPendingAuth: defineTable({
    token: v.string(),
    twitchId: v.string(),
    displayName: v.string(),
    email: v.string(),
    profileImage: v.string(),
    createdAt: v.number(),
  }).index("by_token", ["token"]),

  // licenses: entitlements per account
  licenses: defineTable({
    accountId: v.id("accounts"),
    tier: v.union(v.literal("free"), v.literal("pro"), v.literal("enterprise")),
    features: v.array(v.string()),
    expiresAt: v.optional(v.number()),
    createdAt: v.number(),
  }).index("by_account", ["accountId"]),

  // scenes: scene configurations for browser sources
  scenes: defineTable({
    instanceId: v.id("instances"),
    name: v.string(),
    description: v.optional(v.string()),
    width: v.number(),
    height: v.number(),
    backgroundColor: v.string(),
    widgets: v.optional(v.array(v.any())), // Widget[] — visual layer state
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_instance", ["instanceId"]),

  // sceneSlots: named slots within a scene
  sceneSlots: defineTable({
    sceneId: v.id("scenes"),
    name: v.string(),
    positionX: v.number(),
    positionY: v.number(),
    width: v.number(),
    height: v.number(),
    queueMode: v.union(v.literal("stack"), v.literal("concurrent"), v.literal("interrupt")),
    createdAt: v.number(),
  }).index("by_scene", ["sceneId"]),

  // browserSourceKeys: unique opaque keys for browser sources
  browserSourceKeys: defineTable({
    instanceId: v.id("instances"),
    sceneId: v.id("scenes"),
    key: v.string(),
    name: v.string(),
    createdAt: v.number(),
    lastUsedAt: v.optional(v.number()),
  })
    .index("by_instance", ["instanceId"])
    .index("by_key", ["key"])
    .index("by_scene", ["sceneId"]),

  // alertDescriptors: alert type configuration per slot
  alertDescriptors: defineTable({
    sceneId: v.id("scenes"),
    slotId: v.id("sceneSlots"),
    alertType: v.optional(v.string()), // legacy field, use alertTypes instead
    alertTypes: v.optional(v.array(v.string())), // ["*"] = all, or specific types like ["follow", "subscription"]
    priority: v.number(),
    ttl: v.number(),
    duration: v.number(),
    layers: v.array(
      v.object({
        type: v.union(
          v.literal("text"),
          v.literal("image"),
          v.literal("video"),
          v.literal("audio"),
          v.literal("lottie")
        ),
        content: v.string(),
        style: v.record(v.string(), v.string()),
        assetUrl: v.optional(v.string()),
        animationIn: v.optional(v.string()),
        animationOut: v.optional(v.string()),
        volume: v.optional(v.number()),
      })
    ),
    hooks: v.optional(
      v.object({
        onRender: v.optional(v.string()),
        onComplete: v.optional(v.string()),
        onError: v.optional(v.string()),
      })
    ),
    enabled: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_scene", ["sceneId"]),

  // moduleWidgets: registered widgets from module manifests
  moduleWidgets: defineTable({
    moduleId: v.id("moduleRepository"),
    widgetId: v.string(),
    name: v.string(),
    directory: v.string(),
    description: v.optional(v.string()),
    alertTypes: v.array(v.string()),
    settings: v.array(
      v.object({
        key: v.string(),
        fieldType: v.string(),
        label: v.string(),
        defaultValue: v.any(),
        options: v.optional(
          v.array(
            v.object({
              label: v.string(),
              value: v.string(),
            })
          )
        ),
      })
    ),
    createdAt: v.number(),
  })
    .index("by_module", ["moduleId"])
    .index("by_widget_id", ["widgetId"]),

  // alerts: pending/complete alert queue
  alerts: defineTable({
    instanceId: v.id("instances"),
    sceneId: v.id("scenes"),
    sourceKey: v.string(),
    alertType: v.string(),
    user: v.string(),
    amount: v.optional(v.number()),
    message: v.optional(v.string()),
    tier: v.optional(v.string()),
    rawPayload: v.any(),
    state: v.union(
      v.literal("pending"),
      v.literal("rendering"),
      v.literal("complete"),
      v.literal("cancelled"),
      v.literal("expired")
    ),
    priority: v.number(),
    ttl: v.number(),
    claimedBy: v.optional(v.string()),
    expiresAt: v.number(),
    completedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_instance", ["instanceId"])
    .index("by_scene_and_state", ["sceneId", "state"])
    .index("by_source_key_and_state", ["sourceKey", "state"])
    .index("by_expires_at", ["expiresAt"]),

  // alertHistory: bounded history of fired alerts
  alertHistory: defineTable({
    instanceId: v.id("instances"),
    sceneId: v.id("scenes"),
    alertType: v.string(),
    user: v.string(),
    amount: v.optional(v.number()),
    message: v.optional(v.string()),
    tier: v.optional(v.string()),
    state: v.string(),
    duration: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_instance", ["instanceId"])
    .index("by_scene", ["sceneId"]),

  // obsSceneConfigs: OBS scene-specific configurations
  obsSceneConfigs: defineTable({
    sceneId: v.id("scenes"),
    obsHost: v.string(),
    obsPassword: v.optional(v.string()),
    platformActions: v.array(
      v.object({
        trigger: v.string(),
        platform: v.literal("obs"),
        operation: v.object({
          type: v.union(
            v.literal("set_scene"),
            v.literal("set_source_visibility"),
            v.literal("set_filter_enabled"),
            v.literal("set_scene_item_transform"),
            v.literal("play_media"),
            v.literal("set_audio_mute"),
            v.literal("set_audio_volume"),
            v.literal("trigger_hotkey"),
            v.literal("send_vendor_event")
          ),
          target: v.string(),
          params: v.record(v.string(), v.any()),
        }),
        conditions: v.array(v.string()),
      })
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_scene", ["sceneId"]),

  // obsCommands: pending OBS commands
  obsCommands: defineTable({
    instanceId: v.id("instances"),
    sceneId: v.id("scenes"),
    commandType: v.union(
      v.literal("scene_transition"),
      v.literal("source_visibility"),
      v.literal("filter_state"),
      v.literal("audio_state"),
      v.literal("media_playback"),
      v.literal("hotkey"),
      v.literal("transform")
    ),
    target: v.string(),
    action: v.string(),
    params: v.record(v.string(), v.any()),
    state: v.union(
      v.literal("pending"),
      v.literal("executing"),
      v.literal("complete"),
      v.literal("cancelled"),
      v.literal("expired")
    ),
    priority: v.number(),
    ttl: v.number(),
    alertId: v.optional(v.id("alerts")),
    createdAt: v.number(),
  })
    .index("by_scene_and_state", ["sceneId", "state"])
    .index("by_ttl", ["ttl"]),
});
