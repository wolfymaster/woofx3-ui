# Module Improvements Design
**Date:** 2026-04-03  
**Repo:** woofx3-ui  
**Source spec:** module-improvements-spec.md

---

## Context

woofx3 is being refactored from a feature-rich monolith into a pluggable, event-driven platform where all domain functionality is delivered as installable modules. The core ships with zero built-in functionality — alerts, Twitch events, OBS control, and chat commands all come from modules.

This document covers the UI-layer (woofx3-ui) changes required to support that vision. The backend services (barkloader, workflow engine, NATS, DB proxy) already exist in the woofx3 repo. This repo integrates with them via the WoofxTransport abstraction (Capnweb RPC → `/api` service → Twirp DB proxy).

**Data ownership split (unchanged from existing pattern):**
- **Convex** — UI-owned metadata: scenes, widget instances, command display config, webhook URLs/secrets, module install status
- **Engine** — Runtime-owned data: workflow execution, trigger registration, module function invocation, NATS events

---

## Architecture

### Service Communication
```
woofx3-ui (React + Convex)
    │
    ├── Convex mutations/queries  →  Convex cloud (UI database)
    │
    └── WoofxTransport (browser-transport.ts)
            │
            └── Capnweb RPC  →  /api service (port configurable)
                                      │
                                      ├── Twirp  →  DB proxy (port 8080)
                                      │               ├── ModuleService
                                      │               ├── CommandService
                                      │               ├── WorkflowService
                                      │               └── ...
                                      │
                                      └── WebSocket  →  barkloader (port 3005)
```

### Key Constraints
- All Convex tables scoped by `instanceId` for multi-tenancy
- Install key format: `version#sha256` — exact key cannot be reloaded
- Trigger deduplication: first module to register a `trigger_id` wins; subsequent attempts silently no-op
- Role permissions apply only to commands (the only user-initiated trigger type)
- One active version per module per instance at a time

---

## Phase 1 — Schema & Types Foundation

**Files:** `convex/schema.ts`, `client/src/types/index.ts`, `client/src/lib/transport/interface.ts`

### New Convex Tables

```typescript
// Commands registered by modules
moduleCommands: defineTable({
  instanceId: v.id("instances"),
  moduleId: v.optional(v.id("installedModules")),
  name: v.string(),
  description: v.optional(v.string()),
  pattern: v.string(),
  patternType: v.union(v.literal("prefix"), v.literal("exact"), v.literal("regex")),
  requiredRole: v.string(),            // "public" | "subscriber" | "moderator" | "broadcaster" | custom
  workflowId: v.optional(v.id("workflows")),
  isEnabled: v.boolean(),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_instance", ["instanceId"])
  .index("by_module", ["moduleId"])

// HTTP trigger endpoints
webhookEndpoints: defineTable({
  instanceId: v.id("instances"),
  triggerId: v.string(),               // matches triggerDefinition trigger_id
  endpointId: v.string(),              // UUID — appears in URL /webhooks/{endpointId}
  signingSecret: v.string(),
  isEnabled: v.boolean(),
  lastTriggeredAt: v.optional(v.number()),
  createdAt: v.number(),
})
  .index("by_instance", ["instanceId"])
  .index("by_endpoint_id", ["endpointId"])

// Function assets extracted from module ZIPs
moduleFunctions: defineTable({
  instanceId: v.id("instances"),
  moduleId: v.id("installedModules"),
  functionRef: v.string(),             // #func reference from manifest
  runtime: v.string(),                 // "lua" | future runtimes
  storageKey: v.string(),              // key in storage backend
  createdAt: v.number(),
})
  .index("by_module", ["moduleId"])
  .index("by_function_ref", ["instanceId", "functionRef"])
```

### Modified Tables

**`moduleRepository`** — add versioning and structured manifest:
```typescript
version: v.string(),                   // semver
sha256: v.string(),
installKey: v.string(),                // "version#sha256" — unique constraint
status: v.union(
  v.literal("active"),
  v.literal("disabled"),
  v.literal("error"),
),
errorMessage: v.optional(v.string()),
manifest: v.object({                   // structured, not v.any()
  id: v.string(),
  name: v.string(),
  version: v.string(),
  description: v.optional(v.string()),
  triggers: v.array(v.any()),
  actions: v.array(v.any()),
  commands: v.array(v.any()),
  workflows: v.array(v.any()),
  widgets: v.array(v.any()),
  overlays: v.array(v.any()),
  functions: v.array(v.any()),
}),
```

**`installedModules`** — add status and version tracking:
```typescript
status: v.union(v.literal("active"), v.literal("disabled"), v.literal("error")),
installKey: v.string(),
version: v.string(),
installedAt: v.number(),
errorMessage: v.optional(v.string()),
```

**`scenes`** — type the widgets field:
```typescript
widgets: v.optional(v.array(v.object({
  id: v.string(),
  moduleWidgetId: v.id("moduleWidgets"),
  positionX: v.number(),
  positionY: v.number(),
  width: v.number(),
  height: v.number(),
  zIndex: v.number(),
  settings: v.record(v.string(), v.any()),
}))),
```

**`chatCommands`** — link to modules and workflows:
```typescript
moduleId: v.optional(v.id("installedModules")),
requiredRole: v.optional(v.string()),
workflowId: v.optional(v.id("workflows")),
```

### New TypeScript Types

```typescript
// client/src/types/index.ts additions

export type ModuleStatus = "active" | "disabled" | "error"
export type CommandPatternType = "prefix" | "exact" | "regex"
export type DefaultRole = "public" | "subscriber" | "moderator" | "broadcaster"

export interface ModuleManifest {
  id: string
  name: string
  version: string
  description?: string
  triggers: ManifestTrigger[]
  actions: ManifestAction[]
  commands: ManifestCommand[]
  workflows: ManifestWorkflow[]
  widgets: ManifestWidget[]
  overlays: ManifestOverlay[]
  functions: ManifestFunction[]
}

export interface WidgetInstance {
  id: string
  moduleWidgetId: string
  positionX: number
  positionY: number
  width: number
  height: number
  zIndex: number
  settings: Record<string, unknown>
}

export interface WebhookEndpoint {
  id: string
  instanceId: string
  triggerId: string
  endpointId: string
  signingSecret: string
  isEnabled: boolean
  lastTriggeredAt?: number
  url: string  // derived: /webhooks/{endpointId}
}

export interface ModuleCommand {
  id: string
  instanceId: string
  moduleId?: string
  name: string
  pattern: string
  patternType: CommandPatternType
  requiredRole: string
  workflowId?: string
  isEnabled: boolean
}
```

### Transport Interface Extensions

```typescript
// client/src/lib/transport/interface.ts additions

// Module management
installModule(manifest: ModuleManifest, functionAssets: Record<string, ArrayBuffer>): Promise<{ moduleId: string }>
uninstallModule(moduleId: string): Promise<void>
setModuleStatus(moduleId: string, status: "active" | "disabled"): Promise<void>
listEngineModules(): Promise<EngineModule[]>

// Command management
createCommand(instanceId: string, command: CreateCommandInput): Promise<{ commandId: string }>
updateCommand(commandId: string, updates: UpdateCommandInput): Promise<void>
deleteCommand(commandId: string): Promise<void>

// Webhook management
createWebhookEndpoint(instanceId: string, triggerId: string): Promise<{ endpointId: string, signingSecret: string }>
deleteWebhookEndpoint(endpointId: string): Promise<void>

// Workflow trigger
triggerWorkflow(workflowId: string, params?: Record<string, string>): Promise<{ executionId: string }>
```

---

## Phase 2 — Module System Overhaul

**Files:** `convex/moduleRepository.ts`, `convex/installedModules.ts`, `client/src/pages/modules.tsx`, `client/src/pages/module-install.tsx`, `client/src/lib/transport/browser-transport.ts`

### Install Flow

Convex mutations cannot receive large binary payloads. The install flow uses a two-step approach: heavy lifting client-side, metadata only to Convex.

```
User uploads ZIP (client-side, using jszip or fflate)
    │
    ├── 1. Parse ZIP in browser — extract manifest.json + function blobs
    ├── 2. Validate manifest schema
    ├── 3. Compute install key: `${version}#${sha256(zipBytes)}`
    ├── 4. Call transport.installModule(manifest, functionBlobs)
    │       → /api service → barkloader
    │       ├── Register triggers (dedup: first-wins silently)
    │       ├── Register actions
    │       ├── Register commands in engine
    │       └── Extract + store function assets in barkloader storage
    ├── 5. On transport success, call convex.installedModules.install(instanceId, manifest, installKey)
    │       ├── Check for duplicate installKey → reject if exists
    │       ├── Deactivate current active version of same module_id
    │       ├── Insert moduleRepository record with status="active"
    │       ├── Insert installedModules record
    │       ├── Insert moduleCommands for each command in manifest
    │       ├── Insert webhookEndpoints for each webhook trigger (generate endpointId + signingSecret)
    │       └── Insert moduleFunctions metadata (storageKey from transport response)
    └── 6. On any failure → set moduleRepository.status="error" with errorMessage
```

### Version Management

- `activateModuleVersion(instanceId, moduleRepositoryId)` — deactivates current active version, activates target
- `deactivateModule(instanceId, moduleId)` — sets status to "disabled" without uninstalling

### Convex Functions

**`convex/installedModules.ts`** new mutations:
- `install(instanceId, zipBytes, manifest)` — full install flow above
- `setStatus(id, status)` — enable/disable
- `activateVersion(instanceId, targetRepositoryId)` — version switch

### Updated Module UI

Module list page shows:
- Module card: name, version badge, status chip (color-coded)
- Enable/disable toggle
- "Change version" button if multiple versions in repository
- Install new module button (opens upload flow)

Module install page:
- File drop zone (accepts .zip only)
- Manifest preview after parsing (name, version, triggers/actions/commands count)
- Confirm button triggers install flow
- Progress indicator during install

---

## Phase 3 — Command & Permission System

**Files:** `convex/commands.ts` (new), `client/src/pages/settings.tsx` or new `client/src/pages/commands.tsx`

### Convex Functions (convex/commands.ts)

```typescript
// Queries
export const list = query(...)         // list by instanceId
export const getByModule = query(...)  // commands for a module

// Mutations  
export const create = mutation(...)
export const update = mutation(...)    // update requiredRole, workflowId, isEnabled
export const remove = mutation(...)
export const bulkCreateFromModule = internalMutation(...)  // called during module install
```

### Role System

Roles are constants first, custom roles via optional Convex table later.

```typescript
// client/src/lib/roles.ts
export const DEFAULT_ROLES = ["public", "subscriber", "moderator", "broadcaster"] as const
export type DefaultRole = typeof DEFAULT_ROLES[number]
```

No database table needed for roles unless custom roles are required — defer custom roles to a future iteration.

### Command Configuration UI

Route: `/commands` (new page or tab within settings)

UI shows:
- Table of all commands for this instance (from all modules + user-created)
- Columns: name, pattern, module, required role (editable dropdown), linked workflow (editable dropdown), enabled toggle
- Inline editing for required role and linked workflow
- "New command" button for user-created commands

---

## Phase 4 — Webhook Integration

**Files:** `convex/webhooks.ts` (new), `convex/http.ts` (update), `client/src/pages/settings.tsx` or new page

### Convex Functions (convex/webhooks.ts)

```typescript
export const list = query(...)                          // list by instanceId
export const create = mutation(...)                     // provision endpoint + generate secret
export const remove = mutation(...)
export const rotateSecret = mutation(...)               // generate new signingSecret
export const recordTrigger = internalMutation(...)      // update lastTriggeredAt
```

### HTTP Handler (convex/http.ts)

New route: `POST /webhooks/:endpointId`

The Convex HTTP handler is server-side and cannot use the client-side WoofxTransport. It resolves the correct instance's engine API URL at runtime via the `instances` table.

```typescript
// 1. Look up webhookEndpoints by endpointId (runQuery) → get instanceId + triggerId + signingSecret
// 2. Validate HMAC-SHA256: crypto.subtle.verify against signingSecret → 401 if invalid
// 3. Check isEnabled → 404 if disabled
// 4. Look up instances by instanceId → get engineApiUrl
// 5. Call fetch(`${engineApiUrl}/trigger`, { method: "POST", body: { triggerId, payload } })
// 6. runMutation(webhooks.recordTrigger, { endpointId, triggeredAt: Date.now() })
// 7. Return 200 { received: true }
```

Signature header: `X-Signature: sha256={hex_hmac}` over the raw request body.

**Schema addition to `instances`:**
```typescript
engineApiUrl: v.optional(v.string()),  // set during onboarding, e.g. "http://localhost:8081"
```

Set during the instance onboarding flow. If `engineApiUrl` is null, webhook returns 503.

### Webhook Management UI

Shows as a section within module details or in settings:
- Endpoint URL (read-only, copy button)
- Signing secret (masked, reveal/copy button, rotate button)
- Last triggered timestamp
- Enable/disable toggle

---

## Phase 5 — Scene/Widget System

**Files:** `convex/scenes.ts`, `client/src/pages/scene-editor.tsx`, `client/src/pages/browser-source.tsx`

### Widget Instance Typing

Replace `widgets?: any[]` with typed `WidgetInstance[]` in both schema and all query/mutation signatures. Migration: treat existing untyped data as empty array.

### Scene Editor Updates

Widget placement panel:
- Lists available widgets from `moduleWidgets` table
- Drag onto canvas creates a new `WidgetInstance` with default dimensions
- Click-to-select shows settings panel (renders `settingsSchema` from widget definition)
- Z-index layering controls

### Widget Rendering in Browser Source

Module ZIPs include HTML/JS render assets for each widget (e.g., `widgets/alert-overlay/index.html`). On install, these assets are extracted and stored via the storage backend. Each `moduleWidgets` record stores a `renderAssetKey` pointing to that stored file.

The browser source page (`/obs/source/:sourceKey`) renders each `WidgetInstance` in an `<iframe>` whose `src` resolves to the widget's stored asset URL. This follows the same model as OBS browser sources — widgets are self-contained HTML pages that receive event data via `postMessage`.

```
WidgetInstance.moduleWidgetId
    → moduleWidgets.renderAssetKey
    → storage.getUrl(renderAssetKey)
    → <iframe src={url} style={{ position: "absolute", left, top, width, height, zIndex }} />
```

Widget HTML communicates with the parent browser source page via `window.postMessage` to receive event payloads (NATS events routed by `acceptedEvents`).

**Schema addition to `moduleWidgets`:**
```typescript
renderAssetKey: v.string(),  // storage key for the widget's index.html entry point
```

---

## Phase 6 — Workflow Improvements

**Files:** `convex/schema.ts`, `convex/workflows.ts`, `client/src/pages/workflows.tsx`, `client/src/pages/workflow-builder.tsx`

### Schema Addition

```typescript
workflows: {
  ...existing fields...
  isModuleProvided: v.boolean(),         // true = came from module manifest
  sourceModuleId: v.optional(v.id("installedModules")),
}
```

### Workflow List UI

- Badge on module-provided workflows: "Module: {module name}"
- Module-provided workflows cannot be deleted (only disabled)
- "Use as template" button on module-provided workflows → creates user-editable copy

### Template Conversion

`workflowTemplates` table already exists. Wire up:
- "Use template" button on template cards → `workflows.createFromTemplate(templateId)`
- New mutation that copies template nodes/edges into a new workflow record

---

## New Routes

| Route | Purpose |
|-------|---------|
| `/commands` | Command management (new page) |
| `/settings/webhooks` | Webhook endpoint management |

---

## Verification

### Phase 1
- `bun run check` passes with no type errors after schema + type changes
- Convex schema pushes without errors: `bunx convex dev`

### Phase 2
- Upload a test module ZIP → module appears in list with status "active"
- Upload same ZIP again → rejected with duplicate key error
- Disable module → status changes to "disabled" in UI

### Phase 3
- Create a command linked to a workflow → command appears in list
- Change required role → saved and reflected in engine command registry

### Phase 4
- Provision webhook endpoint → URL displayed
- POST to `/webhooks/{endpointId}` with valid signature → workflow triggered
- POST with invalid signature → 401 response

### Phase 5
- Add a widget to a scene → typed WidgetInstance in database
- Browser source renders widget at correct position/dimensions

### Phase 6
- Module install creates read-only workflow in list
- "Use as template" creates editable copy
- Module-provided workflow shows module badge
