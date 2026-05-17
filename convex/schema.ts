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

  // accountMembers: users with access to an account (team). Owner also has accounts.ownerId.
  accountMembers: defineTable({
    accountId: v.id("accounts"),
    userId: v.id("users"),
    role: v.union(v.literal("owner"), v.literal("admin"), v.literal("member")),
    createdAt: v.number(),
  })
    .index("by_account", ["accountId"])
    .index("by_user", ["userId"])
    .index("by_account_user", ["accountId", "userId"]),

  // invitations: pending team invites before acceptance
  invitations: defineTable({
    accountId: v.id("accounts"),
    email: v.string(),
    role: v.union(v.literal("admin"), v.literal("member")),
    token: v.string(),
    invitedByUserId: v.id("users"),
    status: v.union(v.literal("pending"), v.literal("accepted"), v.literal("revoked"), v.literal("expired")),
    expiresAt: v.number(),
    createdAt: v.number(),
  })
    .index("by_token", ["token"])
    .index("by_account", ["accountId"])
    .index("by_account_email", ["accountId", "email"]),

  // instances: a single woofx3 deployment
  instances: defineTable({
    accountId: v.id("accounts"),
    name: v.string(),
    url: v.string(),
    applicationId: v.optional(v.string()),
    clientId: v.optional(v.string()),
    clientSecret: v.optional(v.string()),
    webhookSecret: v.optional(v.string()),
    createdAt: v.number(),
    lastViewedAt: v.optional(v.number()),
    lastEngineActivityAt: v.optional(v.number()),
    storageProvider: v.optional(v.union(v.literal("convex"), v.literal("r2"), v.literal("local"))),
  })
    .index("by_account", ["accountId"])
    .index("by_webhook_secret", ["webhookSecret"]),

  // instanceLiveState: live stream presence per instance, driven by STREAM_ONLINE/OFFLINE
  // engine events (and best-effort poll fallback). One row per instance.
  instanceLiveState: defineTable({
    instanceId: v.id("instances"),
    applicationId: v.optional(v.string()),
    twitchUserId: v.optional(v.string()),
    isLive: v.boolean(),
    startedAt: v.optional(v.string()), // ISO from StreamOnlineEvent
    streamTitle: v.optional(v.string()),
    gameName: v.optional(v.string()),
    viewerCount: v.optional(v.number()),
    lastUpdateSource: v.union(v.literal("webhook"), v.literal("poll")),
    lastUpdatedAt: v.number(),
  }).index("by_instance", ["instanceId"]),

  // applications: engine-internal application scoping per instance
  applications: defineTable({
    instanceId: v.id("instances"),
    applicationId: v.string(), // engine-returned value — Convex never generates this
    name: v.string(),
    createdAt: v.number(),
  })
    .index("by_instance", ["instanceId"])
    .index("by_instance_app", ["instanceId", "applicationId"]),

  // instanceMembers: users who have access to an instance
  instanceMembers: defineTable({
    instanceId: v.id("instances"),
    userId: v.id("users"),
    role: v.union(v.literal("owner"), v.literal("admin"), v.literal("member")),
  })
    .index("by_user", ["userId"])
    .index("by_instance", ["instanceId"])
    .index("by_instance_user", ["instanceId", "userId"]),

  // platformLinks: OAuth tokens for streaming platforms (Twitch, etc.) per instance
  platformLinks: defineTable({
    instanceId: v.id("instances"),
    platform: v.string(),
    platformUserId: v.string(),
    platformUsername: v.string(),
    profileImageUrl: v.optional(v.string()),
    channelId: v.string(),
    accessToken: v.string(),
    refreshToken: v.string(),
    expiresAt: v.number(),
    scopes: v.array(v.string()),
    connectedByUserId: v.optional(v.string()),
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
    applicationId: v.optional(v.string()),
    engineCommandId: v.optional(v.string()),
    command: v.string(),
    type: v.union(
      v.literal("static"),
      v.literal("dynamic"),
      v.literal("function")
    ),
    typeValue: v.optional(v.string()),
    response: v.optional(v.string()),
    template: v.optional(v.string()),
    functionId: v.optional(v.string()),
    cooldown: v.number(),
    priority: v.optional(v.number()),
    enabled: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.optional(v.number()),
  }).index("by_instance", ["instanceId"]),

  // moduleRepository: directory of all available modules (seeded by admins or uploaded)
  moduleRepository: defineTable({
    instanceId: v.optional(v.id("instances")),
    moduleKey: v.optional(v.string()),
    name: v.string(),
    description: v.string(),
    version: v.string(),
    tags: v.array(v.string()),
    manifest: v.optional(v.any()),
    archiveKey: v.optional(v.string()),
    author: v.optional(v.string()),
    category: v.optional(v.string()),
    status: v.optional(
      v.union(v.literal("pending"), v.literal("delivering"), v.literal("installed"), v.literal("failed"))
    ),
    statusMessage: v.optional(v.string()),
  })
    .index("by_instance", ["instanceId"])
    .index("by_name_version", ["name", "version"])
    .index("by_module_key", ["moduleKey"]),

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
    columnSizes: v.optional(v.array(v.number())),
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
    projectionKey: v.optional(v.string()),
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
    projectionKey: v.optional(v.string()),
    moduleId: v.optional(v.id("moduleRepository")),
  })
    .index("by_slug", ["slug"])
    .index("by_module", ["moduleId"]),

  // moduleFunctions: UI catalog of sandbox functions registered by installed modules.
  // Mirrors engine FunctionDefinition; written by MODULE_FUNCTION_REGISTERED handler.
  // moduleId is optional to accommodate legacy rows that pre-date the
  // moduleRepository linkage; new writes always populate it.
  moduleFunctions: defineTable({
    moduleId: v.optional(v.id("moduleRepository")),
    engineFunctionId: v.string(), // FunctionDefinition.id (engine UUID)
    projectionKey: v.optional(v.string()), // {moduleKey}:function:{manifestId}
    manifestId: v.optional(v.string()), // stable manifest-local id (e.g. "play_alert")
    moduleName: v.string(),
    functionName: v.string(), // display name
    qualifiedName: v.string(), // "{moduleName}/{manifestId}"
    fileName: v.string(),
    entryPoint: v.string(),
    runtime: v.string(),
  })
    .index("by_module", ["moduleId"])
    .index("by_projection_key", ["projectionKey"])
    .index("by_engine_id", ["engineFunctionId"]),

  // instanceEnabledTriggers: which trigger ids are enabled for a given instance (module lifecycle)
  instanceEnabledTriggers: defineTable({
    instanceId: v.id("instances"),
    triggerId: v.string(),
    projectionKey: v.optional(v.string()),
  })
    .index("by_instance", ["instanceId"])
    .index("by_instance_trigger", ["instanceId", "triggerId"]),

  // instanceEnabledActions: which action ids are enabled for a given instance
  instanceEnabledActions: defineTable({
    instanceId: v.id("instances"),
    actionId: v.string(),
    projectionKey: v.optional(v.string()),
  })
    .index("by_instance", ["instanceId"])
    .index("by_instance_action", ["instanceId", "actionId"]),

  // instanceEnabledFunctions: which function ids are enabled for a given instance
  instanceEnabledFunctions: defineTable({
    instanceId: v.id("instances"),
    functionId: v.string(), // engine FunctionDefinition.id
    projectionKey: v.optional(v.string()),
  })
    .index("by_instance", ["instanceId"])
    .index("by_instance_function", ["instanceId", "functionId"]),

  // workflowTemplates: predefined workflow templates for common Twitch events
  workflowTemplates: defineTable({
    name: v.string(),
    description: v.string(),
    trigger: v.string(), // "follow" | "subscribe" | "bits" | "raid" | "gift"
    workflowJson: v.any(),
  }),

  // workflows: Convex-side mirror of canonical engine WorkflowDefinition, plus
  // an optional ReactFlow projection cache (nodes/edges) derived in the browser.
  workflows: defineTable({
    instanceId: v.id("instances"),
    applicationId: v.string(),
    engineWorkflowId: v.string(),
    projectionKey: v.optional(v.string()),
    definition: v.any(),
    isEnabled: v.boolean(),
    nodes: v.optional(v.array(v.any())),
    edges: v.optional(v.array(v.any())),
    projectionUpdatedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_instance", ["instanceId"])
    .index("by_engine_id", ["instanceId", "engineWorkflowId"]),

  // pendingWorkflowOperations: correlation records awaiting a webhook echo
  pendingWorkflowOperations: defineTable({
    correlationKey: v.string(),
    instanceId: v.id("instances"),
    op: v.union(v.literal("create"), v.literal("update"), v.literal("delete")),
    expiresAt: v.number(),
  })
    .index("by_correlation", ["correlationKey"])
    .index("by_expiry", ["expiresAt"]),

  // completedWorkflowOperations: webhook-confirmed outcomes keyed by correlationKey
  completedWorkflowOperations: defineTable({
    correlationKey: v.string(),
    engineWorkflowId: v.string(),
    op: v.union(v.literal("create"), v.literal("update"), v.literal("delete")),
    completedAt: v.number(),
  }).index("by_correlation", ["correlationKey"]),

  // twitchOAuthState: short-lived CSRF state for Twitch OAuth flow
  twitchOAuthState: defineTable({
    state: v.string(),
    redirectTo: v.string(),
    instanceId: v.optional(v.id("instances")),
    createdAt: v.number(),
  }).index("by_state", ["state"]),

  // twitchPendingAuth: one-time token bridging Convex HTTP callback → frontend signIn
  twitchPendingAuth: defineTable({
    token: v.string(),
    twitchId: v.string(),
    twitchLogin: v.optional(v.string()),
    displayName: v.string(),
    email: v.string(),
    profileImage: v.string(),
    accessToken: v.optional(v.string()),
    refreshToken: v.optional(v.string()),
    expiresIn: v.optional(v.number()),
    obtainmentTimestamp: v.optional(v.number()),
    scopes: v.optional(v.array(v.string())),
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
    applicationId: v.optional(v.string()),
    engineSceneId: v.optional(v.string()),
    name: v.string(),
    description: v.optional(v.string()),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    layout: v.optional(v.any()),
    backgroundColor: v.optional(v.string()),
    widgets: v.optional(v.array(v.any())),
    sceneWidgets: v.optional(v.array(v.any())),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_instance", ["instanceId"])
    .index("by_engine_scene_id", ["instanceId", "engineSceneId"]),

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

  // moduleAssets: assets declared by a module's manifest (images/audio/video/data).
  // Mirrors engine AssetDefinition; written by MODULE_ASSET_REGISTERED handler.
  // Actions reference assets by canonicalId; editor maps to public URL via the
  // instance's storage adapter at workflow-save time.
  moduleAssets: defineTable({
    moduleId: v.id("moduleRepository"),
    engineAssetId: v.string(), // AssetDefinition.id
    canonicalId: v.string(), // {moduleId}:asset:{manifestId}
    projectionKey: v.string(), // {moduleKey}:asset:{manifestId}
    manifestId: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    repositoryKey: v.string(), // engine-relative storage key
    manifestPath: v.string(),
    kind: v.optional(v.string()), // image | audio | video | font | data
    contentType: v.optional(v.string()),
    createdByType: v.string(),
    createdByRef: v.string(),
  })
    .index("by_module", ["moduleId"])
    .index("by_canonical_id", ["canonicalId"])
    .index("by_projection_key", ["projectionKey"]),

  // moduleResourceInstances: runtime-created instances of module-declared resource
  // kinds (e.g. user-defined counters). Mirrors engine ResourceInstanceDefinition.
  // Backs resource_ref ConfigField pickers in the workflow builder.
  moduleResourceInstances: defineTable({
    instanceId: v.id("instances"),
    moduleId: v.id("moduleRepository"),
    engineInstanceId: v.string(), // ResourceInstanceDefinition.id (engine UUID)
    resourceInstanceId: v.string(), // manifest-local instance id
    moduleName: v.string(),
    kind: v.string(),
    displayName: v.string(),
    canonicalId: v.string(), // {moduleName}:{kind}:{instanceId}
  })
    .index("by_instance", ["instanceId"])
    .index("by_module", ["moduleId"])
    .index("by_canonical_id", ["canonicalId"])
    .index("by_instance_kind", ["instanceId", "kind"]),

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

  // engineAlerts: engine-authoritative log of dispatched alerts. Mirrors the
  // engine's alert rows; written by ALERT_RECORDED and updated by
  // ALERT_REPLAYED/COMPLETED/FAILED/TIMED_OUT/SKIPPED. Distinct from `alerts`
  // (the browser-source queue) and `alertHistory` (the local fire log).
  engineAlerts: defineTable({
    instanceId: v.id("instances"),
    applicationId: v.string(),
    engineAlertId: v.string(), // AlertSnapshot.id
    payload: v.string(), // JSON AlertPayload envelope
    workflowId: v.optional(v.string()),
    sourceEventId: v.optional(v.string()),
    status: v.union(
      v.literal("sent"),
      v.literal("playing"),
      v.literal("completed"),
      v.literal("failed"),
      v.literal("replayed"),
      v.literal("timed_out"),
      v.literal("skipped"),
      v.literal("pending"),
      v.literal("dispatched")
    ),
    envelopeId: v.optional(v.string()),
    dispatchedAt: v.optional(v.string()),
    playedAt: v.optional(v.string()),
    completedAt: v.optional(v.string()),
    error: v.optional(v.string()),
    engineCreatedAt: v.string(),
    engineUpdatedAt: v.string(),
    createdAt: v.number(), // Convex-side ingest time
  })
    .index("by_instance", ["instanceId"])
    .index("by_engine_id", ["engineAlertId"])
    .index("by_instance_status", ["instanceId", "status"]),

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

  // transientEvents: ephemeral messages for realtime UI subscriptions.
  // Keyed by a client-generated correlationKey so the UI can subscribe before the event exists.
  // Cleaned up automatically via scheduled deletion after TTL expires.
  transientEvents: defineTable({
    instanceId: v.id("instances"),
    correlationKey: v.string(),
    type: v.string(),
    status: v.union(v.literal("progress"), v.literal("success"), v.literal("error")),
    message: v.optional(v.string()),
    data: v.optional(v.any()),
    expiresAt: v.number(),
  })
    .index("by_instance_correlation", ["instanceId", "correlationKey"])
    .index("by_expires_at", ["expiresAt"]),

  // userDashboardLayouts: per-user, per-instance dashboard widget layout persistence
  userDashboardLayouts: defineTable({
    userId: v.id("users"),
    instanceId: v.id("instances"),
    layout: v.array(
      v.object({
        id: v.string(),
        type: v.string(),
        position: v.object({ x: v.number(), y: v.number() }),
        size: v.object({ width: v.number(), height: v.number() }),
        config: v.optional(v.any()),
      })
    ),
    updatedAt: v.number(),
  }).index("by_user_instance", ["userId", "instanceId"]),

  // debugEventHistory: history of simulated Twitch events for debugging
  debugEventHistory: defineTable({
    userId: v.id("users"),
    instanceId: v.id("instances"),
    eventType: v.string(),
    payload: v.any(),
    sentAt: v.number(),
    success: v.boolean(),
    errorMessage: v.optional(v.string()),
  })
    .index("by_user_instance", ["userId", "instanceId"])
    .index("by_sent_at", ["sentAt"]),

  // instanceSync: per-instance sync schedule and state. Driven by the
  // engine-sync sweep cron. One row per instance; created lazily on first
  // sweep eligibility check.
  instanceSync: defineTable({
    instanceId: v.id("instances"),
    lastSyncedAt: v.number(),
    nextEligibleAt: v.number(),
    status: v.union(
      v.literal("idle"),
      v.literal("running"),
      v.literal("success"),
      v.literal("error"),
    ),
    lastError: v.string(),
    lastDurationMs: v.number(),
    consecutiveErrorCount: v.number(),
    syncIntervalMs: v.number(),
  })
    .index("by_instance", ["instanceId"])
    .index("by_next_eligible", ["nextEligibleAt"]),

  // syncRuns: append-only audit log of each engine-sync run. Doubles as the
  // live-progress feed when status="running".
  syncRuns: defineTable({
    instanceId: v.id("instances"),
    trigger: v.union(v.literal("scheduled"), v.literal("manual")),
    status: v.union(v.literal("running"), v.literal("success"), v.literal("error")),
    startedAt: v.number(),
    completedAt: v.optional(v.number()),
    steps: v.array(
      v.object({
        name: v.union(
          v.literal("commands"),
          v.literal("modules"),
          v.literal("workflows"),
          v.literal("scenes"),
        ),
        status: v.union(
          v.literal("pending"),
          v.literal("running"),
          v.literal("success"),
          v.literal("error"),
        ),
        itemsProcessed: v.number(),
        error: v.optional(v.string()),
        startedAt: v.optional(v.number()),
        completedAt: v.optional(v.number()),
      })
    ),
    error: v.optional(v.string()),
  }).index("by_instance_recent", ["instanceId", "startedAt"]),

  // installedModules: which modules are currently installed per instance.
  // Mirrors the engine's `listEngineModules()` response.
  installedModules: defineTable({
    instanceId: v.id("instances"),
    name: v.string(),
    version: v.string(),
    state: v.string(),
    updatedAt: v.number(),
  })
    .index("by_instance", ["instanceId"])
    .index("by_instance_name", ["instanceId", "name"]),
});
