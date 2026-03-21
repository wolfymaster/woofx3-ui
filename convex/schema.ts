import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";

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
  }).index("by_account", ["accountId"]),

  // instanceMembers: users who have access to an instance
  instanceMembers: defineTable({
    instanceId: v.id("instances"),
    userId: v.id("users"),
    role: v.union(
      v.literal("owner"),
      v.literal("admin"),
      v.literal("member")
    ),
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

  // assets: uploaded files (images/audio/video) stored in Convex file storage
  assets: defineTable({
    instanceId: v.id("instances"),
    name: v.string(),
    type: v.union(
      v.literal("image"),
      v.literal("audio"),
      v.literal("video")
    ),
    storageId: v.id("_storage"),
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
      v.literal("static"),   // fixed text response
      v.literal("dynamic"),  // template with {{variable}} substitution
      v.literal("function")  // invokes a module function
    ),
    response: v.optional(v.string()),   // for static type
    template: v.optional(v.string()),   // for dynamic type ({{username}}, {{args}}, etc.)
    functionId: v.optional(v.string()), // for function type (module function reference)
    cooldown: v.number(), // seconds between uses
    enabled: v.boolean(),
    createdAt: v.number(),
  }).index("by_instance", ["instanceId"]),

  // moduleRepository: directory of all available modules (seeded by admins)
  moduleRepository: defineTable({
    name: v.string(),
    description: v.string(),
    version: v.string(),
    tags: v.array(v.string()),
    manifest: v.any(),
    archiveKey: v.string(),
  }),

  // installedModules: which modules are installed per instance
  installedModules: defineTable({
    instanceId: v.id("instances"),
    moduleId: v.id("moduleRepository"),
    enabled: v.boolean(),
    installedAt: v.number(),
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

  // workflowTemplates: predefined workflow templates for common Twitch events
  workflowTemplates: defineTable({
    name: v.string(),
    description: v.string(),
    trigger: v.string(), // "follow" | "subscribe" | "bits" | "raid" | "gift"
    workflowJson: v.any(),
  }),

  // licenses: entitlements per account
  licenses: defineTable({
    accountId: v.id("accounts"),
    tier: v.union(
      v.literal("free"),
      v.literal("pro"),
      v.literal("enterprise")
    ),
    features: v.array(v.string()),
    expiresAt: v.optional(v.number()),
    createdAt: v.number(),
  }).index("by_account", ["accountId"]),
});
