import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { feedbackKindValidator, feedbackStatusValidator } from "./lib/feedback";

// Must match SessionSummarySession and SessionSummaryTotals in
// convex/lib/sessionSummary.ts, which validates the webhook body before it
// reaches these.
const sessionSummarySessionValidator = v.object({
  status: v.union(v.literal("open"), v.literal("closed")),
  startedAt: v.string(),
  endedAt: v.union(v.string(), v.null()),
  segments: v.array(v.object({ id: v.string(), startedAt: v.string(), endedAt: v.union(v.string(), v.null()) })),
});

const sessionSummaryTotalsValidator = v.object({
  bits: v.number(),
  cheers: v.number(),
  subs: v.number(),
  giftedSubs: v.number(),
  follows: v.number(),
  raids: v.number(),
  raiders: v.number(),
  peakViewers: v.union(v.number(), v.null()),
  averageViewers: v.union(v.number(), v.null()),
  viewerSampleMinutes: v.number(),
});

// One placed widget on a dashboard panel. Exported so convex/dashboardLayouts.ts's
// setPanelWidgets argument validator is literally the same shape the table stores —
// they drifted apart once before, and a mutation validator that is missing a field
// the client sends rejects the whole write at the argument boundary.
export const dashboardPanelWidgetValidator = v.object({
  zoneId: v.string(),
  // Identifies one widget within a zone now that a zone can hold more
  // than one (stacked, resizable). Optional because rows saved before
  // multi-widget zones only ever had one widget per zoneId — those are
  // still valid without it; client/src/lib/dashboard-widgets/types.ts's
  // widgetSlotId() falls back to zoneId for that legacy shape.
  slotId: v.optional(v.string()),
  type: v.string(),
  config: v.optional(v.any()),
  // Percentage (0-100) of the zone's stack this widget occupies.
  // Undefined means "split evenly" — computed client-side, not stored
  // until the user actually drags a resize handle.
  size: v.optional(v.number()),
});

export const macroActionTypeValidator = v.union(
  v.literal("send-message"),
  v.literal("chat-command"),
  v.literal("trigger-workflow"),
  v.literal("http-request")
);

// Mirrors MacroConfig in convex/lib/macroVariables.ts. Free-text fields may
// carry `{{name}}` variables, resolved each time the macro runs.
export const macroConfigValidator = v.object({
  message: v.optional(v.string()),
  command: v.optional(v.string()),
  commandText: v.optional(v.string()),
  workflowId: v.optional(v.string()),
  url: v.optional(v.string()),
  method: v.optional(v.union(v.literal("GET"), v.literal("POST"), v.literal("PUT"), v.literal("DELETE"))),
  headers: v.optional(v.record(v.string(), v.string())),
  body: v.optional(v.string()),
});

// Pages that show a first-visit intro. Must match PAGE_INTROS in
// client/src/lib/page-intros.ts.
export const pageIntroIdValidator = v.union(v.literal("workflows"), v.literal("scenes"), v.literal("modules"));

// One widget docked to the dashboard's right-edge rail, opened as a flyout.
// Exported for the same reason as dashboardPanelWidgetValidator.
export const dashboardRailWidgetValidator = v.object({
  slotId: v.string(),
  type: v.string(),
  config: v.optional(v.any()),
});

// Shared shape for dashboardLayouts.panels (and its legacy `pages` alias below).
const dashboardPanelValidator = v.array(
  v.object({
    id: v.string(),
    name: v.string(),
    layoutId: v.string(),
    widgets: v.array(dashboardPanelWidgetValidator),
  })
);

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
  // An invite targets exactly one of an email address or a platform account
  // (convex/lib/invitationTarget.ts). A platform invite matches on
  // platformUserId; the login, name and avatar are what the platform reported
  // when it was created, kept for display.
  invitations: defineTable({
    accountId: v.id("accounts"),
    email: v.optional(v.string()),
    platform: v.optional(v.literal("twitch")),
    platformUserId: v.optional(v.string()),
    platformLogin: v.optional(v.string()),
    platformDisplayName: v.optional(v.string()),
    platformProfileImageUrl: v.optional(v.string()),
    role: v.union(v.literal("admin"), v.literal("member")),
    token: v.string(),
    invitedByUserId: v.id("users"),
    status: v.union(v.literal("pending"), v.literal("accepted"), v.literal("revoked"), v.literal("expired")),
    expiresAt: v.number(),
    createdAt: v.number(),
  })
    .index("by_token", ["token"])
    .index("by_account", ["accountId"])
    .index("by_account_email", ["accountId", "email"])
    .index("by_account_platform_user", ["accountId", "platform", "platformUserId"]),

  // instances: a single woofx3 deployment
  instances: defineTable({
    accountId: v.id("accounts"),
    name: v.string(),
    url: v.string(),
    clientId: v.optional(v.string()),
    clientSecret: v.optional(v.string()),
    webhookSecret: v.optional(v.string()),
    // Who runs the engine. Absent means "external": every instance predates
    // managed engines, so the user pasted the URL of an engine they host.
    // "managed" engines are created by the woofx3 maintenance API and are the
    // only ones engineProvisioning rows and deprovisioning apply to.
    hosting: v.optional(v.union(v.literal("managed"), v.literal("external"))),
    createdAt: v.number(),
    lastViewedAt: v.optional(v.number()),
    lastEngineActivityAt: v.optional(v.number()),
    storageProvider: v.optional(v.union(v.literal("convex"), v.literal("r2"), v.literal("local"))),
    // Cached EngineInfo (getEngineInfo RPC). Read by the public browser-source
    // page to iframe the engine-rendered overlay. Refreshed on a TTL.
    engineStreamwareBaseUrl: v.optional(v.string()),
    engineSceneOverlayBaseUrl: v.optional(v.string()),
    engineInfoFetchedAt: v.optional(v.number()),
    // The hostname (`c-<12 base32 chars>.woofx3.tv`) the edge relay serves
    // this instance's companion bridge on. Allocated by the maintenance API
    // the first time the instance routes an endpoint through its companion.
    companionHostname: v.optional(v.string()),
    // Bumped each time the engine's relay configuration may need to change.
    // A sync run carries the version it was scheduled for and does nothing
    // once a newer one exists, so two runs cannot land in reverse order.
    relaySyncVersion: v.optional(v.number()),
  })
    .index("by_account", ["accountId"])
    .index("by_webhook_secret", ["webhookSecret"]),

  // instanceLiveState: live stream presence per instance, driven by STREAM_ONLINE/OFFLINE
  // engine events (and best-effort poll fallback). One row per instance.
  instanceLiveState: defineTable({
    instanceId: v.id("instances"),
    twitchUserId: v.optional(v.string()),
    isLive: v.boolean(),
    startedAt: v.optional(v.string()), // ISO from StreamOnlineEvent
    // The logical session the broadcast belongs to. It spans brief dropouts, so
    // unlike startedAt above it is NOT cleared when the stream goes offline — a
    // session may be entirely offline. Written only by SESSION_STARTED; the
    // stream and poll writers omit these keys, which leaves them untouched.
    sessionId: v.optional(v.string()),
    sessionStartedAt: v.optional(v.string()), // ISO from SessionStartedEvent
    streamTitle: v.optional(v.string()),
    gameName: v.optional(v.string()),
    viewerCount: v.optional(v.number()),
    lastUpdateSource: v.union(v.literal("webhook"), v.literal("poll")),
    lastUpdatedAt: v.number(),
  })
    .index("by_instance", ["instanceId"])
    .index("by_is_live", ["isLive"]),

  // streamSessionSummaries: one row per ended engine session, written by the
  // SESSION_SUMMARY webhook (convex/lib/sessionSummary.ts). Channel totals only,
  // never per-viewer detail: this is the copy of a stream's history that
  // outlives the engine's own database. Keyed on (instanceId, sessionId) because
  // session ids are only unique within one engine. A row is replaced only by a
  // snapshot with a newer generatedAt.
  //
  // session, totals and sessionStartedAtMs are absent when schemaVersion is one
  // this deployment does not interpret; rawPayload holds the body instead.
  streamSessionSummaries: defineTable({
    instanceId: v.id("instances"),
    sessionId: v.string(),
    schemaVersion: v.number(),
    generatedAt: v.string(), // ISO, as the engine sent it
    generatedAtMs: v.number(), // generatedAt parsed, for ordering repeats
    sessionStartedAtMs: v.optional(v.number()), // session.startedAt parsed, for newest-first listing
    session: v.optional(sessionSummarySessionValidator),
    totals: v.optional(sessionSummaryTotalsValidator),
    rawPayload: v.optional(v.string()),
    receivedAt: v.number(),
  })
    .index("by_instance_session", ["instanceId", "sessionId"])
    .index("by_instance_started", ["instanceId", "sessionStartedAtMs"]),

  // engineProvisioning: one row per managed instance, tracking the woofx3
  // maintenance API's provisioning run and the registration handshake that
  // follows it. The row is the progress screen's only source: the maintenance
  // API pushes every step transition to /api/webhooks/maintenance, so the
  // browser subscribes here instead of polling anything.
  //
  // `registrationToken` is the secret the engine requires from whoever claims
  // it, so a public engine cannot be claimed by whoever reaches it first. It
  // is sent to the maintenance API at create time and replayed to the engine
  // at registration; no public query may return it.
  engineProvisioning: defineTable({
    instanceId: v.id("instances"),
    accountId: v.id("accounts"),
    requestedBy: v.id("users"),
    // Assigned by the maintenance API, so both are absent until POST /v1/engines answers.
    maintenanceEngineId: v.optional(v.string()),
    runId: v.optional(v.string()),
    slug: v.string(),
    status: v.union(
      v.literal("requested"),
      v.literal("provisioning"),
      v.literal("ready"),
      v.literal("registering"),
      v.literal("registered"),
      // The engine is stopped while it moves to another release, or back to
      // the one it had; `upgrade` says which.
      v.literal("upgrading"),
      v.literal("failed"),
      v.literal("deprovisioning"),
      v.literal("deleted")
    ),
    // Mirrors the maintenance API's run steps, in run order. Bounded by the
    // number of steps in a run (nine today), so it stays a field rather than
    // a table. Step status values are the maintenance API's own.
    steps: v.array(
      v.object({
        key: v.string(),
        label: v.string(),
        status: v.union(
          v.literal("pending"),
          v.literal("running"),
          v.literal("succeeded"),
          v.literal("failed"),
          v.literal("skipped")
        ),
        error: v.optional(v.string()),
        // Why a running step is still waiting, in the maintenance API's words.
        detail: v.optional(v.string()),
      })
    ),
    publicUrl: v.optional(v.string()),
    // The release the engine reports running, as its ready callback gives it.
    // Kept here so the admin page can name it without asking the maintenance
    // API again.
    reportedVersion: v.optional(v.string()),
    error: v.optional(v.string()),
    registrationToken: v.string(),
    // Registration is retried on a backoff after the engine reports ready;
    // this counts the attempts made so far so the schedule can advance.
    registrationAttempts: v.optional(v.number()),
    // The latest upgrade of this engine, kept after it ends so the engine page
    // can say how it went.
    upgrade: v.optional(
      v.object({
        fromVersion: v.string(),
        toVersion: v.string(),
        requestedBy: v.id("users"),
        startedAt: v.number(),
        // Counts upgrades asked of this row and is part of each one's
        // Idempotency-Key. The maintenance API keeps keys for 7 days, so a
        // second try at the same release under the first try's key would be
        // answered with the first try's run.
        attempt: v.number(),
        // The release did not come up and the previous one is being restored.
        rollingBack: v.boolean(),
        outcome: v.optional(v.union(v.literal("succeeded"), v.literal("rolled_back"), v.literal("failed"))),
        error: v.optional(v.string()),
        // Set once the requester has dismissed the outcome.
        acknowledged: v.optional(v.boolean()),
      })
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_instance", ["instanceId"])
    .index("by_account", ["accountId"])
    .index("by_maintenance_engine", ["maintenanceEngineId"]),

  // maintenanceEvents: delivered maintenance-API callback ids. The endpoint is
  // at-least-once, so this is the dedupe key: an id already present means the
  // event was applied and the redelivery is acknowledged without reapplying it.
  maintenanceEvents: defineTable({
    eventId: v.string(),
    eventType: v.string(),
    maintenanceEngineId: v.optional(v.string()),
    receivedAt: v.number(),
  })
    .index("by_event", ["eventId"])
    .index("by_received_at", ["receivedAt"]),

  // instanceMembers: users who have access to an instance
  instanceMembers: defineTable({
    instanceId: v.id("instances"),
    userId: v.id("users"),
    role: v.union(v.literal("owner"), v.literal("admin"), v.literal("member")),
  })
    .index("by_user", ["userId"])
    .index("by_instance", ["instanceId"])
    .index("by_instance_user", ["instanceId", "userId"]),

  // companionPairings: one row per pairing attempt, from the companion asking
  // for a code until a person approves or declines it. Only hashes of the
  // device code and of the companion's own token are stored. Expiry is
  // `expiresAt`, never a status (see companionPairing.ts).
  companionPairings: defineTable({
    deviceCodeHash: v.string(),
    tokenHash: v.string(),
    installationId: v.string(),
    userCode: v.string(),
    deviceName: v.string(),
    companionVersion: v.string(),
    status: v.union(v.literal("pending"), v.literal("approved"), v.literal("denied"), v.literal("cancelled")),
    instanceId: v.optional(v.id("instances")),
    approvedBy: v.optional(v.id("users")),
    createdAt: v.number(),
    expiresAt: v.number(),
  })
    .index("by_device_code_hash", ["deviceCodeHash"])
    .index("by_token_hash", ["tokenHash"])
    .index("by_user_code", ["userCode"])
    .index("by_expires_at", ["expiresAt"])
    .index("by_instance", ["instanceId"]),

  // companions: a paired companion app. The row is the credential: revoking
  // deletes it. Only the token's hash is stored. `companionVersion` is the
  // version that paired; companionPresence holds the running one. An
  // installation has at most one row per instance: pairing the same install
  // again replaces that row's token.
  companions: defineTable({
    instanceId: v.id("instances"),
    installationId: v.string(),
    tokenHash: v.string(),
    deviceName: v.string(),
    companionVersion: v.string(),
    pairedBy: v.id("users"),
    pairedAt: v.number(),
    // Set when the person at the PC confirms the pairing on the device;
    // absent until then, and cleared when the installation pairs again.
    confirmedAt: v.optional(v.number()),
  })
    .index("by_token_hash", ["tokenHash"])
    .index("by_instance", ["instanceId"])
    .index("by_instance_installation", ["instanceId", "installationId"]),

  // companionPresence: one row per companion, written by its heartbeat. Kept
  // apart from `companions` so the heartbeat does not re-run every
  // subscription that reads the companion itself.
  companionPresence: defineTable({
    companionId: v.id("companions"),
    lastSeenAt: v.number(),
    companionVersion: v.string(),
  }).index("by_companion", ["companionId"]),

  // companionEndpoints: what the instance's companion does for each local[]
  // endpoint of an installed module. The companion is the authority for the
  // address it dials (it keeps its own copy); `address` here is for display.
  // Rows belong to the companion and go when it is revoked or replaced.
  companionEndpoints: defineTable({
    companionId: v.id("companions"),
    instanceId: v.id("instances"),
    moduleId: v.string(),
    endpointId: v.string(),
    enabled: v.boolean(),
    address: v.optional(v.object({ host: v.string(), port: v.number() })),
    discovered: v.boolean(),
    sharesPassword: v.boolean(),
    updatedAt: v.number(),
  })
    .index("by_companion", ["companionId"])
    .index("by_instance_module", ["instanceId", "moduleId"])
    .index("by_companion_endpoint", ["companionId", "moduleId", "endpointId"])
    .index("by_enabled_instance", ["enabled", "instanceId"]),

  // moduleSettingProvenance: who last wrote a module setting named by local[].
  // No row: never touched, so the companion may fill it. "companion": the
  // companion wrote `companionValue` (absent for secrets, which Convex never
  // keeps). "manual": the streamer saved it, and the companion leaves it alone.
  moduleSettingProvenance: defineTable({
    instanceId: v.id("instances"),
    moduleId: v.string(),
    key: v.string(),
    source: v.union(v.literal("companion"), v.literal("manual")),
    companionValue: v.optional(v.string()),
    updatedAt: v.number(),
  })
    .index("by_instance_module", ["instanceId", "moduleId"])
    .index("by_instance_module_key", ["instanceId", "moduleId", "key"]),

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
    // When Twitch last refused this link's refresh token: the creator revoked
    // the app or changed their password. Cleared by a relink or a successful
    // refresh. Drives the "Reconnect Twitch" banner (lib/twitchScopeHealth.ts).
    authFailedAt: v.optional(v.number()),
  }).index("by_instance", ["instanceId"]),

  // chatCommands: engine-authoritative read cache of chat commands. The engine
  // (Woofx3EngineApi createCommand/updateCommand/deleteCommand + listCommands)
  // is the source of truth; this table is populated by convex/chatCommandActions.ts
  // (immediately, from the RPC's own response) and by the command.* webhooks /
  // the periodic engine-sync "commands" step (for changes made elsewhere).
  // See docs/services/commands-ui.md in the woofx3 engine repo for the full contract.
  chatCommands: defineTable({
    instanceId: v.id("instances"),
    engineCommandId: v.string(),
    command: v.string(), // without the "!" prefix
    // The actions this command runs, in order -- the same shape a workflow step
    // has (`ActionStep` in @woofx3/api). Stored with `$ref` escaped, like every
    // other engine JSON Convex holds (see lib/dollarKeys.ts), and validated by
    // the engine, which is the authority on what it can run.
    actions: v.array(v.any()),
    // "{variable}" placeholders parsed out of user input after the command
    // word, e.g. "{songTitle}" — extracted values are merged into the
    // function's invoke payload (or usable in a "text" response). Empty
    // string = no named arguments. See CommandSnapshot.argumentPattern in
    // @woofx3/api for the full extraction rule. Optional to accommodate rows
    // written before this field existed; treat missing as "".
    argumentPattern: v.optional(v.string()),
    cooldown: v.number(), // seconds, 0 = never throttle
    priority: v.number(),
    enabled: v.boolean(),
    visibility: v.union(v.literal("public"), v.literal("restricted")),
    groupIds: v.array(v.string()), // chatCommandGroups.engineGroupId values
    usernames: v.array(v.string()), // lowercased chat usernames granted direct access
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_instance", ["instanceId"])
    .index("by_engine_command_id", ["instanceId", "engineCommandId"]),

  // chatCommandGroups: engine-authoritative read cache of "user groups" (roles)
  // that gate restricted commands. Mirrors GroupSnapshot from the engine's
  // listGroups()/createGroup()/updateGroup()/deleteGroup().
  chatCommandGroups: defineTable({
    instanceId: v.id("instances"),
    engineGroupId: v.string(),
    name: v.string(),
    description: v.string(),
    // Built-in groups are seeded by the engine for every application and
    // cannot be renamed or deleted; membership of all but "everyone" is owned
    // by the platform membership sync, so editing it by hand is overwritten on
    // the chatter's next message. Optional to accommodate rows cached before
    // this field existed; treat missing as false.
    isBuiltIn: v.optional(v.boolean()),
    engineCreatedAt: v.string(), // ISO 8601, as returned by the engine
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_instance", ["instanceId"])
    .index("by_engine_group_id", ["instanceId", "engineGroupId"]),

  // chatCommandGroupMembers: read cache of group membership (by lowercased
  // username, per the engine's addUserToGroup/removeUserFromGroup/listGroupMembers).
  // Reconciled wholesale per-group by the "groups" engine-sync step and kept live
  // by the group.member_added / group.member_removed webhooks.
  chatCommandGroupMembers: defineTable({
    instanceId: v.id("instances"),
    engineGroupId: v.string(),
    username: v.string(),
  })
    .index("by_group", ["instanceId", "engineGroupId"])
    .index("by_group_username", ["instanceId", "engineGroupId", "username"]),

  // setupPlatforms: the platform modules offered when an account is set up,
  // curated by us rather than per instance. Name, version and permissions come
  // from the marketplace at read time (convex/lib/setupPlatforms.ts), so
  // offering another platform is a row here, not a release.
  // instanceSetup: what was chosen in an instance's setup wizard. One row per
  // instance, shared by its members like the engine it configures.
  // `approvedPermissions` and `approvedLocalEndpoints` (ids of `local[]`
  // endpoints) are what the streamer consented to for each platform;
  // installing a build that declares more asks again instead of installing.
  // A row chosen before endpoints were approved has none approved.
  instanceSetup: defineTable({
    instanceId: v.id("instances"),
    platforms: v.array(
      v.object({
        marketplaceModuleId: v.string(),
        // The marketplace name when chosen, for messages about this module.
        name: v.optional(v.string()),
        approvedPermissions: v.array(v.string()),
        approvedLocalEndpoints: v.optional(v.array(v.string())),
      })
    ),
    platformsChosenAt: v.optional(v.number()),
    // When the "bring your setup" question was answered: an import queued, or skipped.
    importChosenAt: v.optional(v.number()),
    // SETUP_INTERESTS ids (convex/lib/setupInterests.ts). Skipping saves none.
    interests: v.optional(v.array(v.string())),
    interestsChosenAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    completedByUserId: v.optional(v.id("users")),
    // What applying the choices has done so far (convex/setupApply.ts): one
    // entry per chosen module and per starter pack. Applying runs once the
    // setup is complete and the engine is registered, and again on retry.
    moduleInstalls: v.optional(
      v.array(
        v.object({
          marketplaceModuleId: v.string(),
          status: v.union(v.literal("installed"), v.literal("needs_approval"), v.literal("failed")),
          moduleKey: v.optional(v.string()),
          // Set with needs_approval: what the current build asks for beyond the approval.
          unapproved: v.optional(v.array(v.string())),
          unapprovedLocalEndpoints: v.optional(v.array(v.string())),
          error: v.optional(v.string()),
        })
      )
    ),
    packInstalls: v.optional(
      v.array(
        v.object({
          packId: v.string(),
          // pending: some items wait on something that may still arrive, such
          // as a module's triggers syncing from the engine; retried on a backoff.
          status: v.union(v.literal("installed"), v.literal("pending"), v.literal("failed")),
          error: v.optional(v.string()),
        })
      )
    ),
    applyAttempts: v.optional(v.number()),
    // Held while an apply runs, so two scheduled at once do not both install.
    applyClaimedAt: v.optional(v.number()),
    updatedAt: v.number(),
  }).index("by_instance", ["instanceId"]),

  // userSetupSeen: users the setup wizard has opened for. Per user, so the
  // wizard opens by itself once per person rather than on every visit, and a
  // member joining an account that finished setup never gets it.
  userSetupSeen: defineTable({
    userId: v.id("users"),
    seenAt: v.number(),
  }).index("by_user", ["userId"]),

  setupPlatforms: defineTable({
    marketplaceModuleId: v.string(),
    required: v.boolean(),
    defaultSelected: v.boolean(),
    sortOrder: v.number(),
    // One line under the platform's name: what it adds to a stream.
    summary: v.string(),
  })
    .index("by_marketplace_module", ["marketplaceModuleId"])
    .index("by_sort_order", ["sortOrder"]),

  // moduleRepository: directory of all available modules (seeded by admins or uploaded).
  // Rows are per-tenant, and neither `name`+`version` nor `moduleKey` is unique
  // across tenants — moduleKey is `{marketplaceId}:{version}:{sha7}`, built from
  // the archive hash, so two instances installing the same module produce the
  // same key. Every lookup must therefore be scoped by instanceId; the two
  // indexes below are the only supported way to resolve a row from a webhook.
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
    .index("by_instance_name_version", ["instanceId", "name", "version"])
    .index("by_instance_module_key", ["instanceId", "moduleKey"]),

  // dashboardLayouts: the dashboard canvas panels for a user/instance. Each panel
  // picks a predefined layout (client/src/lib/dashboard-layouts.ts) and places
  // widgets (client/src/components/dashboard/widget-catalog.ts) into its zones.
  // No panels yet means the canvas shows the layout picker.
  // `pages`/`layoutId`/`modules`/`columnSizes` are legacy fields from earlier
  // iterations of this table (pre-rename or pre-multi-panel) and are
  // optional/unread now — kept so existing rows stay valid.
  dashboardLayouts: defineTable({
    instanceId: v.id("instances"),
    userId: v.id("users"),
    panels: v.optional(dashboardPanelValidator),
    // Unset until the user first edits the rail; the client then shows its
    // default rail widgets (client/src/lib/dashboard-rail.ts).
    railWidgets: v.optional(v.array(dashboardRailWidgetValidator)),
    pages: v.optional(dashboardPanelValidator),
    layoutId: v.optional(v.string()),
    modules: v.optional(
      v.array(
        v.object({
          id: v.string(),
          type: v.string(),
          title: v.string(),
          config: v.optional(v.any()),
        })
      )
    ),
    columnSizes: v.optional(v.array(v.number())),
  }).index("by_instance_user", ["instanceId", "userId"]),

  // macros: the instance's macro pad buttons. Shared per instance rather than per
  // user, like dashboardCounters below — a dashboard *layout* is a personal workspace
  // preference, but the macro pad is the channel's, so everyone sharing the
  // account sees the same buttons in the same order.
  //
  // One row per button rather than an array on a parent document: add, edit and
  // delete each touch a single document, and a reorder rewrites sortOrder only on
  // the rows that actually moved — so two people editing the pad cannot clobber
  // each other the way a whole-array replace would.
  macros: defineTable({
    instanceId: v.id("instances"),
    label: v.string(),
    icon: v.optional(v.string()),
    color: v.optional(v.string()),
    type: macroActionTypeValidator,
    config: macroConfigValidator,
    sortOrder: v.number(),
    updatedAt: v.number(),
  }).index("by_instance_and_sort_order", ["instanceId", "sortOrder"]),

  // macroTriggers: a macro's remote trigger URL, at most one per macro. The URL
  // carries a random token; only its SHA-256 hash is stored, so the row cannot
  // be turned back into a working URL (see convex/lib/macroTrigger.ts).
  //
  // A table of its own rather than fields on `macros`: every press writes the
  // rate-limit bucket and usage counters, and keeping that churn off the macro
  // row keeps it off every dashboard subscribed to the pad.
  macroTriggers: defineTable({
    instanceId: v.id("instances"),
    macroId: v.id("macros"),
    tokenHash: v.string(),
    // GET is opt-in: some devices can only send GET, but a GET URL also fires
    // when a chat app or browser prefetches a pasted link.
    allowGet: v.boolean(),
    createdBy: v.id("users"),
    createdAt: v.number(),
    /** When the current token was minted, if it replaced an earlier one. */
    rotatedAt: v.optional(v.number()),
    // What the URL is allowed to do: macroBehaviorFingerprint of the macro as
    // an owner or admin last approved it (by minting, rotating or
    // re-confirming), and who approved it. A macro edited since, or an
    // approver who has since lost the role, stops the URL until re-confirmed.
    confirmedFingerprint: v.string(),
    confirmedBy: v.id("users"),
    confirmedAt: v.number(),
    /** Last press the engine accepted, and how many it has accepted. */
    lastUsedAt: v.optional(v.number()),
    useCount: v.number(),
    /** Last press that got as far as the engine and was not accepted, and why. */
    lastFailedAt: v.optional(v.number()),
    lastFailure: v.optional(v.string()),
    rateTokens: v.number(),
    rateRefilledAt: v.number(),
  })
    .index("by_token_hash", ["tokenHash"])
    .index("by_macro", ["macroId"])
    .index("by_instance", ["instanceId"]),

  // shoutoutQueue: Twitch shoutouts waiting to be sent for an instance. Shared
  // per instance like dashboardCounters below -- a shoutout is the channel's, not one
  // viewer's, and everyone sharing the account should see the same queue.
  //
  // One row per entry rather than an array: the queue is reordered and pruned by
  // hand while a scheduled processor reads and writes it, so a whole-array
  // replace would drop whichever side wrote second.
  //
  // There is no status column. An entry is pending until it sends, at which
  // point the row is deleted; `attempts` and `lastError` are what distinguish
  // "waiting its turn" from "failed and backing off", so there is no second
  // source of truth to drift.
  shoutoutQueue: defineTable({
    instanceId: v.id("instances"),
    /** Twitch login, lowercased -- the canonical key. */
    login: v.string(),
    /** Properly-cased name for display; Twitch logins lose the casing. */
    displayName: v.string(),
    twitchUserId: v.string(),
    profileImageUrl: v.optional(v.string()),
    /** Twitch's broadcaster_type: "partner", "affiliate", or "" for neither. */
    broadcasterType: v.optional(v.string()),
    sortOrder: v.number(),
    attempts: v.number(),
    /** Epoch ms before which the processor must not attempt this entry again. */
    nextEligibleAt: v.number(),
    lastError: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_instance_and_sort_order", ["instanceId", "sortOrder"])
    .index("by_next_eligible", ["nextEligibleAt"]),

  // shoutoutState: one row per instance, holding what the queue processor needs
  // that is not per-entry. Separate from shoutoutQueue because it outlives every
  // entry -- the 2-minute spacing still applies after the queue drains.
  shoutoutState: defineTable({
    instanceId: v.id("instances"),
    /**
     * Epoch ms of the last attempt, successful or not. Failures are paced too:
     * a refused shoutout is still a call to a rate-limited endpoint, so the
     * cooldown is measured from every attempt rather than every send.
     */
    lastAttemptAt: v.optional(v.number()),
    /** Epoch ms a processor run is already scheduled for, so adds don't stack runs. */
    runScheduledFor: v.optional(v.number()),
  }).index("by_instance", ["instanceId"]),

  // dashboardCounters: which counters the dashboard command bar shows, in order.
  // A reference and nothing more — the number, the name and the goals all stay
  // on the counter resource, so a card cannot drift from what the counter's own
  // page says. Scoped per instance rather than per user: the command bar is the
  // channel's working surface, and everyone sharing the account should see the
  // same counters on it.
  //
  // `canonicalId` names the counter within the instance (see
  // moduleResourceInstances). A counter deleted out from under a row leaves it
  // resolving to nothing; the bar skips such a row rather than showing a card
  // with no number in it.
  dashboardCounters: defineTable({
    instanceId: v.id("instances"),
    canonicalId: v.string(),
    sortOrder: v.number(),
  })
    .index("by_instance", ["instanceId"])
    .index("by_instance_canonical", ["instanceId", "canonicalId"]),

  // pageIntroDismissals: first-visit page intros a user has closed. Per user rather
  // than per instance: an intro explains what a page is for, which a person
  // needs to learn once, not once per account they belong to.
  pageIntroDismissals: defineTable({
    userId: v.id("users"),
    introId: pageIntroIdValidator,
    dismissedAt: v.number(),
  }).index("by_user_and_intro", ["userId", "introId"]),

  // instanceNotes: freeform text behind the dashboard's Notes widget, one row
  // per instance, shared by every member like the macro pad: a streamer and
  // their moderators keep one set of notes for the channel.
  instanceNotes: defineTable({
    instanceId: v.id("instances"),
    content: v.string(),
    updatedAt: v.number(),
    updatedBy: v.id("users"),
  }).index("by_instance", ["instanceId"]),

  // dashboardNotes: legacy per-user notes from before instanceNotes. Read only
  // by migrations/backfillSharedNotes; nothing writes it.
  dashboardNotes: defineTable({
    instanceId: v.id("instances"),
    userId: v.id("users"),
    content: v.string(),
    updatedAt: v.number(),
  }).index("by_instance_user", ["instanceId", "userId"]),

  // gettingStartedChecklists: one row per instance for the dashboard's getting
  // started card. Shared by the instance's members, like the setup it tracks.
  // Most items are read from the setup and overlays; `doneItemIds` holds the
  // ones nothing else records (see convex/lib/gettingStarted.ts).
  gettingStartedChecklists: defineTable({
    instanceId: v.id("instances"),
    doneItemIds: v.array(v.string()),
    dismissedAt: v.optional(v.number()),
    updatedAt: v.number(),
  }).index("by_instance", ["instanceId"]),

  // goLiveChecklists: one row per instance for the Go live checklist. Shared by
  // everyone on the instance, like the channel it describes: a check dismissed
  // because this setup has no OBS stays dismissed for the moderator too.
  //
  // The last* fields are the channel's title and category as they stood when
  // the checklist was last completed. Twitch keeps no history of either, so
  // this is what "same title as last time" is measured against.
  goLiveChecklists: defineTable({
    instanceId: v.id("instances"),
    dismissedCheckIds: v.array(v.string()),
    lastCompletedAt: v.optional(v.number()),
    lastTitle: v.optional(v.string()),
    lastCategoryId: v.optional(v.string()),
    lastCategoryName: v.optional(v.string()),
    // Set when "Stream start" was asked for before going live; the marker is
    // dropped by whichever writer first flips instanceLiveState to live, and
    // a request older than lib/goLiveMarker.ts's window is ignored.
    pendingMarkerRequestedAt: v.optional(v.number()),
    updatedAt: v.number(),
  }).index("by_instance", ["instanceId"]),

  // streamInfoPresets: named title/category/tags combinations the Stream info
  // widget applies to the channel in one click ("Just Chatting intro").
  // Instance-scoped rather than per user: they describe the channel, so a
  // moderator sharing the account applies the same presets the owner saved.
  // The category's name and box art are copied in so the list renders without
  // a Helix round trip; only `categoryId` is sent to Twitch.
  streamInfoPresets: defineTable({
    instanceId: v.id("instances"),
    name: v.string(),
    title: v.string(),
    categoryId: v.optional(v.string()),
    categoryName: v.optional(v.string()),
    categoryBoxArtUrl: v.optional(v.string()),
    tags: v.array(v.string()),
    createdByUserId: v.id("users"),
    updatedAt: v.number(),
  }).index("by_instance_name", ["instanceId", "name"]),

  // pinnedMessages: history of things worth pinning in the channel's chat, kept
  // so the same message can be re-pinned across streams without retyping it.
  //
  // Twitch holds exactly one pinned message per channel and pins it by message
  // id, so this is deliberately NOT a mirror of that single slot — it is the
  // local list we pin *from*. `twitchMessageId` is set only for entries this app
  // posted itself; a message id stops being pinnable once its stream ends, which
  // is why the text is kept too and re-posted when the id is stale (see
  // lib/pinStrategy.ts).
  //
  // Rows predating Twitch pinning were hand-written Activity-panel notes. They
  // carry no message id and so take the re-post path, which is exactly right.
  pinnedMessages: defineTable({
    instanceId: v.id("instances"),
    authorName: v.optional(v.string()),
    content: v.string(),
    /** Set when this app posted the message; absent for hand-written entries. */
    twitchMessageId: v.optional(v.string()),
    /** When the entry was created — also when its message id was minted. */
    pinnedAt: v.number(),
    /** Last time this entry was actually pinned on Twitch, for ordering by recency of use. */
    lastPinnedAt: v.optional(v.number()),
    pinnedByUserId: v.id("users"),
  }).index("by_instance_pinned_at", ["instanceId", "pinnedAt"]),

  // streamHighlights: moments saved off the live event feed (a big cheer, a
  // raid) so they survive the feed scrolling away. Curated, not derived —
  // saved explicitly from the Activity panel's Events tab.
  streamHighlights: defineTable({
    instanceId: v.id("instances"),
    kind: v.string(), // PlatformEventType, or "note" for a hand-written one
    userName: v.string(),
    detail: v.optional(v.string()),
    amount: v.optional(v.number()),
    occurredAt: v.number(),
    savedByUserId: v.id("users"),
  }).index("by_instance_occurred_at", ["instanceId", "occurredAt"]),

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
    // DataShapeField[] naming what `trigger.data` carries when this trigger
    // fires. Preferred over deriving variables from configFields' eventPath,
    // which can only describe keys that are also config fields.
    emits: v.optional(v.array(v.any())),
    // How a configured trigger reads, e.g. "{reward} is redeemed": the module's
    // wording, with a {fieldId} placeholder for each condition value.
    sentence: v.optional(v.string()),
    supportsTiers: v.optional(v.boolean()),
    tierLabel: v.optional(v.string()),
    projectionKey: v.optional(v.string()),
    // The engine's open, multi-valued classification (e.g. ["platform.twitch"]),
    // which replaces its legacy single-value category. Groups catalog entries by
    // source without the UI hardcoding what the sources are.
    taxonomy: v.optional(v.array(v.string())),
    // The manifest trigger `type`. "webhook" triggers are fired by inbound
    // HTTP through their module's handler and never offered in the builder.
    transport: v.optional(v.string()),
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
    // DataShapeField[] naming what this action's function hands back (e.g. an
    // increment action's {next, previous}). Backs the workflow builder's
    // ${stepId.field} autocomplete. Parsed from the engine's `returns`.
    returns: v.optional(v.array(v.any())),
    projectionKey: v.optional(v.string()),
    /** See triggerDefinitions.taxonomy. */
    taxonomy: v.optional(v.array(v.string())),
    handlerType: v.optional(v.string()),
    functionCall: v.optional(v.string()),
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

  // instanceTriggers: which trigger ids are enabled for a given instance (module lifecycle).
  // Provenance (createdByType/createdByRef) is the authoritative link from a source to its
  // per-instance enablements: cleanup on module delete pivots on (instanceId, createdByRef),
  // where createdByRef == the module's composite moduleKey (== the delete correlationKey).
  // Built-ins use createdByType "SYSTEM" / createdByRef "builtin" and survive module deletes.
  instanceTriggers: defineTable({
    instanceId: v.id("instances"),
    triggerId: v.string(),
    createdByType: v.optional(v.string()),
    createdByRef: v.optional(v.string()),
    projectionKey: v.optional(v.string()),
  })
    .index("by_instance", ["instanceId"])
    .index("by_instance_trigger", ["instanceId", "triggerId"])
    .index("by_instance_ref", ["instanceId", "createdByRef"])
    // Across all instances: answers "does anyone still enable this definition?",
    // which is what decides whether an uninstall may delete the shared def row.
    .index("by_trigger", ["triggerId"]),

  // instanceActions: which action ids are enabled for a given instance.
  // See instanceTriggers for the rationale behind storing provenance here.
  instanceActions: defineTable({
    instanceId: v.id("instances"),
    actionId: v.string(),
    createdByType: v.optional(v.string()),
    createdByRef: v.optional(v.string()),
    projectionKey: v.optional(v.string()),
  })
    .index("by_instance", ["instanceId"])
    .index("by_instance_action", ["instanceId", "actionId"])
    .index("by_instance_ref", ["instanceId", "createdByRef"])
    // See instanceTriggers.by_trigger.
    .index("by_action", ["actionId"]),

  // instanceFunctions: which function ids are enabled for a given instance
  instanceFunctions: defineTable({
    instanceId: v.id("instances"),
    functionId: v.string(), // engine FunctionDefinition.id
    projectionKey: v.optional(v.string()),
  })
    .index("by_instance", ["instanceId"])
    .index("by_instance_function", ["instanceId", "functionId"]),

  // instanceWidgets: which widget ids are placeable for a given instance. Mirrors
  // instanceFunctions: a thin per-instance join over the moduleWidgets definition
  // catalog. Provenance keys cleanup on module delete (createdByRef == moduleKey);
  // built-ins (createdByType "SYSTEM") persist across module uninstalls.
  instanceWidgets: defineTable({
    instanceId: v.id("instances"),
    widgetId: v.string(),
    createdByType: v.optional(v.string()),
    createdByRef: v.optional(v.string()),
    projectionKey: v.optional(v.string()),
  })
    .index("by_instance", ["instanceId"])
    .index("by_instance_widget", ["instanceId", "widgetId"])
    .index("by_instance_ref", ["instanceId", "createdByRef"])
    // See instanceTriggers.by_trigger.
    .index("by_widget", ["widgetId"]),

  // starterPackItems: which starter pack items (convex/lib/starterPacks.ts) an
  // instance has installed, and the engine workflow or command each became.
  // A row is written as "installing" before the engine call, so a second
  // install racing the first finds it and skips the item instead of creating
  // a duplicate. An installed row whose engine object has since been deleted
  // counts as not installed.
  starterPackItems: defineTable({
    instanceId: v.id("instances"),
    packId: v.string(),
    itemId: v.string(),
    kind: v.union(v.literal("workflow"), v.literal("command")),
    status: v.union(v.literal("installing"), v.literal("installed")),
    // engineWorkflowId or engineCommandId; absent while installing.
    engineId: v.optional(v.string()),
    // The workflow create's correlation key, so an echo that arrives after
    // the install stopped waiting still marks the row installed.
    correlationKey: v.optional(v.string()),
    claimedAt: v.number(),
  })
    .index("by_instance", ["instanceId"])
    .index("by_instance_item", ["instanceId", "packId", "itemId"])
    .index("by_correlation", ["correlationKey"]),

  // setupImports: a streamer's setup brought over from Firebot or Streamer.bot
  // (convex/lib/setupImport). Converted when the file is read, reviewed, then
  // applied by convex/setupImports.ts through the same engine calls the UI
  // makes. `leftovers` are parts of the setup woofx3 has no place for at all.
  setupImports: defineTable({
    instanceId: v.id("instances"),
    source: v.union(v.literal("firebot"), v.literal("streamerbot")),
    label: v.string(),
    createdByUserId: v.id("users"),
    createdAt: v.number(),
    status: v.union(v.literal("review"), v.literal("queued"), v.literal("applying"), v.literal("done")),
    leftovers: v.array(
      v.object({ origin: v.string(), name: v.string(), message: v.string(), detail: v.optional(v.string()) })
    ),
    queuedAt: v.optional(v.number()),
    finishedAt: v.optional(v.number()),
    // Held while an apply runs, so two scheduled at once do not both create items.
    claimedAt: v.optional(v.number()),
    // Why a queued import has not started: it waits for setup to install the modules it needs.
    waitingFor: v.optional(v.string()),
    // Set when it gave up waiting (on an engine that never registered); retrying starts it again.
    stalled: v.optional(v.boolean()),
  }).index("by_instance", ["instanceId", "createdAt"]),

  // setupImportItems: one engine object an import creates, and how creating it
  // went. `spec` is the converted item (lib/setupImport/types.ts), stored with
  // `$` keys escaped. `engineId` is the engine id of the workflow, command or
  // group, or the canonical id of a counter. Items with the same source and
  // key are the same thing from the same file, so importing it again finds
  // what the first import created instead of duplicating it.
  setupImportItems: defineTable({
    importId: v.id("setupImports"),
    instanceId: v.id("instances"),
    source: v.union(v.literal("firebot"), v.literal("streamerbot")),
    order: v.number(),
    key: v.string(),
    kind: v.union(v.literal("group"), v.literal("counter"), v.literal("command"), v.literal("workflow")),
    name: v.string(),
    origin: v.string(),
    readiness: v.union(v.literal("ready"), v.literal("partial"), v.literal("unsupported")),
    notes: v.array(
      v.object({ message: v.string(), detail: v.optional(v.string()), blocking: v.optional(v.boolean()) })
    ),
    // What it does, step by step, as the report lists it.
    steps: v.array(v.string()),
    spec: v.any(),
    outcome: v.optional(
      v.union(
        v.literal("created"),
        v.literal("exists"),
        v.literal("needs_module"),
        v.literal("skipped"),
        v.literal("pending"),
        v.literal("failed")
      )
    ),
    message: v.optional(v.string()),
    engineId: v.optional(v.string()),
    // The workflow create's correlation key, so an echo that arrives after the
    // apply stopped waiting still marks the item created.
    correlationKey: v.optional(v.string()),
  })
    .index("by_import", ["importId", "order"])
    .index("by_instance_key", ["instanceId", "source", "key"])
    .index("by_correlation", ["correlationKey"]),

  // workflows: Convex-side mirror of canonical engine WorkflowDefinition, plus
  // an optional ReactFlow projection cache (nodes/edges) derived in the browser.
  workflows: defineTable({
    instanceId: v.id("instances"),
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
    .index("by_instance_enabled", ["instanceId", "isEnabled"])
    .index("by_engine_id", ["instanceId", "engineWorkflowId"]),

  // workflowHealth: whether the engine runs each stored workflow on its own,
  // from the workflow.health.* webhooks and the getWorkflowHealth() resync
  // (convex/lib/workflowHealth.ts). Its own table rather than fields on
  // `workflows` because a report can arrive before that row is mirrored, and
  // because a health change should not rewrite a row carrying the definition.
  // Ok rows are kept: their `sinceMs` is what makes a late error redelivery stale.
  workflowHealth: defineTable({
    instanceId: v.id("instances"),
    engineWorkflowId: v.string(),
    status: v.union(v.literal("ok"), v.literal("error")),
    reason: v.optional(v.string()),
    since: v.string(), // ISO, as the engine sent it
    sinceMs: v.number(), // since parsed, for ordering reports
    receivedAt: v.number(),
  })
    .index("by_engine_id", ["instanceId", "engineWorkflowId"])
    .index("by_instance_status", ["instanceId", "status"]),

  // workflowHealthSyncs: one row per instance holding the last
  // getWorkflowHealth() resync attempt, so page mounts and reconnects across
  // tabs share one throttle. "unsupported" means the engine predates the RPC.
  workflowHealthSyncs: defineTable({
    instanceId: v.id("instances"),
    attemptedAt: v.number(),
    outcome: v.optional(v.union(v.literal("ok"), v.literal("unsupported"), v.literal("failed"))),
  }).index("by_instance", ["instanceId"]),

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

  // twitchOAuthState: short-lived CSRF state for Twitch OAuth flow.
  // Twitch-specific today (login bridge + account-level integration-connect).
  // TODO: when a second login-bridge platform is added (YouTube, Kick, etc.),
  // generalize this the same way platformLinks already has a `platform` field,
  // rather than adding a parallel per-platform state table.
  twitchOAuthState: defineTable({
    state: v.string(),
    redirectTo: v.string(),
    instanceId: v.optional(v.id("instances")),
    // The signed-in owner or admin who started an integration connect. Absent
    // for the sign-in flow, which has no user yet.
    userId: v.optional(v.id("users")),
    // SHA-256 of the nonce the sign-in's browser tab keeps (lib/oauthHandoff.ts).
    // Present only for the sign-in flow; carried to twitchPendingAuth.
    nonceHash: v.optional(v.string()),
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
    // The sign-in completes only in the browser tab holding the nonce behind
    // this hash. Rows without one are refused.
    nonceHash: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_token", ["token"]),

  // oauthConnectHandoffs: the result of an integration OAuth callback, held
  // until the signed-in user who started the flow claims it with the one-time
  // code the callback put in the browser's URL (lib/oauthHandoff.ts). Only the
  // code's hash is stored. Rows are single use and deleted after five minutes
  // whether or not they are claimed.
  // integrationCredentials: the OAuth apps woofx3 provides for first-party
  // integrations, one row per integration. Managed instances use them when a
  // module has no app of its own (spotifyIntegration.resolveClientId); external
  // instances bring their own. Written only through internal functions
  // (integrationCredentials.ts), and never returned to a browser.
  integrationCredentials: defineTable({
    integration: v.literal("spotify"),
    clientId: v.string(),
    clientSecret: v.optional(v.string()),
    updatedAt: v.number(),
  }).index("by_integration", ["integration"]),

  oauthConnectHandoffs: defineTable({
    codeHash: v.string(),
    provider: v.union(v.literal("twitch"), v.literal("spotify"), v.literal("module")),
    userId: v.id("users"),
    instanceId: v.id("instances"),
    moduleId: v.optional(v.string()),
    redirectTo: v.string(),
    twitch: v.optional(
      v.object({
        platformUserId: v.string(),
        platformUsername: v.string(),
        profileImageUrl: v.optional(v.string()),
        accessToken: v.string(),
        refreshToken: v.string(),
        expiresAt: v.number(),
        scopes: v.array(v.string()),
      })
    ),
    spotify: v.optional(
      v.object({
        clientId: v.string(),
        authToken: v.string(),
        refreshToken: v.string(),
      })
    ),
    // A module OAuth connect (`moduleOAuth.ts`) carries the authorization
    // code, not tokens: the engine exchanges it and keeps the tokens.
    moduleOAuth: v.optional(
      v.object({
        integration: v.string(),
        code: v.string(),
        codeVerifier: v.string(),
        redirectUri: v.string(),
      })
    ),
    createdAt: v.number(),
  }).index("by_code_hash", ["codeHash"]),

  // moduleIntegrationState: short-lived, one-time-use state for a module
  // setting's "integration" button (see moduleDetail.ts's ManifestSettingAction).
  // Generic across integration *types*, not just OAuth — `data` is opaque here
  // and interpreted only by whichever integration populated it (e.g. Spotify's
  // OAuth-with-PKCE flow stores { clientId, codeVerifier }). Distinct from
  // twitchOAuthState: this is module-scoped (instanceId + moduleId), not the
  // account-level login-bridge case.
  moduleIntegrationState: defineTable({
    state: v.string(),
    instanceId: v.id("instances"),
    moduleId: v.string(),
    integration: v.string(),
    redirectTo: v.string(),
    // The signed-in member who started the flow (spotifyConnect.start). Rows
    // without one predate that check and are refused at the callback.
    userId: v.optional(v.id("users")),
    data: v.any(),
    createdAt: v.number(),
  }).index("by_state", ["state"]),

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

  // browserSourceKeys: unique opaque keys for browser sources. Each row is
  // backed by an engine-minted overlay token (see overlayTokenRoutes on the
  // engine) — `key` stays Convex's own opaque public identity (what users
  // paste into OBS via /browser-source/{key}), while `engineTokenId` and
  // `overlayUrl` cache what it actually resolves to under the hood.
  browserSourceKeys: defineTable({
    instanceId: v.id("instances"),
    sceneId: v.id("scenes"),
    key: v.string(),
    name: v.string(),
    createdAt: v.number(),
    lastUsedAt: v.optional(v.number()),
    // "obs" (default when absent, for rows predating this field) = the
    // public OBS browser-source URL. "preview" = the Scene Manager's
    // internal live-canvas preview — kept as a separate row so
    // rotating/revoking one never disturbs the other.
    purpose: v.optional(v.union(v.literal("obs"), v.literal("preview"))),
    engineTokenId: v.optional(v.string()),
    overlayUrl: v.optional(v.string()),
  })
    .index("by_instance", ["instanceId"])
    .index("by_key", ["key"])
    .index("by_scene", ["sceneId"])
    .index("by_scene_purpose", ["sceneId", "purpose"])
    .index("by_engine_token_id", ["engineTokenId"]),

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
  // `canonicalId` and `projectionKey` are module-relative, so every tenant that
  // installs the module produces the same values — a row is only identified by
  // pairing one with the owning moduleId, which is itself instance-scoped.
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
    .index("by_module_canonical", ["moduleId", "canonicalId"]),

  // moduleResourceInstances: runtime-created instances of module-declared resource
  // kinds (e.g. user-defined counters). Mirrors engine ResourceInstanceDefinition.
  // Backs resource_ref ConfigField pickers in the workflow builder.
  // `canonicalId` is `{moduleName}:{kind}:{instanceId}` where that instanceId is
  // the engine's manifest-local resource id — two tenants can produce the same
  // one, so it only identifies a row alongside the owning Convex instanceId.
  moduleResourceInstances: defineTable({
    instanceId: v.id("instances"),
    moduleId: v.id("moduleRepository"),
    engineInstanceId: v.string(), // ResourceInstanceDefinition.id (engine UUID)
    resourceInstanceId: v.string(), // manifest-local instance id
    moduleName: v.string(),
    kind: v.string(),
    displayName: v.string(),
    canonicalId: v.string(), // {moduleName}:{kind}:{instanceId}
    // What the instance was created with: its kind's `schema` field values.
    // Optional for rows mirrored before instances carried settings.
    settings: v.optional(v.any()),
  })
    .index("by_instance", ["instanceId"])
    .index("by_module", ["moduleId"])
    .index("by_instance_module", ["instanceId", "moduleId"])
    .index("by_instance_canonical", ["instanceId", "canonicalId"])
    .index("by_instance_kind", ["instanceId", "kind"]),

  // resourceValues: the current value of each resource instance (a counter's
  // number), mirrored from the owning module's storage at `state:<canonicalId>`.
  // Kept here because the storage-changed webhook only lands in transientEvents,
  // which expire after a minute -- too short to serve as a current value. Upserted
  // from that webhook and refreshed from the engine's getResourceValues. `value`
  // is null when the instance holds nothing, which reads as its initial value.
  resourceValues: defineTable({
    instanceId: v.id("instances"),
    canonicalId: v.string(),
    value: v.any(),
    updatedAt: v.number(),
  }).index("by_instance_canonical", ["instanceId", "canonicalId"]),

  // moduleWidgets: global widget DEFINITION catalog (module-sourced AND built-in).
  // moduleId is optional — built-in widgets (createdByType "SYSTEM") have no module.
  // Per-instance placement lives in instanceWidgets. createdByRef == moduleKey for
  // module widgets, "builtin" for SYSTEM widgets.
  moduleWidgets: defineTable({
    moduleId: v.optional(v.id("moduleRepository")),
    widgetId: v.string(),
    name: v.string(),
    directory: v.string(),
    description: v.optional(v.string()),
    createdByType: v.optional(v.string()),
    createdByRef: v.optional(v.string()),
    projectionKey: v.optional(v.string()),
    alertTypes: v.array(v.string()),
    // ConfigField[] — the same shape triggers and actions store in
    // `configFields` above, and stored the same way. It used to be an
    // enumerated object with its own `key`/`fieldType` vocabulary, which both
    // forked the contract and made every new ConfigField property a breaking
    // change for widget sync.
    settings: v.array(v.any()),
    // Where the widget may be placed: "scene", "alert", or both. Absent on
    // rows registered before widgets declared it, which are scene widgets.
    surfaces: v.optional(v.array(v.string())),
    // The surface this widget's placements host: "alert" for the alert
    // widget, the area of a scene where alert layouts play.
    hostsSurface: v.optional(v.string()),
    // Open, multi-valued dotted classification ("media.video"), the same axis
    // triggers and actions carry. The scene editor's catalog groups on it.
    // Absent on rows registered before widgets declared it, and empty for a
    // widget whose author declared none.
    taxonomy: v.optional(v.array(v.string())),
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
    .index("by_instance_status", ["instanceId", "status"])
    // The alerts one run published, for that run's trace.
    .index("by_instance_workflow", ["instanceId", "workflowId"]),

  // workflowRuns: durable history of runs the engine recorded, projected from
  // the db-proxy outbox. Distinct from transientEvents, which carries the live
  // progress of a run someone is waiting on and expires in a minute: these are
  // the runs nobody was watching, which is exactly why they are kept.
  //
  // Runs fired by hand with the unrecorded `dashboard` origin never reach here;
  // the engine does not record them. Test runs and Runs-panel replays carry an
  // origin of their own so they do -- see lib/manualRunOrigin.ts.
  workflowRuns: defineTable({
    instanceId: v.id("instances"),
    engineRunId: v.string(), // WorkflowRunSnapshot.id (the engine's execution id)
    workflowId: v.string(),
    // Left open rather than a union: run statuses come from the engine's own
    // ExecutionStatus, which has values that do not reach here yet ("waiting").
    // A union would force coercing an unknown status into a wrong one.
    status: v.string(),
    triggeredBy: v.optional(v.string()),
    // The originating CloudEvent, verbatim. What a replay re-feeds.
    triggerEvent: v.optional(v.string()),
    // A dry run: its side-effecting steps recorded what they would have done
    // instead of doing it. Absent for a real run.
    dryRun: v.optional(v.boolean()),
    error: v.optional(v.string()),
    startedAt: v.optional(v.string()),
    completedAt: v.optional(v.string()),
    engineCreatedAt: v.string(),
    engineUpdatedAt: v.string(),
    createdAt: v.number(), // Convex-side ingest time
  })
    .index("by_instance", ["instanceId"])
    .index("by_engine_id", ["engineRunId"])
    .index("by_instance_workflow", ["instanceId", "workflowId"]),

  // workflowRunSteps: one row per attempt at a task within a run.
  //
  // `inputs` is the parameters as resolved at run time and `outputs` the task's
  // exports -- the two things the definition cannot reproduce, and what a
  // resume restores. Both are JSON strings; nothing here reads inside them.
  workflowRunSteps: defineTable({
    instanceId: v.id("instances"),
    engineStepId: v.string(),
    runId: v.string(), // engineRunId of the owning run
    taskId: v.string(),
    name: v.optional(v.string()),
    status: v.string(),
    attempt: v.number(),
    stepIndex: v.number(),
    inputs: v.optional(v.string()),
    outputs: v.optional(v.string()),
    error: v.optional(v.string()),
    startedAt: v.optional(v.string()),
    completedAt: v.optional(v.string()),
    durationMs: v.optional(v.number()),
    engineCreatedAt: v.string(),
    engineUpdatedAt: v.string(),
    createdAt: v.number(),
  })
    // The timeline's only read: every step of one run, in execution order.
    .index("by_run", ["runId", "stepIndex"])
    // Upsert key, mirroring the unique index Postgres enforces. Webhook
    // delivery is at-least-once, so without this a repeated report shows the
    // same step twice.
    .index("by_attempt", ["runId", "taskId", "attempt"]),

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

  // engineEventLog: audit trail of every engine webhook event received
  // (source: "webhook", written by the POST /api/webhooks/woofx3 handler in
  // http.ts) plus every manual re-fire of a logged event from the Debug page
  // (source: "retrigger", written by engineEventLog.retrigger). payload is a
  // JSON string of the raw, unescaped event data — never structured v.any(),
  // since the engine embeds $ref keys that Convex rejects on structured
  // fields (see lib/dollarKeys.ts).
  engineEventLog: defineTable({
    instanceId: v.id("instances"),
    eventType: v.string(),
    payload: v.string(),
    source: v.union(v.literal("webhook"), v.literal("retrigger")),
    envelopeId: v.optional(v.string()), // CloudEvents `id` — webhook rows only
    engineEventTime: v.optional(v.string()), // CloudEvents `time` — webhook rows only
    userId: v.optional(v.id("users")), // who fired it — retrigger rows only
    retriggerOfId: v.optional(v.id("engineEventLog")), // retrigger rows only
    success: v.optional(v.boolean()), // retrigger rows only
    errorMessage: v.optional(v.string()),
    receivedAt: v.number(),
  })
    .index("by_instance_received_at", ["instanceId", "receivedAt"])
    .index("by_instance_type_received_at", ["instanceId", "eventType", "receivedAt"])
    .index("by_received_at", ["receivedAt"]),

  // instanceSync: per-instance sync schedule and state. Driven by the
  // engine-sync sweep cron. One row per instance; created lazily on first
  // sweep eligibility check.
  instanceSync: defineTable({
    instanceId: v.id("instances"),
    lastSyncedAt: v.number(),
    nextEligibleAt: v.number(),
    status: v.union(v.literal("idle"), v.literal("running"), v.literal("success"), v.literal("error")),
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
          v.literal("modules"),
          v.literal("commands"),
          v.literal("groups"),
          v.literal("functions"),
          v.literal("workflows"),
          v.literal("scenes"),
          v.literal("triggers"),
          v.literal("actions"),
          v.literal("widgets"),
          v.literal("resources")
        ),
        status: v.union(v.literal("pending"), v.literal("running"), v.literal("success"), v.literal("error")),
        itemsProcessed: v.number(),
        error: v.optional(v.string()),
        startedAt: v.optional(v.number()),
        completedAt: v.optional(v.number()),
      })
    ),
    error: v.optional(v.string()),
  })
    .index("by_instance_recent", ["instanceId", "startedAt"])
    .index("by_started_at", ["startedAt"]),

  // webhookEndpoints: public third-party ingress, one per webhook trigger per
  // instance. The row is the capability: its endpointId is the URL. It is
  // disabled rather than deleted on deregistration, so an upgrade, reinstall
  // or rollback never changes the URL. It holds no function name and no
  // secret; the engine owns both.
  webhookEndpoints: defineTable({
    instanceId: v.id("instances"),
    endpointId: v.string(),
    // The webhook trigger's canonical id, {modulePrefix}:trigger:{triggerId}
    // (the engine's projectionKey); what the engine resolves the handler by.
    triggerKey: v.string(),
    modulePrefix: v.string(),
    triggerManifestId: v.string(),
    isEnabled: v.boolean(),
    lastDeliveryAt: v.optional(v.number()),
    lastStatus: v.optional(v.number()),
    lastError: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_endpoint_id", ["endpointId"])
    .index("by_instance_trigger", ["instanceId", "triggerKey"])
    .index("by_instance_module", ["instanceId", "modulePrefix"]),

  // feedbackPosts: the Feedback board's ideas and bug reports. Not instance
  // scoped: the board is one product-wide list every signed-in user reads and
  // votes on. `status` is set only by internal functions, since triaging the
  // board belongs to the operators, not to users.
  //
  // voteCount and commentCount mirror feedbackVotes and feedbackComments and
  // are kept in the same mutation as every insert or delete there; the board
  // sorts by voteCount, and Convex has no count operator to sort by instead.
  feedbackPosts: defineTable({
    authorId: v.id("users"),
    kind: feedbackKindValidator,
    title: v.string(),
    body: v.string(),
    status: feedbackStatusValidator,
    voteCount: v.number(),
    commentCount: v.number(),
    statusChangedAt: v.optional(v.number()),
    editedAt: v.optional(v.number()),
  })
    .index("by_vote_count", ["voteCount"])
    .index("by_status", ["status"])
    .index("by_status_and_vote_count", ["status", "voteCount"])
    .searchIndex("search_title", { searchField: "title", filterFields: ["status"] }),

  // feedbackVotes: one row per (post, user); its presence is the vote.
  feedbackVotes: defineTable({
    postId: v.id("feedbackPosts"),
    userId: v.id("users"),
  })
    .index("by_post_and_user", ["postId", "userId"])
    .index("by_user", ["userId"]),

  feedbackComments: defineTable({
    postId: v.id("feedbackPosts"),
    authorId: v.id("users"),
    body: v.string(),
  }).index("by_post", ["postId"]),
});
