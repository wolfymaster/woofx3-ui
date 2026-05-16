# PRD: Engine Communication Architecture for woofx3-UI

## Executive Summary

This PRD outlines the implementation of complete engine communication infrastructure for the woofx3-UI, enabling seamless integration between the multi-tenant Convex backend and woofx3 engine instances. The architecture supports bidirectional communication (Convex proxy + webhooks), projection-based data flow, and comprehensive module/workflow management.

**Goal:** Enable the UI to correctly communicate with the engine API and handle webhook callbacks for creating projections of engine instance data, ensuring modules and workflows UIs have full engine integration.

**Scope:** Full implementation of engine communication patterns including registration, RPC proxying, webhook handling, and UI integration for modules and workflows.

**Key Deliverables:**
1. Complete registration and authentication flow
2. Convex RPC proxy to engine
3. Webhook callback infrastructure
4. Projection-based data synchronization
5. Module management UI with engine sync
6. Workflow management UI with engine sync (with NEW vertical workflow editor)
7. **Dashboard Widget System** - Resizable, draggable widgets with per-user layout persistence
8. **Alert Log & Replay** - Real-time alert history with replay capability
9. **Debug Tools** - Twitch event trigger simulation interface
10. **Engine Storage Settings** - Configure storage backends (file, S3, R2)
11. **Scene Management** - Create scenes, add widgets, generate browser overlay URLs
12. Comprehensive error handling and retry logic

---

## Architecture Overview

### Two-Layer Communication Model

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              BROWSER (UI)                                   │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐             │
│  │  Modules Page   │  │ Workflows Page  │  │ Workflow Builder│             │
│  │                 │  │                 │  │                 │             │
│  │ • List modules  │  │ • List flows    │  │ • Visual editor │             │
│  │ • Install ZIP   │  │ • Toggle enable │  │ • JSON-first    │             │
│  │ • Uninstall     │  │ • Delete        │  │ • Projection    │             │
│  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘             │
│           │                    │                    │                       │
│           └────────────────────┼────────────────────┘                       │
│                                │                                            │
│                                ▼                                            │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    Convex React (useQuery/useMutation)              │   │
│  │                                                                     │   │
│  │  • Real-time subscriptions via Convex                              │   │
│  │  • No direct engine calls from browser                             │   │
│  │  • All data flows through Convex backend                           │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
                                          │
                                          │ Convex Client
                                          ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          CONVEX BACKEND (Multi-tenant)                      │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  Actions (Proxy to Engine)          │  Webhook Handlers              │   │
│  │  ─────────────────────────          │  ────────────────              │   │
│  │  • moduleEngine.ts                  │  • http.ts (main router)       │   │
│  │  • workflowActions.ts               │  • moduleWebhook.ts            │   │
│  │  • workflowCatalog.ts               │  • workflowInternal.ts         │   │
│  │                                     │                                │   │
│  │  Flow:                              │  Flow:                         │   │
│  │  1. Auth user + validate instance   │  1. Receive POST /webhooks/*   │   │
│  │  2. Load credentials (clientId/     │  2. Validate Bearer token      │   │
│  │     clientSecret)                   │  3. Route by event type        │   │
│  │  3. Create RPC session              │  4. Upsert projection data     │   │
│  │  4. Call engine API                 │  5. Emit transient events      │   │
│  │  5. Return result                   │                                │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  Registration (convex/registration.ts)                              │   │
│  │  ───────────────────────────────────                                │   │
│  │                                                                     │   │
│  │  1. User provides engine URL                                        │   │
│  │  2. Convex creates instance record (_id = instanceId)               │   │
│  │  3. Call gateway.ping() to verify connectivity                      │   │
│  │  4. Call gateway.registerClient()                                   │   │
│  │  5. Store clientId, clientSecret, webhookSecret                     │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  Key Identity Model:                                                        │
│  • instanceId = Convex instances._id (generated by Convex)                  │
│  • applicationId = Engine's internal app ID (returned by engine)            │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                          │
                                          │ capnweb HTTP batch RPC
                                          ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         WOOFX3 ENGINE (Single-tenant)                       │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  API Gateway                                                        │   │
│  │  ───────────                                                        │   │
│  │  • ping() - health check                                            │   │
│  │  • registerClient() - registration handshake                        │   │
│  │  • authenticate() - returns Api stub                                │   │
│  │                                                                     │   │
│  │  Single-use sessions: each batch is consumed on first await        │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  Engine API (Authenticated)                                         │   │
│  │  ─────────────────────────                                          │   │
│  │                                                                     │   │
│  │  Modules:                                                           │   │
│  │  • listEngineModules()                                              │   │
│  │  • installModuleZip(name, zipBase64, context)                       │   │
│  │  • uninstallModule(moduleKey)                                       │   │
│  │  • setEngineModuleState(name, state)                                │   │
│  │                                                                     │   │
│  │  Workflows:                                                         │   │
│  │  • createWorkflow({ accountId, definition, correlationKey })        │   │
│  │  • updateWorkflow(id, { definition, correlationKey })               │   │
│  │  • deleteWorkflow(id, correlationKey)                               │   │
│  │  • setWorkflowEnabled(id, isEnabled, correlationKey)                │   │
│  │  • getWorkflows({ accountId })                                      │   │
│  │                                                                     │   │
│  │  Other:                                                             │   │
│  │  • sendChatMessage(accountId, message)                              │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  Webhook Emitter                                                    │   │
│  │  ───────────────                                                    │   │
│  │                                                                     │   │
│  │  POST https://<CONVEX_SITE_URL>/api/webhooks/woofx3                 │   │
│  │  Authorization: Bearer <callbackToken>                              │   │
│  │                                                                     │   │
│  │  Event Types:                                                       │   │
│  │  • module.installed                                                 │   │
│  │  • module.install_failed                                            │   │
│  │  • module.deleted                                                   │   │
│  │  • module.delete_failed                                             │   │
│  │  • module.trigger.registered                                        │   │
│  │  • module.action.registered                                         │   │
│  │  • module.widget.registered                                         │   │
│  │  • module.widget.deregistered                                       │   │
│  │  • workflow.created                                                 │   │
│  │  • workflow.updated                                                 │   │
│  │  • workflow.deleted                                                 │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Communication Patterns

#### Pattern 1: Registration Handshake (One-time, Onboarding)

```
User inputs engine URL
         │
         ▼
┌─────────────────┐
│  Convex Action  │  registration.ts::registerInstance
│                 │
│ 1. Create       │  instance._id = instanceId
│    instance     │  (Convex generates)
│    record       │
└────────┬────────┘
         │
         │ capnweb RPC
         ▼
┌─────────────────┐
│  Engine         │  ApiGateway
│                 │
│ 1. ping()       │  Verify connectivity
│ 2. registerClient(                                    ┌─────────────────┐
│      description,  ──────────────────────────────────▶│  Engine creates │
│      callbackUrl,                                     │  client record  │
│      callbackToken                                    │                 │
│    )                                                  │ Returns:        │
│    ◀──────────────────────────────────────────────────│ { clientId,     │
│                 │                                     │   clientSecret }│
└─────────────────┘                                     └─────────────────┘
         │
         ▼
┌─────────────────┐
│  Convex         │  Store credentials:
│                 │  - clientId
│  Store results  │  - clientSecret (one-time only!)
│                 │  - webhookSecret (callbackToken)
└─────────────────┘
```

**Key Points:**
- `instanceId` is generated by Convex (the instance record `_id`)
- `applicationId` is generated by the engine (internal to engine)
- `clientSecret` is returned ONLY ONCE during registration
- `callbackToken` is the secret for webhook authentication

#### Pattern 2: UI → Engine (Proxied via Convex Actions)

```
Browser UI
    │
    │ useMutation(api.workflowActions.createFromDefinition)
    ▼
┌─────────────────────────────────────────┐
│ Convex Action                           │
│                                         │
│ 1. Auth user (getAuthUserId)            │
│ 2. Load instance context:               │
│    - url, applicationId                 │
│    - clientId, clientSecret             │
│ 3. Generate correlationKey              │
│ 4. Insert pending row                   │
│ 5. Create RPC session                   │
│                                         │
│ const rpc = createEngineRpcSession(     │
│   bundle.url,                           │
│   bundle.clientId,                      │
│   bundle.clientSecret                   │
│ );                                      │
│                                         │
│ const result = await                    │
│   rpc.createWorkflow({                  │
│     accountId: applicationId,           │
│     definition,                         │
│     correlationKey                      │
│   });                                   │
└─────────┬───────────────────────────────┘
          │ capnweb HTTP batch RPC
          │ (single-use session)
          ▼
┌─────────────────────────────────────────┐
│ Engine                                  │
│                                         │
│ 1. Authenticate clientId/clientSecret   │
│ 2. Validate definition                  │
│ 3. Persist workflow                     │
│ 4. Mint engineWorkflowId                │
│ 5. Return { id, definition }            │
│ 6. Async: emit webhook                  │
│    (workflow.created)                   │
└─────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────┐
│ Convex Action (continued)               │
│                                         │
│ 6. Poll pendingWorkflowOperations       │
│    for webhook completion               │
│ 7. Return engineWorkflowId to UI        │
└─────────────────────────────────────────┘
```

**Key Points:**
- Never call engine directly from browser
- Each RPC session is single-use (consumed on first await)
- Always include `applicationId` in proxied requests
- Correlation pattern for async operations

#### Pattern 3: Engine → UI (Webhook Callbacks)

```
Engine
    │
    │ POST /api/webhooks/woofx3
    │ Authorization: Bearer <callbackToken>
    │
    ▼
┌─────────────────────────────────────────┐
│ Convex HTTP Handler (http.ts)           │
│                                         │
│ 1. Extract Bearer token from header     │
│ 2. Look up instance by webhookSecret    │
│    ┌─────────────────────────────────┐  │
│    │ ctx.runQuery(                   │  │
│    │   internal.instances            │  │
│    │     .getByWebhookSecret,        │  │
│    │   { webhookSecret: token }      │  │
│    │ )                               │  │
│    └─────────────────────────────────┘  │
│                                         │
│ 3. Parse event from payload             │
│ 4. Route by event.type                  │
│                                         │
│ switch (event.type) {                   │
│   case 'workflow.created':              │
│     await workflowInternal              │
│       .upsertFromWebhook(...)           │
│     await workflowInternal              │
│       .resolveCorrelation(...)          │
│     break;                              │
│   case 'module.installed':              │
│     await moduleWebhook                 │
│       .processModuleInstalled(...)      │
│     break;                              │
│   // ... other events                   │
│ }                                       │
└─────────────────────────────────────────┘
    │
    │ Convex reactive query
    │ (automatic via useQuery)
    ▼
┌─────────────────────────────────────────┐
│ Browser UI                              │
│                                         │
│ const workflows = useQuery(             │
│   api.workflows.list,                   │
│   instance ? { instanceId } : "skip"    │
│ );                                      │
│                                         │
│ // Automatically re-renders             │
│ // when webhook updates data            │
└─────────────────────────────────────────┘
```

**Key Points:**
- Single webhook endpoint for all instances
- Bearer token identifies the instance
- All webhook handlers are idempotent
- Convex reactive queries push updates to browser automatically

#### Pattern 4: Projection-Based Data Flow

```
Engine (Source of Truth)
    │
    │ 1. Workflow created/updated
    │ 2. Module installed
    │ 3. Trigger/action registered
    ▼
┌─────────────────────────────────────────┐
│ Webhook to Convex                       │
│                                         │
│ Upserts:                                │
│ - workflows table                       │
│ - moduleRepository table                │
│ - triggerDefinitions table              │
│ - actionDefinitions table               │
└────────────┬────────────────────────────┘
             │
             │ 3. UI queries projection
             ▼
┌─────────────────────────────────────────┐
│ Browser UI                              │
│                                         │
│ For Workflows:                          │
│ - definition is canonical JSON          │
│ - nodes/edges derived via               │
│   definitionToReactFlow()               │
│ - projection pushed back to             │
│   Convex as cache                       │
│                                         │
│ For Modules:                            │
│ - moduleRepository is projection        │
│ - trigger/action defs stored            │
│   separately                            │
└─────────────────────────────────────────┘
```

**Key Points:**
- Engine is source of truth for execution data
- Convex stores projections for UI queries
- UI derives visual representations (ReactFlow) from canonical JSON
- Projection is pushed back to Convex as cache (non-blocking)

---

## Parallel Work Streams

This PRD is organized into **5 parallel work streams** that can be developed independently and then integrated. Each stream has clearly defined interfaces with other streams.

### Work Stream A: Registration & Authentication Infrastructure

**Goal:** Ensure robust registration handshake and credential management

**Current State:**
- Registration exists in `convex/registration.ts`
- Basic credential storage in `convex/instances.ts`
- No UI for re-registration if credentials lost

**Work Items:**

#### A1: Registration Flow Improvements
- [ ] Add re-registration capability (if clientSecret lost)
- [ ] Add registration status indicator in UI
- [ ] Add connectivity health check (periodic ping)
- [ ] Handle registration failures with retry logic
- [ ] Add `registrationAttempts` table to track failures

#### A2: Credential Security
- [ ] Encrypt clientSecret in database (at rest)
- [ ] Add credential rotation flow
- [ ] Audit log for credential changes
- [ ] Implement emergency credential reset

#### A3: Instance Health Monitoring
- [ ] Add `instances.health` field (healthy/unhealthy/unknown)
- [ ] Implement periodic health check cron
- [ ] UI health indicator in instance selector
- [ ] Alert on connectivity failures

**Acceptance Criteria:**
- [ ] Registration succeeds end-to-end with engine
- [ ] Health checks run every 5 minutes
- [ ] UI shows clear registration status
- [ ] Failed health checks trigger alerts

**Files Modified:**
- `convex/registration.ts` (modify)
- `convex/instances.ts` (modify)
- `convex/schema.ts` (modify - add health tracking)
- `convex/crons.ts` (modify - add health check)
- `client/src/components/instances/` (new directory)

---

### Work Stream B: Module Management Engine Integration

**Goal:** Complete module install/uninstall/sync with engine

**Current State:**
- Module installation via ZIP upload works
- Uninstall flow implemented
- Webhook handlers exist
- UI shows module list and details

**Work Items:**

#### B1: Module Sync from Engine
- [ ] Implement `listEngineModules` query
- [ ] Create module sync action (reconcile engine state → Convex)
- [ ] Handle module state changes (active/inactive)
- [ ] Sync module versions and metadata

#### B2: Module Installation Improvements
- [ ] Add installation progress tracking
- [ ] Handle installation failures gracefully
- [ ] Support module dependencies
- [ ] Add installation rollback on failure

#### B3: Module Uninstallation
- [ ] Add dependency conflict detection
- [ ] Show what will be affected before uninstall
- [ ] Handle uninstall failures with retry
- [ ] Cleanup orphaned trigger/action definitions

#### B4: Module Details Deep Dive
- [ ] Show module logs/errors from engine
- [ ] Display module resource usage
- [ ] Module configuration editing
- [ ] Module state toggling (enable/disable)

#### B5: Module UI Enhancements
- [ ] Module marketplace integration
- [ ] Module version management
- [ ] Module update notifications
- [ ] Batch module operations

**Acceptance Criteria:**
- [ ] Installing a module shows real-time progress
- [ ] Module list reflects actual engine state
- [ ] Uninstall warns about dependencies
- [ ] Module state changes sync bidirectionally
- [ ] Installation failures show detailed error messages

**Files Modified:**
- `convex/moduleEngine.ts` (modify/enhance)
- `convex/moduleWebhook.ts` (modify/enhance)
- `convex/moduleRepository.ts` (modify)
- `client/src/pages/modules.tsx` (modify)
- `client/src/pages/module-detail.tsx` (modify)
- `client/src/components/modules/` (modify)

---

### Work Stream C: Workflow Engine Integration

**Goal:** Implement JSON-first workflow CRUD with engine

**Current State:**
- Design doc exists (2026-04-19-workflow-json-first-creation-design.md)
- Partial implementation in place
- `workflowActions.ts` has create/update/delete actions
- `workflowInternal.ts` has webhook handlers

**Work Items:**

#### C1: Complete Convex Backend (follow design doc)
- [ ] Verify `workflows` table schema matches design
- [ ] Ensure `pendingWorkflowOperations` and `completedWorkflowOperations` tables exist
- [ ] Complete webhook handler in `http.ts` for workflow events
- [ ] Add workflow projection mutation (`updateProjection`)
- [ ] Add cron for sweeping expired pending operations

#### C2: Workflow Projection Library
- [ ] Create `client/src/lib/workflow-projection.ts`
- [ ] Implement `definitionToReactFlow()` function
- [ ] Support all node types (trigger, action, condition, wait, workflow, log)
- [ ] Implement dagre-based auto-layout
- [ ] Handle condition branches (onTrue/onFalse)
- [ ] Support tiered/variant workflows
- [ ] Write comprehensive unit tests

#### C3: Workflow Basic Editor
- [ ] Rewrite to emit canonical WorkflowDefinition JSON
- [ ] Implement preset-to-JSON mapping
- [ ] Add "Preview JSON" affordance
- [ ] Support trigger presets
- [ ] Support action presets
- [ ] Support tiered configurations
- [ ] Wire to `createFromDefinition` action

#### C4: Workflow Visual Builder
- [ ] Rewrite to use definition as state of record
- [ ] Integrate `definitionToReactFlow()` for rendering
- [ ] Implement node add/edit/delete → definition mutation
- [ ] Implement edge connections → dependsOn mutation
- [ ] Add "Preview JSON" panel
- [ ] Wire Save to `updateFromDefinition` action
- [ ] Fire-and-forget projection push on mount

#### C5: Workflow List & Detail Views
- [ ] Update workflow list to show engine state
- [ ] Add workflow enable/disable toggle
- [ ] Implement workflow delete with confirmation
- [ ] Show workflow definition JSON in detail view
- [ ] Display workflow execution status

#### C6: Error Handling & Edge Cases
- [ ] Handle engine validation errors
- [ ] Implement timeout handling (10s correlation wait)
- [ ] Show correlation timeout UI
- [ ] Handle duplicate workflow IDs (idempotency)
- [ ] Handle engine unreachable errors

**Acceptance Criteria:**
- [ ] Creating a workflow via basic editor works end-to-end
- [ ] Visual builder renders workflows from definition
- [ ] Changes in visual builder update definition correctly
- [ ] Webhook updates reflect immediately in UI (reactive)
- [ ] Timeout errors show user-friendly messages
- [ ] All workflow CRUD operations work through engine

**Files Modified:**
- `convex/workflowActions.ts` (modify)
- `convex/workflowInternal.ts` (modify)
- `convex/workflows.ts` (modify)
- `convex/http.ts` (modify)
- `convex/schema.ts` (verify)
- `client/src/lib/workflow-projection.ts` (create)
- `client/src/lib/workflow-projection.test.ts` (create)
- `client/src/components/workflows/basic-editor.tsx` (rewrite)
- `client/src/pages/workflow-builder.tsx` (rewrite)
- `client/src/pages/workflows.tsx` (modify)

---

### Work Stream D: Webhook Infrastructure & Event System

**Goal:** Robust webhook handling and event distribution

**Current State:**
- Webhook endpoint exists in `http.ts`
- Module webhook handlers in `moduleWebhook.ts`
- Workflow webhook handlers in `workflowInternal.ts`
- Transient events system exists

**Work Items:**

#### D1: Webhook Reliability
- [ ] Add webhook delivery retry logic (exponential backoff)
- [ ] Implement idempotency key handling
- [ ] Add webhook delivery logging
- [ ] Handle out-of-order webhook deliveries
- [ ] Add webhook signature verification (if supported)

#### D2: Event System Enhancements
- [ ] Enhance transient events with categories
- [ ] Add event persistence for audit trail
- [ ] Implement event filtering/subscription
- [ ] Add real-time event streaming (for long operations)
- [ ] Event replay capability for debugging

#### D3: New Webhook Event Types
- [ ] Handle all module events (installed, install_failed, deleted, delete_failed, trigger_registered, action_registered, widget_registered, widget_deregistered)
- [ ] Handle all workflow events (created, updated, deleted)
- [ ] Handle engine status events (if available)
- [ ] Handle alert/notification events
- [ ] Document all event schemas

#### D4: Webhook Testing & Debugging
- [ ] Create webhook testing tool (admin panel)
- [ ] Add webhook payload viewer
- [ ] Implement webhook replay for testing
- [ ] Add webhook delivery metrics
- [ ] Webhook failure alerting

#### D5: Correlation System
- [ ] Ensure correlation timeout handling works
- [ ] Add correlation status tracking UI
- [ ] Handle correlation key collisions
- [ ] Implement correlation cleanup
- [ ] Add correlation debugging tools

**Acceptance Criteria:**
- [ ] All webhooks are handled idempotently
- [ ] Failed webhooks retry with exponential backoff
- [ ] Transient events show in UI with progress
- [ ] Event history is queryable
- [ ] Webhook debugging tools work in dev

**Files Modified:**
- `convex/http.ts` (modify)
- `convex/webhookAuth.ts` (modify)
- `convex/moduleWebhook.ts` (modify)
- `convex/workflowInternal.ts` (modify)
- `convex/transientEvents.ts` (modify)
- `convex/schema.ts` (modify - add event tracking)
- `client/src/components/debug/` (new directory)

---

### Work Stream E: Transport & Communication Utilities

**Goal:** Shared utilities for engine communication

**Current State:**
- `convex/lib/engineInstanceUrl.ts` exists
- `createEngineRpcSession` and `createEngineGatewaySession` exported
- Type definitions in `@woofx3/api`

**Work Items:**

#### E1: RPC Session Management
- [ ] Add session pooling (if beneficial)
- [ ] Implement request/response logging
- [ ] Add RPC timeout configuration
- [ ] Handle RPC errors consistently
- [ ] Add RPC retry logic for transient failures

#### E2: Type Safety Improvements
- [ ] Audit all RPC interfaces
- [ ] Add runtime validation of RPC responses
- [ ] Generate TypeScript types from engine schema
- [ ] Add type guards for engine responses
- [ ] Document all RPC contracts

#### E3: Error Handling Utilities
- [ ] Create engine error classification
- [ ] Add user-friendly error message mapping
- [ ] Implement error recovery strategies
- [ ] Add error telemetry
- [ ] Create error debugging tools

#### E4: Communication Patterns Library
- [ ] Extract common correlation patterns
- [ ] Create reusable webhook handler template
- [ ] Add request batching utilities
- [ ] Implement circuit breaker for engine calls
- [ ] Add rate limiting protection

#### E5: Testing Utilities
- [ ] Create mock engine for testing
- [ ] Add RPC call recording/playback
- [ ] Implement webhook simulation
- [ ] Add integration test helpers
- [ ] Create load testing utilities

**Acceptance Criteria:**
- [ ] All RPC calls have consistent error handling
- [ ] Types are generated from engine schema
- [ ] Mock engine works for local development
- [ ] Integration tests can simulate webhooks
- [ ] Circuit breaker prevents cascade failures

**Files Modified:**
- `convex/lib/engineInstanceUrl.ts` (modify)
- `convex/lib/engineErrors.ts` (create)
- `convex/lib/rpcUtils.ts` (create)
- `convex/testing/` (new directory)

---

### Work Stream F: Dashboard Widget System

**Goal:** Create a customizable, resizable, draggable dashboard with per-user layout persistence

**Current State:**
- Dashboard page exists but is basic
- No widget system implemented
- Engine has dashboard widget support via `getDashboardLayout`/`saveDashboardLayout` RPC

**Work Items:**

#### F1: Dashboard Layout System
- [ ] Create `userDashboardLayouts` table in Convex schema
  ```typescript
  {
    _id: Id<"userDashboardLayouts">,
    userId: Id<"users">,
    instanceId: Id<"instances">,
    layout: {
      widgets: Array<{
        id: string;
        type: string;
        position: { x: number; y: number };
        size: { width: number; height: number };
        config?: Record<string, unknown>;
      }>;
    };
    updatedAt: number;
  }
  ```
- [ ] Implement grid-based layout system (react-grid-layout or similar)
- [ ] Support responsive breakpoints (desktop, tablet, mobile)
- [ ] Add drag-and-drop widget reordering
- [ ] Add resize handles on widgets
- [ ] Auto-save layout changes (debounced)

#### F2: Widget Registry & Management
- [ ] Create widget registry system
- [ ] Implement `client/src/lib/widgets/registry.ts`
- [ ] Support widget metadata (name, description, icon, defaultSize, category)
- [ ] Add "Add Widget" dialog with widget catalog
- [ ] Implement widget removal with confirmation
- [ ] Support widget configuration modal

#### F3: Built-in Streamer Widgets
Create these helpful widgets for streamers:

**Stream Status Widget**
- [ ] Show live/offline status
- [ ] Display viewer count (if live)
- [ ] Show stream uptime
- [ ] Show current stream title and game
- [ ] Quick "Go Live" simulation (for testing)

**Recent Events Widget**
- [ ] Show latest Twitch events (follows, subs, cheers, raids)
- [ ] Configurable event types to show
- [ ] Configurable max events count
- [ ] Click to see event details

**Quick Actions Widget**
- [ ] Buttons for common actions:
  - Send test alert
  - Toggle workflow
  - Trigger specific workflow
  - Send chat message
- [ ] Configurable which actions appear

**Chat Preview Widget**
- [ ] Display recent chat messages
- [ ] Show user badges and colors
- [ ] Auto-scroll to latest
- [ ] Configurable message count

**Module Status Widget**
- [ ] List installed modules
- [ ] Show module health/status
- [ ] Quick enable/disable toggle
- [ ] Show module version

**Workflow Activity Widget**
- [ ] Recent workflow executions
- [ ] Success/failure indicators
- [ ] Execution duration
- [ ] Configurable time window

**Alert Queue Widget**
- [ ] Current alert queue depth
- [ ] Next alert preview
- [ ] Skip/Clear buttons
- [ ] Recent alert history

#### F4: Widget Data Layer
- [ ] Create `convex/dashboardWidgets.ts` with queries/mutations
- [ ] Implement real-time data subscriptions for widgets
- [ ] Add data refresh intervals where needed
- [ ] Handle data loading states
- [ ] Cache widget data appropriately

#### F5: Dashboard Page Implementation
- [ ] Rewrite `client/src/pages/dashboard.tsx`
- [ ] Integrate react-grid-layout
- [ ] Add widget wrapper component (handles chrome, loading, errors)
- [ ] Implement empty state (no widgets added yet)
- [ ] Add edit mode toggle (allows rearranging)
- [ ] Add reset layout option

**Acceptance Criteria:**
- [ ] User can add widgets from catalog
- [ ] User can drag to rearrange widgets
- [ ] User can resize widgets
- [ ] Layout persists per user per instance
- [ ] Widgets show real-time data
- [ ] All 7 built-in widgets work correctly
- [ ] Layout is responsive
- [ ] Edit mode clearly indicated

**Files Modified/Created:**
- `convex/schema.ts` (modify - add userDashboardLayouts table)
- `convex/dashboardWidgets.ts` (create)
- `client/src/pages/dashboard.tsx` (rewrite)
- `client/src/components/dashboard/` (create directory)
  - `DashboardGrid.tsx`
  - `WidgetContainer.tsx`
  - `AddWidgetDialog.tsx`
  - `WidgetConfigModal.tsx`
- `client/src/components/widgets/` (create directory)
  - `StreamStatusWidget.tsx`
  - `RecentEventsWidget.tsx`
  - `QuickActionsWidget.tsx`
  - `ChatPreviewWidget.tsx`
  - `ModuleStatusWidget.tsx`
  - `WorkflowActivityWidget.tsx`
  - `AlertQueueWidget.tsx`
- `client/src/lib/widgets/` (create directory)
  - `registry.ts`
  - `types.ts`

---

### Work Stream G: Alert Log & Replay System

**Goal:** Display real-time alert history with replay capability

**Current State:**
- Alert system exists for browser overlays
- Webhook handlers for alert events exist in `http.ts`
- No UI for viewing alert history

**Work Items:**

#### G1: Alert Log Data Layer
- [ ] Create `alertLog` table in Convex schema
  ```typescript
  {
    _id: Id<"alertLog">,
    instanceId: Id<"instances">,
    alertId: string;              // Engine's alert ID
    envelopeId: string;
    applicationId: string;
    payload: string;              // JSON AlertPayload
    workflowId?: string;
    sourceEventId?: string;
    status: "sent" | "playing" | "completed" | "failed" | "replayed" | "skipped" | "timed_out";
    error?: string;
    dispatchedAt?: number;
    playedAt?: number;
    completedAt?: number;
    createdAt: number;
    updatedAt: number;
  }
  ```
- [ ] Add indexes: by_instance_status, by_envelope_id, by_workflow_id
- [ ] Implement webhook handlers in `convex/http.ts`:
  - `alert.recorded` → insert alert
  - `alert.completed` → update status
  - `alert.failed` → update status with error
  - `alert.replayed` → update status
  - `alert.timed_out` → update status
  - `alert.skipped` → update status

#### G2: Alert Log Queries
- [ ] Create `convex/alertLog.ts` with:
  - `list` query (paginated, filterable by status, date range)
  - `get` query (by alertId)
  - `getByEnvelopeId` query
  - `getStats` query (counts by status, time window)

#### G3: Alert Replay Integration
- [ ] Add replay action in `convex/alertLog.ts`:
  ```typescript
  replayAlert: action({
    args: { instanceId: v.id("instances"), alertId: v.string() },
    handler: async (ctx, { instanceId, alertId }) => {
      // 1. Get instance credentials
      // 2. Call engine rpc.replayAlert(alertId)
      // 3. Return success
    }
  })
  ```
- [ ] Add bulk replay option (replay multiple selected alerts)

#### G4: Alert Log UI
- [ ] Create Alert Log page at `/alerts`
- [ ] Implement alert list with columns:
  - Timestamp
  - Event type (follow, sub, cheer, raid, etc.)
  - User (who triggered it)
  - Status indicator
  - Widget used
  - Actions (replay, view details)
- [ ] Add filters:
  - Date range picker
  - Event type dropdown
  - Status dropdown
  - Search by username
- [ ] Implement alert detail view (modal or slide-out)
  - Full payload JSON
  - Timeline (dispatched → playing → completed)
  - Associated workflow execution
- [ ] Add replay button with confirmation
- [ ] Show replay success/failure toast

#### G5: Real-time Updates
- [ ] Subscribe to alert log changes
- [ ] Auto-refresh list when new alerts arrive
- [ ] Show "New alerts" notification/banner
- [ ] Highlight newly arrived alerts briefly

**Acceptance Criteria:**
- [ ] All alerts appear in log within 1 second of firing
- [ ] User can filter by date, type, status
- [ ] User can replay individual alerts
- [ ] Alert detail shows complete information
- [ ] Real-time updates work without page refresh
- [ ] Pagination works for large alert volumes

**Files Modified/Created:**
- `convex/schema.ts` (modify - add alertLog table)
- `convex/alertLog.ts` (create)
- `convex/http.ts` (modify - add alert webhook handlers)
- `client/src/pages/alerts.tsx` (create)
- `client/src/components/alerts/` (create directory)
  - `AlertList.tsx`
  - `AlertFilters.tsx`
  - `AlertDetailModal.tsx`
  - `AlertReplayButton.tsx`

---

### Work Stream H: Debug Tools & Twitch Event Simulation

**Goal:** Create a debug interface for triggering Twitch events with custom values

**Current State:**
- No debug interface exists
- Engine supports test event injection (likely via RPC)
- Need to expose this capability to developers/power users

**Work Items:**

#### H1: Debug Tab Structure
- [ ] Create new "Debug" section in navigation
- [ ] Create `client/src/pages/debug.tsx` as hub
- [ ] Implement sub-pages/tabs:
  - Event Simulator
  - Engine Health
  - Webhook Inspector
  - Storage Test

#### H2: Event Simulator
- [ ] Implement `convex/debug.ts` with `simulateTwitchEvent` action
- [ ] Support these event types:
  - `channel.follow` (follower)
  - `channel.subscribe` (subscriber, tier)
  - `channel.cheer` (bits, message)
  - `channel.raid` (raider, viewer count)
  - `channel.channel_points_custom_reward_redemption.add` (reward, user input)
  - `stream.online` / `stream.offline`
- [ ] Create form for each event type with relevant fields:
  ```typescript
  interface FollowEventForm {
    user_name: string;
    user_id?: string;
  }
  
  interface CheerEventForm {
    user_name: string;
    bits: number;
    message?: string;
  }
  
  interface SubscribeEventForm {
    user_name: string;
    tier: "1000" | "2000" | "3000";
    is_gift: boolean;
  }
  
  interface RaidEventForm {
    from_broadcaster_user_name: string;
    viewers: number;
  }
  ```
- [ ] Add "Send Event" button that calls engine RPC
- [ ] Show success/failure feedback
- [ ] Keep history of recently sent test events

#### H3: Engine Health Diagnostics
- [ ] Create engine health check visualization
- [ ] Show:
  - Connection status (ping result)
  - Last webhook received timestamp
  - RPC call success rate
  - Engine version/info
- [ ] Add "Test Connection" button
- [ ] Add "Test Webhook" button (sends test webhook to verify URL)

#### H4: Webhook Inspector
- [ ] Show recent webhook deliveries (last 50)
- [ ] Display webhook payload (formatted JSON)
- [ ] Show processing status/success
- [ ] Add "Replay Webhook" option for testing handlers
- [ ] Filter by event type

#### H5: Storage Test
- [ ] File upload test (test storage configuration)
- [ ] Widget asset fetch test
- [ ] Show storage config from engine

**Acceptance Criteria:**
- [ ] All major Twitch event types can be simulated
- [ ] Form validation prevents invalid data
- [ ] Events appear in alert log/workflows as if real
- [ ] Engine health shows accurate status
- [ ] Recent events show in history
- [ ] Only accessible to admin/developer users (add permission check)

**Files Modified/Created:**
- `convex/debug.ts` (create)
- `convex/schema.ts` (modify - add debugEventHistory table)
- `client/src/pages/debug.tsx` (create)
- `client/src/components/debug/` (create directory)
  - `EventSimulator.tsx`
  - `EventFormFollow.tsx`
  - `EventFormCheer.tsx`
  - `EventFormSubscribe.tsx`
  - `EventFormRaid.tsx`
  - `EngineHealth.tsx`
  - `WebhookInspector.tsx`

---

### Work Stream I: Engine Storage Settings Configuration

**Goal:** Allow users to configure engine storage backend (file, S3, R2) via UI

**Current State:**
- Engine supports storage configuration via RPC
- `getStorageConfig()` and `setStorageConfig()` exist
- No UI for managing storage settings

**Work Items:**

#### I1: Storage Settings UI
- [ ] Create Settings page section for "Storage"
- [ ] Add storage provider selector:
  - File (local disk)
  - S3 (AWS S3)
  - R2 (Cloudflare R2)
  - MinIO (S3-compatible)
- [ ] Show provider-specific fields:
  
  **File:**
  - Destination path
  
  **S3/R2/MinIO:**
  - Bucket name
  - Region (S3 only)
  - Endpoint URL (R2/MinIO)
  - Access Key ID (write-only, mask when reading)
  - Secret Access Key (write-only, mask when reading)
  - Prefix (optional)
  - Force Path Style (MinIO)

#### I2: Storage Configuration Backend
- [ ] Create `convex/engineSettings.ts` with:
  - `getStorageConfig` action
  - `setStorageConfig` action
  - `testStorageConnection` action
- [ ] Implement secure credential handling (never return secrets to UI)
- [ ] Add connection test before saving

#### I3: Storage Testing
- [ ] Add "Test Connection" button
- [ ] Implement upload/download test file
- [ ] Show test results (success/failure with details)
- [ ] Warn before changing storage (data migration implications)

#### I4: Storage Status Display
- [ ] Show current storage configuration (non-sensitive fields)
- [ ] Display storage health indicator
- [ ] Show last successful connection time

**Acceptance Criteria:**
- [ ] User can switch between storage providers
- [ ] Credentials are never exposed in UI (write-only)
- [ ] Connection test works before saving
- [ ] Clear warning about restart required
- [ ] Configuration persists in engine

**Files Modified/Created:**
- `convex/engineSettings.ts` (create)
- `client/src/pages/settings.tsx` (modify - add Storage section)
- `client/src/components/settings/` (create directory)
  - `StorageSettings.tsx`
  - `StorageProviderSelector.tsx`
  - `StorageTestButton.tsx`

---

### Work Stream J: Scene Management System

**Goal:** Create complete scene management with widget placement and browser overlay URL generation

**Current State:**
- Scene editor page exists but minimal
- Engine has scene RPC: `createScene`, `updateScene`, `deleteScene`, `getScenes`, `getScene`, `getAvailableWidgets`
- Webhook events: `scene.created`, `scene.updated`, `scene.deleted`
- Browser source endpoint exists in `http.ts`

**Work Items:**

#### J1: Scene Data Layer
- [ ] Create/verify `scenes` table in Convex schema
  ```typescript
  {
    _id: Id<"scenes">,
    instanceId: Id<"instances">,
    applicationId: string;
    engineSceneId: string;
    name: string;
    description?: string;
    widgetsJson: string;        // Array of WidgetInstance
    layoutJson: string;         // Canvas dimensions, theme
    createdByType: string;
    createdByRef: string;
    createdAt: number;
    updatedAt: number;
  }
  ```
- [ ] Implement webhook handlers:
  - `scene.created` → insert scene
  - `scene.updated` → update scene
  - `scene.deleted` → delete scene
- [ ] Create `convex/scenes.ts` with:
  - `list` query
  - `get` query
  - `create` action (proxies to engine)
  - `update` action (proxies to engine)
  - `delete` action (proxies to engine)

#### J2: Scene List & Management
- [ ] Create Scene Management page at `/scenes`
- [ ] Show grid/list of scenes with:
  - Scene name
  - Widget count
  - Last modified
  - Browser source URL (copy button)
  - Actions (edit, delete)
- [ ] Add "Create Scene" button
- [ ] Implement scene creation dialog (name, description)
- [ ] Add delete confirmation

#### J3: Scene Editor
- [ ] Create scene editor at `/scenes/:sceneId/edit`
- [ ] Implement canvas with:
  - Configurable dimensions (1920x1080 default)
  - Grid overlay option
  - Zoom in/out
- [ ] Widget palette showing available widgets from engine
- [ ] Drag-and-drop widget placement from palette to canvas
- [ ] Widget selection and manipulation:
  - Click to select
  - Drag to move
  - Resize handles
  - Delete key to remove
- [ ] Widget configuration panel (shows when widget selected):
  - Position (x, y inputs)
  - Size (width, height inputs)
  - Settings (from WidgetSettingDefinition)
  - Z-index
  - Visibility toggle
- [ ] Save scene button (proxies to engine)

#### J4: Widget Integration
- [ ] Fetch available widgets from engine (`getAvailableWidgets`)
- [ ] Cache widget definitions in Convex (`moduleWidgets` table)
- [ ] Handle widget registration/deregistration webhooks
- [ ] Show widget preview/thumbnail if available
- [ ] Support widget settings schema validation

#### J5: Browser Overlay URL
- [ ] Generate browser source URL for each scene
- [ ] URL format: `{CONVEX_SITE_URL}/api/browser-source/{sourceKey}`
- [ ] Create source key management:
  - Generate unique key per scene
  - Allow regenerating key (for security)
  - Show URL with copy button
- [ ] Display OBS Studio setup instructions
- [ ] Show overlay preview (iframe)

#### J6: Widget Instance Types
- [ ] Implement core widget types:
  - Alert container (renders alerts)
  - Chat overlay (shows chat messages)
  - Event ticker (recent events marquee)
  - Goal bar (follower/subscriber goals)
  - Custom HTML widget
- [ ] Support module-provided widgets

**Acceptance Criteria:**
- [ ] User can create new scenes
- [ ] User can add widgets to scene via drag-and-drop
- [ ] User can position and resize widgets
- [ ] User can configure widget settings
- [ ] User can copy browser source URL for OBS
- [ ] Overlay renders correctly in browser source
- [ ] Changes save to engine and reflect immediately

**Files Modified/Created:**
- `convex/schema.ts` (modify - verify scenes table)
- `convex/scenes.ts` (create)
- `convex/moduleWidgets.ts` (create)
- `convex/http.ts` (modify - add scene webhook handlers)
- `client/src/pages/scenes.tsx` (create)
- `client/src/pages/scene-editor.tsx` (rewrite)
- `client/src/components/scenes/` (create directory)
  - `SceneList.tsx`
  - `SceneCard.tsx`
  - `CreateSceneDialog.tsx`
  - `SceneCanvas.tsx`
  - `WidgetPalette.tsx`
  - `WidgetInstance.tsx`
  - `WidgetConfigPanel.tsx`
  - `BrowserSourceUrl.tsx`
  - `ObsInstructions.tsx`

---

### Work Stream K: Vertical Workflow Editor (Enhanced)

**Goal:** Replace/update workflow builder with vertical flow layout optimized for Twitch workflow creation

**Current State:**
- Workflow builder exists but uses ReactFlow's default horizontal layout
- User wants vertical flow layout
- JSON-first workflow design doc exists

**Work Items:**

#### K1: Vertical Layout System
- [ ] Update `client/src/lib/workflow-projection.ts` to support vertical layout
- [ ] Implement vertical node positioning:
  - Trigger at top
  - Tasks flow downward
  - Condition branches go left/right then down
- [ ] Use dagre with vertical rank direction
- [ ] Adjust edge routing for vertical flow

#### K2: Workflow Builder UI Updates
- [ ] Modify `client/src/pages/workflow-builder.tsx`:
  - Change layout direction to vertical
  - Adjust node sizes/shapes for vertical layout
  - Update connection handles (top/bottom instead of left/right)
- [ ] Implement custom nodes optimized for vertical flow:
  - Trigger node (prominent, at top)
  - Action node (compact, stacked vertically)
  - Condition node (diamond shape, branches left/right)
  - Wait node (hourglass or timer icon)
- [ ] Update edge styling:
  - Smooth vertical curves
  - Branch labels ("Yes"/"No" for conditions)
  - Visual distinction for different branch types

#### K3: Touch-Friendly Interactions
- [ ] Optimize for touch/mouse:
  - Larger touch targets
  - Touch-friendly drag handles
  - Pinch-to-zoom on canvas
  - Pan with two fingers/middle mouse

#### K4: Workflow Step Panel
- [ ] Add collapsible step panel on the side
- [ ] Show workflow steps as a vertical list
- [ ] Click step in list to center on it in canvas
- [ ] Drag steps in list to reorder (update dependsOn)

#### K5: Quick Add Interface
- [ ] Add "Add Step" button between existing steps
- [ ] Show action/trigger picker in slide-out panel
- [ ] Support search/filter in action catalog
- [ ] Recent/favorite actions

**Acceptance Criteria:**
- [ ] Workflow flows vertically from top to bottom
- [ ] Condition branches clearly visible
- [ ] Nodes don't overlap
- [ ] Auto-layout works correctly
- [ ] Touch interactions work smoothly
- [ ] Step panel syncs with canvas

**Files Modified:**
- `client/src/lib/workflow-projection.ts` (modify)
- `client/src/lib/workflow-projection.test.ts` (modify)
- `client/src/pages/workflow-builder.tsx` (modify)
- `client/src/components/workflows/` (modify)
  - Custom node components
  - Edge components
  - Step panel component

---

## Implementation Dependencies

```
Work Stream Dependencies:

A (Registration)
    │
    ├──┬──▶ B (Modules) ───┬──▶ G (Alert Log)
    │    │                │
    │    ├──┬──▶ C (Workflows)─┤
    │    │    │               │
    │    │    └──▶ K (Vertical Workflow)
    │    │
    │    └──▶ J (Scene Management)
    │
    ├──▶ D (Webhooks)
    │
    ├──▶ E (Transport)
    │
    ├──▶ F (Dashboard)
    │
    ├──▶ H (Debug Tools)
    │
    └──▶ I (Storage Settings)

Legend:
──▶ = Depends on

Detailed Dependencies:
- A (Registration) is required by ALL other streams
- B (Modules) → G (Alert Log): Alert log needs modules for widget alerts
- B (Modules) → J (Scene Management): Scene widgets come from modules
- C (Workflows) → G (Alert Log): Workflow alert action creates alerts
- C (Workflows) → K (Vertical Workflow): Enhanced builder extends base workflows
- D (Webhooks): Needs B and C webhook handlers defined first
- F (Dashboard): Can be developed in parallel, needs engine health RPC
- H (Debug Tools): Can be developed in parallel, needs all RPCs available
- I (Storage Settings): Can be developed in parallel, just uses engine RPCs
- J (Scene Management): Needs module widgets from B
```

**Phase 1 (Foundation):**
- A: Registration & Auth (Week 1-2)
- E: Transport Utilities (Week 2)

**Phase 2 (Core Features - Parallel):**
- B: Module Integration (Week 2-4)
- C: Workflow Integration (Week 2-4)
- F: Dashboard Widget System (Week 2-4)
- I: Storage Settings (Week 3-4)

**Phase 3 (Integration & Enhancement):**
- D: Webhook Infrastructure (Week 4-5)
- G: Alert Log & Replay (Week 4-5)
- H: Debug Tools (Week 4-5)
- K: Vertical Workflow Editor (Week 4-6)

**Phase 4 (Advanced Features):**
- J: Scene Management (Week 5-7)
- Cross-stream integration testing (Week 6)

**Phase 5 (Polish):**
- Error handling refinement
- Performance optimization
- Documentation
- End-to-end testing
- User acceptance testing

---

## Data Schema Reference

### Convex Tables

#### `instances` (existing)
```typescript
{
  _id: Id<"instances">,              // = instanceId
  url: string,                        // Engine URL
  name: string,
  accountId: Id<"accounts">,
  clientId: string,                   // From registration
  clientSecret: string,               // From registration (ONE-TIME)
  webhookSecret: string,              // callbackToken
  health: "healthy" | "unhealthy" | "unknown",
  lastHealthCheck: number,
  registrationStatus: "registered" | "pending" | "failed",
  createdAt: number,
  updatedAt: number,
}
```

#### `applications` (existing)
```typescript
{
  _id: Id<"applications">,
  instanceId: Id<"instances">,
  applicationId: string,              // Engine-generated
  name: string,
  createdAt: number,
}
```

#### `workflows` (modify per design doc)
```typescript
{
  _id: Id<"workflows">,
  instanceId: Id<"instances">,
  applicationId: string,
  engineWorkflowId: string,           // Engine-minted ID
  definition: WorkflowDefinition,     // Canonical JSON
  isEnabled: boolean,
  nodes?: ReactFlowNode[],            // Projection cache
  edges?: ReactFlowEdge[],            // Projection cache
  projectionUpdatedAt?: number,
  createdAt: number,
  updatedAt: number,
}
```

#### `moduleRepository` (existing)
```typescript
{
  _id: Id<"moduleRepository">,
  instanceId: Id<"instances">,
  moduleKey: string,                  // correlation key
  name: string,
  description: string,
  version: string,
  tags: string[],
  manifest: Record<string, unknown>,
  archiveKey: Id<"_storage">,
  status: "installing" | "installed" | "error" | "uninstalling",
  statusMessage?: string,
  createdAt: number,
  updatedAt: number,
}
```

#### `triggerDefinitions` (existing)
```typescript
{
  _id: Id<"triggerDefinitions">,
  moduleId?: Id<"moduleRepository">,
  slug: string,                       // unique identifier
  name: string,
  description: string,
  category: string,
  event?: string,
  color: string,
  icon: string,
  configFields?: unknown[],
  supportsTiers?: boolean,
  tierLabel?: string,
  allowVariants?: boolean,
  projectionKey?: string,
}
```

#### `actionDefinitions` (existing)
```typescript
{
  _id: Id<"actionDefinitions">,
  moduleId?: Id<"moduleRepository">,
  slug: string,                       // unique identifier
  name: string,
  description: string,
  category: string,
  color: string,
  icon: string,
  configFields?: unknown[],
  call?: string,
  paramsSchema?: string,
  projectionKey?: string,
}
```

#### `pendingWorkflowOperations` (existing)
```typescript
{
  _id: Id<"pendingWorkflowOperations">,
  correlationKey: string,
  instanceId: Id<"instances">,
  op: "create" | "update" | "delete",
  expiresAt: number,
}
```

#### `completedWorkflowOperations` (existing)
```typescript
{
  _id: Id<"completedWorkflowOperations">,
  correlationKey: string,
  engineWorkflowId: string,
  op: "create" | "update" | "delete",
  completedAt: number,
}
```

#### `transientEvents` (existing)
```typescript
{
  _id: Id<"transientEvents">,
  instanceId: Id<"instances">,
  correlationKey: string,
  type: string,
  status: "progress" | "success" | "error",
  message: string,
  data?: Record<string, unknown>,
  createdAt: number,
  expiresAt: number,
}
```

#### `userDashboardLayouts` (NEW)
```typescript
{
  _id: Id<"userDashboardLayouts">,
  userId: Id<"users">,
  instanceId: Id<"instances">,
  layout: {
    widgets: Array<{
      id: string;
      type: string;
      position: { x: number; y: number };
      size: { width: number; height: number };
      config?: Record<string, unknown>;
    }>;
  };
  updatedAt: number;
}
```

#### `alertLog` (NEW)
```typescript
{
  _id: Id<"alertLog">,
  instanceId: Id<"instances">,
  alertId: string;              // Engine's alert ID
  envelopeId: string;
  applicationId: string;
  payload: string;              // JSON AlertPayload
  workflowId?: string;
  sourceEventId?: string;
  status: "sent" | "playing" | "completed" | "failed" | "replayed" | "skipped" | "timed_out";
  error?: string;
  dispatchedAt?: number;
  playedAt?: number;
  completedAt?: number;
  createdAt: number;
  updatedAt: number;
}
```

#### `scenes` (verify existing or NEW)
```typescript
{
  _id: Id<"scenes">,
  instanceId: Id<"instances">,
  applicationId: string;
  engineSceneId: string;
  name: string;
  description?: string;
  widgetsJson: string;        // Array of WidgetInstance
  layoutJson: string;         // Canvas dimensions, theme
  createdByType: string;
  createdByRef: string;
  createdAt: number;
  updatedAt: number;
}
```

#### `moduleWidgets` (verify existing or NEW)
```typescript
{
  _id: Id<"moduleWidgets">,
  widgetId: string;           // Unique widget ID
  moduleId?: Id<"moduleRepository">;
  name: string;
  description?: string;
  directory: string;
  alertTypes: string[];
  settings: WidgetSettingDefinition[];
  surface?: "scene" | "dashboard";
  projectionKey?: string;
  canonicalId?: string;
  manifestId: string;
  createdByType: string;
  createdByRef: string;
}
```

#### `debugEventHistory` (NEW)
```typescript
{
  _id: Id<"debugEventHistory">,
  userId: Id<"users">;
  instanceId: Id<"instances">;
  eventType: string;
  payload: Record<string, unknown>;
  sentAt: number;
  success: boolean;
  errorMessage?: string;
}
```

---

## API Reference

### Engine RPC Interface (exposed via capnweb)

#### Gateway (unauthenticated)
```typescript
interface ApiGateway {
  ping(): Promise<void>;
  registerClient(
    description: string,
    params: {
      userId: string;
      callbackUrl: string;
      callbackToken: string;
    }
  ): Promise<{ clientId: string; clientSecret: string }>;
  authenticate(clientId: string, clientSecret: string): Promise<EngineApi>;
}
```

#### Engine API (authenticated)
```typescript
interface EngineApi {
  // Modules
  listEngineModules(): Promise<EngineModule[]>;
  installModuleZip(
    fileName: string,
    zipBase64: string,
    context?: { moduleKey?: string }
  ): Promise<void>;
  uninstallModule(moduleKey: string): Promise<void>;
  setEngineModuleState(name: string, state: string): Promise<void>;
  
  // Workflows
  createWorkflow(input: {
    accountId: string;
    definition: Omit<WorkflowDefinition, "id">;
    correlationKey?: string;
  }): Promise<{ id: string; definition: WorkflowDefinition; isEnabled: boolean }>;
  
  updateWorkflow(
    id: string,
    input: {
      definition: WorkflowDefinition;
      correlationKey?: string;
    }
  ): Promise<{ id: string; definition: WorkflowDefinition; isEnabled: boolean }>;
  
  deleteWorkflow(id: string, correlationKey?: string): Promise<boolean>;
  
  setWorkflowEnabled(
    id: string,
    isEnabled: boolean,
    correlationKey?: string
  ): Promise<{ id: string; isEnabled: boolean }>;
  
  getWorkflows(params: {
    accountId: string;
  }): Promise<PaginatedWorkflows>;
  
  // Chat
  sendChatMessage(
    accountId: string,
    message: string
  ): Promise<{ success: boolean; messageId: string }>;
}
```

### Webhook Events (Engine → Convex)

#### Module Events
```typescript
// module.installed
type ModuleInstalledEvent = {
  type: "module.installed";
  correlationKey?: string;
  applicationId: string;
  moduleKey: string;
  moduleName: string;
  version: string;
  // triggers and actions arrive separately
};

// module.install_failed
type ModuleInstallFailedEvent = {
  type: "module.install_failed";
  correlationKey?: string;
  applicationId: string;
  moduleKey: string;
  moduleName: string;
  version: string;
  error: string;
};

// module.deleted
type ModuleDeletedEvent = {
  type: "module.deleted";
  correlationKey?: string;
  applicationId: string;
  moduleKey: string;
  moduleName: string;
};

// module.trigger.registered
type ModuleTriggerRegisteredEvent = {
  type: "module.trigger.registered";
  applicationId: string;
  moduleName: string;
  version: string;
  triggers: TriggerDefinition[];
};

// module.action.registered
type ModuleActionRegisteredEvent = {
  type: "module.action.registered";
  applicationId: string;
  moduleName: string;
  version: string;
  actions: ActionDefinition[];
};
```

#### Workflow Events
```typescript
// workflow.created
type WorkflowCreatedEvent = {
  type: "workflow.created";
  correlationKey?: string;
  applicationId: string;
  workflow: {
    id: string;
    definition: WorkflowDefinition;
    isEnabled: boolean;
    createdAt: string;
    updatedAt: string;
  };
};

// workflow.updated
type WorkflowUpdatedEvent = {
  type: "workflow.updated";
  correlationKey?: string;
  applicationId: string;
  workflow: {
    id: string;
    definition: WorkflowDefinition;
    isEnabled: boolean;
    createdAt: string;
    updatedAt: string;
  };
};

// workflow.deleted
type WorkflowDeletedEvent = {
  type: "workflow.deleted";
  correlationKey?: string;
  applicationId: string;
  workflowId: string;
};
```

### Convex Actions (UI → Convex)

#### Module Actions
```typescript
// convex/moduleEngine.ts
listEngineModules(args: {
  instanceId: Id<"instances">;
}): Promise<EngineModule[]>;

requestModuleUninstall(args: {
  instanceId: Id<"instances">;
  moduleId: Id<"moduleRepository">;
}): Promise<{ moduleKey: string }>;

setEngineModuleState(args: {
  instanceId: Id<"instances">;
  name: string;
  state: string;
}): Promise<{ success: boolean }>;

sendChatMessage(args: {
  instanceId: Id<"instances">;
  message: string;
}): Promise<{ success: boolean; messageId: string }>;
```

#### Workflow Actions
```typescript
// convex/workflowActions.ts
createFromDefinition(args: {
  instanceId: Id<"instances">;
  definition: Omit<WorkflowDefinition, "id">;
}): Promise<{ engineWorkflowId: string }>;

updateFromDefinition(args: {
  instanceId: Id<"instances">;
  engineWorkflowId: string;
  definition: WorkflowDefinition;
}): Promise<{ engineWorkflowId: string }>;

deleteByEngineId(args: {
  instanceId: Id<"instances">;
  engineWorkflowId: string;
}): Promise<{ deleted: true }>;

setEnabled(args: {
  instanceId: Id<"instances">;
  engineWorkflowId: string;
  isEnabled: boolean;
}): Promise<{ isEnabled: boolean }>;
```

---

## Error Handling Strategy

### Error Classification

```
1. USER ERRORS (4xx)
   - Validation errors
   - Permission errors
   - Not found errors
   → Show clear message in UI
   → Allow user to retry/fix

2. ENGINE ERRORS (5xx / timeouts)
   - Engine unreachable
   - Engine internal error
   - Correlation timeout
   → Show retry option
   → Log for debugging
   → Queue for retry if appropriate

3. NETWORK ERRORS
   - Transient failures
   - Timeout
   → Automatic retry with backoff
   → Show "still trying..." in UI

4. WEBHOOK ERRORS
   - Delivery failure
   - Invalid payload
   → Queue for retry
   → Alert if persistent
```

### Error Recovery Patterns

```typescript
// Pattern: Correlation timeout
async function waitForCompletion(
  ctx: ActionCtx,
  correlationKey: string
): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < CORRELATION_TIMEOUT_MS) {
    const row = await ctx.runQuery(
      internal.workflowInternal.findCompletion,
      { correlationKey }
    );
    if (row) {
      return row.engineWorkflowId;
    }
    await new Promise((r) => setTimeout(r, CORRELATION_POLL_MS));
  }
  throw new Error("Engine did not confirm the change within 10s");
}

// Pattern: RPC retry with backoff
async function callEngineWithRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3
): Promise<T> {
  let lastError;
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (isTransientError(err)) {
        await delay(Math.pow(2, i) * 1000);
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

// Pattern: Idempotent webhook handling
async function processModuleInstalled(
  ctx: MutationCtx,
  event: ModuleInstalledEvent
) {
  // Check if already processed
  const existing = await ctx.db
    .query("moduleRepository")
    .withIndex("by_module_key", (q) =>
      q.eq("moduleKey", event.moduleKey)
    )
    .first();
  
  if (existing?.status === "installed") {
    return; // Already processed, idempotent
  }
  
  // Process the event
  // ...
}
```

---

## Testing Strategy

### Testing Philosophy

**Test Coverage Requirements:**
- Unit tests: All utility functions, pure logic, data transformations
- Integration tests: All Convex actions, webhook handlers, database operations
- E2E tests: All critical user flows (happy paths + key error scenarios)
- Component tests: Complex UI components with significant user interaction
- Visual regression tests: Dashboard, Scene Editor, Workflow Builder (screenshot comparison)

**Test Data Strategy:**
- Use factories for generating test data
- Maintain separate test fixtures for different scenarios
- Mock engine RPC responses for predictable testing
- Use real webhook payloads from engine documentation

---

### Unit Tests

#### Core Utilities (Existing)

```typescript
// Test: Workflow projection
// client/src/lib/workflow-projection.test.ts
describe("definitionToReactFlow", () => {
  it("creates trigger node for event trigger", () => {
    const def = {
      name: "Test",
      trigger: { type: "event", eventType: "cheer.user.twitch" },
      tasks: [],
    };
    const result = definitionToReactFlow(def);
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0].id).toBe("__trigger");
    expect(result.nodes[0].type).toBe("trigger");
  });
  
  it("creates dependency edges", () => {
    const def = {
      name: "Test",
      trigger: { type: "event", eventType: "cheer.user.twitch" },
      tasks: [
        { id: "task1", type: "action", dependsOn: ["__trigger"] },
        { id: "task2", type: "action", dependsOn: ["task1"] },
      ],
    };
    const result = definitionToReactFlow(def);
    expect(result.edges).toContainEqual(
      expect.objectContaining({ source: "task1", target: "task2" })
    );
  });
  
  // NEW: Vertical layout tests
  describe("vertical layout", () => {
    it("positions nodes vertically (y-axis)", () => {
      const def = {
        name: "Test",
        trigger: { type: "event", eventType: "cheer" },
        tasks: [
          { id: "task1", type: "action" },
          { id: "task2", type: "action", dependsOn: ["task1"] },
        ],
      };
      const result = definitionToReactFlow(def, { direction: "vertical" });
      expect(result.nodes[1].position.y).toBeGreaterThan(result.nodes[0].position.y);
      expect(result.nodes[2].position.y).toBeGreaterThan(result.nodes[1].position.y);
    });
    
    it("positions condition branches left and right", () => {
      const def = {
        name: "Test",
        trigger: { type: "event", eventType: "cheer" },
        tasks: [
          { 
            id: "check", 
            type: "condition",
            onTrue: ["action1"],
            onFalse: ["action2"]
          },
          { id: "action1", type: "action" },
          { id: "action2", type: "action" },
        ],
      };
      const result = definitionToReactFlow(def, { direction: "vertical" });
      const conditionNode = result.nodes.find(n => n.id === "check");
      const trueBranch = result.nodes.find(n => n.id === "action1");
      const falseBranch = result.nodes.find(n => n.id === "action2");
      expect(trueBranch.position.x).toBeLessThan(conditionNode.position.x);
      expect(falseBranch.position.x).toBeGreaterThan(conditionNode.position.x);
    });
  });
});
```

#### Dashboard Widget Tests (NEW)

```typescript
// client/src/lib/widgets/registry.test.ts
describe("Widget Registry", () => {
  it("registers built-in widgets", () => {
    const widgets = getRegisteredWidgets();
    expect(widgets).toContainEqual(
      expect.objectContaining({ type: "stream-status" })
    );
    expect(widgets).toContainEqual(
      expect.objectContaining({ type: "recent-events" })
    );
  });
  
  it("returns widget metadata", () => {
    const widget = getWidgetMetadata("stream-status");
    expect(widget).toMatchObject({
      name: "Stream Status",
      defaultSize: { width: 4, height: 2 },
      category: "stream",
    });
  });
});

// client/src/components/dashboard/DashboardGrid.test.tsx
describe("DashboardGrid", () => {
  it("renders widgets in correct positions", () => {
    const layout = {
      widgets: [
        { id: "w1", type: "stream-status", position: { x: 0, y: 0 }, size: { width: 4, height: 2 } },
        { id: "w2", type: "chat-preview", position: { x: 4, y: 0 }, size: { width: 4, height: 4 } },
      ],
    };
    render(<DashboardGrid layout={layout} isEditing={false} />);
    expect(screen.getByTestId("widget-w1")).toHaveStyle({ gridColumn: "1 / span 4" });
    expect(screen.getByTestId("widget-w2")).toHaveStyle({ gridColumn: "5 / span 4" });
  });
  
  it("shows resize handles in edit mode", () => {
    render(<DashboardGrid layout={{ widgets: [] }} isEditing={true} />);
    expect(screen.getByTestId("add-widget-button")).toBeVisible();
  });
});

// client/src/components/widgets/StreamStatusWidget.test.tsx
describe("StreamStatusWidget", () => {
  it("displays live status when stream is online", () => {
    const data = { isLive: true, viewerCount: 150, uptime: 3600 };
    render(<StreamStatusWidget data={data} />);
    expect(screen.getByText("LIVE")).toBeVisible();
    expect(screen.getByText("150 viewers")).toBeVisible();
    expect(screen.getByText("1:00:00")).toBeVisible();
  });
  
  it("displays offline status when stream is offline", () => {
    const data = { isLive: false };
    render(<StreamStatusWidget data={data} />);
    expect(screen.getByText("OFFLINE")).toBeVisible();
  });
});
```

#### Alert Log Tests (NEW)

```typescript
// convex/alertLog.test.ts
describe("Alert Log", () => {
  it("inserts alert from webhook", async () => {
    const payload = createAlertPayload({ eventType: "cheer", user: "testuser" });
    await processAlertWebhook(ctx, { type: "alert.recorded", alert: payload });
    
    const alerts = await ctx.db.query("alertLog").collect();
    expect(alerts).toHaveLength(1);
    expect(alerts[0].status).toBe("sent");
  });
  
  it("updates alert status on completion webhook", async () => {
    const alertId = await insertAlert(ctx, { status: "sent" });
    await processAlertWebhook(ctx, { 
      type: "alert.completed", 
      alert: { id: alertId, status: "completed" } 
    });
    
    const updated = await ctx.db.get(alertId);
    expect(updated.status).toBe("completed");
    expect(updated.completedAt).toBeDefined();
  });
  
  it("filters alerts by status", async () => {
    await insertAlert(ctx, { status: "completed" });
    await insertAlert(ctx, { status: "failed" });
    await insertAlert(ctx, { status: "completed" });
    
    const completed = await listAlerts(ctx, { status: "completed" });
    expect(completed).toHaveLength(2);
  });
  
  it("calls engine replay RPC", async () => {
    const mockRpc = jest.fn();
    const alertId = "alert-123";
    
    await replayAlert(ctx, { alertId, rpc: mockRpc });
    
    expect(mockRpc).toHaveBeenCalledWith("replayAlert", alertId);
  });
});
```

#### Debug Tools Tests (NEW)

```typescript
// convex/debug.test.ts
describe("Debug Tools", () => {
  describe("simulateTwitchEvent", () => {
    it("sends follow event to engine", async () => {
      const mockRpc = jest.fn();
      const event = {
        type: "channel.follow",
        user_name: "testuser",
        user_id: "12345",
      };
      
      await simulateTwitchEvent(ctx, { event, rpc: mockRpc });
      
      expect(mockRpc).toHaveBeenCalledWith(
        "dispatchTestEvent",
        expect.objectContaining({
          type: "channel.follow",
          payload: expect.objectContaining({ user_name: "testuser" }),
        })
      );
    });
    
    it("validates cheer event has bits > 0", async () => {
      const event = {
        type: "channel.cheer",
        user_name: "testuser",
        bits: 0,
      };
      
      await expect(simulateTwitchEvent(ctx, { event }))
        .rejects.toThrow("Bits must be greater than 0");
    });
    
    it("logs event to history", async () => {
      await simulateTwitchEvent(ctx, { event: { type: "channel.follow", user_name: "test" } });
      
      const history = await ctx.db.query("debugEventHistory").collect();
      expect(history).toHaveLength(1);
      expect(history[0].eventType).toBe("channel.follow");
      expect(history[0].success).toBe(true);
    });
  });
});
```

#### Storage Settings Tests (NEW)

```typescript
// convex/engineSettings.test.ts
describe("Storage Settings", () => {
  it("retrieves storage config from engine", async () => {
    const mockRpc = jest.fn().mockResolvedValue({
      provider: "s3",
      bucket: "my-bucket",
      region: "us-east-1",
      // Note: credentials NOT returned
    });
    
    const config = await getStorageConfig(ctx, { rpc: mockRpc });
    
    expect(config.provider).toBe("s3");
    expect(config.accessKey).toBeUndefined(); // Never exposed
  });
  
  it("sets storage config on engine", async () => {
    const mockRpc = jest.fn().mockResolvedValue({ success: true });
    const config = {
      provider: "s3" as const,
      bucket: "new-bucket",
      region: "us-west-2",
      accessKey: "AKIA...",
      secretKey: "secret...",
    };
    
    await setStorageConfig(ctx, { config, rpc: mockRpc });
    
    expect(mockRpc).toHaveBeenCalledWith("setStorageConfig", config);
  });
  
  it("tests connection before saving", async () => {
    const mockRpc = jest.fn()
      .mockResolvedValueOnce({ success: true }) // test connection
      .mockResolvedValueOnce({ success: true }); // save
    
    const result = await setStorageConfigWithTest(ctx, { 
      config: { provider: "s3", bucket: "test" },
      rpc: mockRpc 
    });
    
    expect(mockRpc).toHaveBeenCalledTimes(2);
    expect(result.testPassed).toBe(true);
  });
});
```

#### Scene Management Tests (NEW)

```typescript
// convex/scenes.test.ts
describe("Scene Management", () => {
  it("creates scene via engine RPC", async () => {
    const mockRpc = jest.fn().mockResolvedValue({ id: "scene-123" });
    
    const result = await createScene(ctx, {
      name: "My Scene",
      accountId: "acc-1",
      rpc: mockRpc,
    });
    
    expect(mockRpc).toHaveBeenCalledWith("createScene", expect.objectContaining({
      name: "My Scene",
      accountId: "acc-1",
    }));
    expect(result.engineSceneId).toBe("scene-123");
  });
  
  it("upserts scene from webhook", async () => {
    const event = {
      type: "scene.created",
      scene: {
        id: "scene-123",
        name: "Test Scene",
        widgetsJson: "[]",
        layoutJson: "{}",
      },
    };
    
    await processSceneWebhook(ctx, event);
    
    const scenes = await ctx.db.query("scenes").collect();
    expect(scenes).toHaveLength(1);
    expect(scenes[0].engineSceneId).toBe("scene-123");
  });
  
  it("generates browser source URL", async () => {
    const scene = await insertScene(ctx, { engineSceneId: "scene-123" });
    
    const url = await getBrowserSourceUrl(ctx, { sceneId: scene._id });
    
    expect(url).toContain("/api/browser-source/");
    expect(url).toContain(scene.sourceKey);
  });
});

// client/src/components/scenes/SceneCanvas.test.tsx
describe("SceneCanvas", () => {
  it("renders widgets at correct positions", () => {
    const widgets = [
      { id: "w1", widgetDefinitionRef: "widget-1", position: { x: 100, y: 200 }, size: { width: 300, height: 150 } },
    ];
    render(<SceneCanvas widgets={widgets} />);
    
    const widgetEl = screen.getByTestId("widget-w1");
    expect(widgetEl).toHaveStyle({ left: "100px", top: "200px", width: "300px", height: "150px" });
  });
  
  it("calls onWidgetMove when widget is dragged", () => {
    const onWidgetMove = jest.fn();
    render(<SceneCanvas widgets={[]} onWidgetMove={onWidgetMove} />);
    
    // Simulate drag
    const canvas = screen.getByTestId("scene-canvas");
    fireEvent.dragStart(canvas, { dataTransfer: { setData: jest.fn() } });
    fireEvent.drop(canvas, { clientX: 150, clientY: 250 });
    
    expect(onWidgetMove).toHaveBeenCalledWith(expect.objectContaining({ x: 150, y: 250 }));
  });
});
```

---

### Integration Tests

```typescript
// Test: Module installation flow
// convex/moduleEngine.test.ts
describe("module installation", () => {
  it("installs module and receives webhook confirmation", async () => {
    // 1. Upload module ZIP
    // 2. Call uploadAndDeliver
    // 3. Simulate engine webhook
    // 4. Verify moduleRepository record
    // 5. Verify transient event
  });
});

// NEW: Dashboard layout persistence
describe("Dashboard Layout", () => {
  it("saves and retrieves user layout", async () => {
    const userId = "user-1";
    const instanceId = "instance-1";
    const layout = {
      widgets: [{ id: "w1", type: "stream-status", position: { x: 0, y: 0 }, size: { width: 4, height: 2 } }],
    };
    
    await saveDashboardLayout(ctx, { userId, instanceId, layout });
    const retrieved = await getDashboardLayout(ctx, { userId, instanceId });
    
    expect(retrieved.layout.widgets).toHaveLength(1);
    expect(retrieved.layout.widgets[0].type).toBe("stream-status");
  });
});

// NEW: Alert log integration
describe("Alert Log Integration", () => {
  it("receives alert via webhook and displays in UI", async () => {
    // 1. Simulate alert.recorded webhook
    // 2. Verify alert inserted in database
    // 3. Verify Convex query returns alert
    // 4. Simulate UI subscription update
  });
  
  it("replays alert through engine RPC", async () => {
    // 1. Insert test alert
    // 2. Call replay action
    // 3. Verify engine RPC called
    // 4. Verify alert status updated to "replayed"
  });
});

// NEW: Scene workflow integration
describe("Scene Workflow", () => {
  it("creates scene and updates via webhook", async () => {
    // 1. Create scene via action
    // 2. Verify pending operation inserted
    // 3. Simulate scene.created webhook
    // 4. Verify scene upserted in database
    // 5. Verify pending operation cleared
  });
});
```

---

### Component Tests

```typescript
// NEW: Alert Log UI Component Tests
// client/src/components/alerts/AlertList.test.tsx
describe("AlertList", () => {
  it("renders alerts with correct status indicators", () => {
    const alerts = [
      { id: "1", status: "completed", eventType: "cheer", user: "user1", createdAt: Date.now() },
      { id: "2", status: "failed", eventType: "follow", user: "user2", createdAt: Date.now() },
    ];
    render(<AlertList alerts={alerts} />);
    
    expect(screen.getByText("user1")).toBeVisible();
    expect(screen.getByText("user2")).toBeVisible();
    expect(screen.getByTestId("status-1")).toHaveClass("status-completed");
    expect(screen.getByTestId("status-2")).toHaveClass("status-failed");
  });
  
  it("filters alerts by event type", () => {
    const onFilterChange = jest.fn();
    render(<AlertFilters onFilterChange={onFilterChange} />);
    
    fireEvent.change(screen.getByLabelText("Event Type"), { target: { value: "cheer" } });
    expect(onFilterChange).toHaveBeenCalledWith(expect.objectContaining({ eventType: "cheer" }));
  });
});

// NEW: Debug Tools Component Tests
// client/src/components/debug/EventSimulator.test.tsx
describe("EventSimulator", () => {
  it("renders form fields for selected event type", () => {
    render(<EventSimulator />);
    
    fireEvent.change(screen.getByLabelText("Event Type"), { target: { value: "channel.cheer" } });
    
    expect(screen.getByLabelText("Bits")).toBeVisible();
    expect(screen.getByLabelText("Message")).toBeVisible();
  });
  
  it("validates required fields before sending", async () => {
    render(<EventSimulator onSend={jest.fn()} />);
    
    fireEvent.change(screen.getByLabelText("Event Type"), { target: { value: "channel.cheer" } });
    fireEvent.click(screen.getByText("Send Event"));
    
    await waitFor(() => {
      expect(screen.getByText("Bits is required")).toBeVisible();
    });
  });
});

// NEW: Storage Settings Component Tests
// client/src/components/settings/StorageSettings.test.tsx
describe("StorageSettings", () => {
  it("shows provider-specific fields", () => {
    render(<StorageSettings config={{ provider: "s3" }} />);
    
    expect(screen.getByLabelText("Bucket")).toBeVisible();
    expect(screen.getByLabelText("Region")).toBeVisible();
  });
  
  it("masks credential fields", () => {
    render(<StorageSettings config={{ provider: "s3", accessKey: "AKIA..." }} />);
    
    const accessKeyInput = screen.getByLabelText("Access Key ID");
    expect(accessKeyInput).toHaveAttribute("type", "password");
  });
});
```

---

### End-to-End Tests

#### Core Workflows (Existing)

```typescript
// e2e/workflow.spec.ts
test("user can create a workflow", async ({ page }) => {
  await page.goto("/workflows");
  await page.click("[data-testid='button-new-workflow']");
  
  // Fill basic editor
  await page.selectOption("[name='trigger']", "cheer.user.twitch");
  await page.selectOption("[name='action']", "sendChatMessage");
  await page.fill("[name='message']", "Thanks for the cheer!");
  
  // Create
  await page.click("[data-testid='button-create-workflow']");
  
  // Wait for navigation to builder
  await page.waitForURL(/\/workflows\/.+/);
  
  // Verify canvas rendered
  await expect(page.locator("[data-testid='react-flow-canvas']")).toBeVisible();
});
```

#### Dashboard Widget E2E Tests (NEW)

```typescript
// e2e/dashboard.spec.ts
test.describe("Dashboard Widgets", () => {
  test("user can add and arrange widgets", async ({ page }) => {
    await page.goto("/dashboard");
    
    // Add Stream Status widget
    await page.click("[data-testid='add-widget-button']");
    await page.click("[data-testid='widget-option-stream-status']");
    await page.click("[data-testid='confirm-add-widget']");
    
    // Verify widget added
    await expect(page.locator("[data-testid='widget-stream-status']")).toBeVisible();
    
    // Enter edit mode
    await page.click("[data-testid='edit-dashboard-button']");
    
    // Resize widget
    const widget = page.locator("[data-testid='widget-stream-status']");
    const resizeHandle = widget.locator("[data-testid='resize-handle']");
    await resizeHandle.dragTo(page.locator("[data-testid='grid-cell-4-4']"));
    
    // Save layout
    await page.click("[data-testid='save-layout-button']");
    
    // Reload and verify layout persisted
    await page.reload();
    await expect(widget).toHaveClass(/size-4x4/);
  });
  
  test("stream status widget shows live data", async ({ page }) => {
    // Mock engine stream status
    await page.route("**/api/engine/stream-status", async (route) => {
      await route.fulfill({
        status: 200,
        body: JSON.stringify({ isLive: true, viewerCount: 150, uptime: 3600 }),
      });
    });
    
    await page.goto("/dashboard");
    await page.click("[data-testid='add-widget-button']");
    await page.click("[data-testid='widget-option-stream-status']");
    
    await expect(page.locator("[data-testid='stream-status-live']")).toContainText("LIVE");
    await expect(page.locator("[data-testid='stream-status-viewers']")).toContainText("150");
  });
  
  test("user can remove widget", async ({ page }) => {
    await page.goto("/dashboard");
    
    // Add widget first
    await page.click("[data-testid='add-widget-button']");
    await page.click("[data-testid='widget-option-chat-preview']");
    
    // Enter edit mode and remove
    await page.click("[data-testid='edit-dashboard-button']");
    await page.click("[data-testid='widget-chat-preview'] [data-testid='remove-widget-button']");
    await page.click("[data-testid='confirm-remove-widget']");
    
    // Verify widget removed
    await expect(page.locator("[data-testid='widget-chat-preview']")).not.toBeVisible();
  });
});
```

#### Alert Log E2E Tests (NEW)

```typescript
// e2e/alerts.spec.ts
test.describe("Alert Log", () => {
  test("alerts appear in log when triggered", async ({ page }) => {
    await page.goto("/alerts");
    
    // Initially empty
    await expect(page.locator("[data-testid='alert-list-empty']")).toBeVisible();
    
    // Trigger alert via debug tool
    await page.goto("/debug");
    await page.selectOption("[name='eventType']", "channel.follow");
    await page.fill("[name='user_name']", "testfollower");
    await page.click("[data-testid='send-event-button']");
    
    // Go back to alerts and verify
    await page.goto("/alerts");
    await expect(page.locator("[data-testid='alert-item']")).toContainText("testfollower");
    await expect(page.locator("[data-testid='alert-item']")).toContainText("follow");
  });
  
  test("user can replay alert", async ({ page }) => {
    await page.goto("/alerts");
    
    // Wait for alert to appear
    await page.waitForSelector("[data-testid='alert-item']");
    
    // Click replay
    await page.click("[data-testid='alert-item']:first-child [data-testid='replay-button']");
    await page.click("[data-testid='confirm-replay-button']");
    
    // Verify success toast
    await expect(page.locator("[data-testid='toast-success']")).toContainText("Alert replayed");
  });
  
  test("alert filters work correctly", async ({ page }) => {
    await page.goto("/alerts");
    
    // Apply status filter
    await page.selectOption("[data-testid='status-filter']", "completed");
    
    // All visible alerts should have completed status
    const alerts = await page.locator("[data-testid='alert-item']").all();
    for (const alert of alerts) {
      await expect(alert.locator("[data-testid='alert-status']")).toContainText("completed");
    }
  });
  
  test("alert detail shows full information", async ({ page }) => {
    await page.goto("/alerts");
    await page.waitForSelector("[data-testid='alert-item']");
    
    // Click on alert
    await page.click("[data-testid='alert-item']:first-child");
    
    // Verify detail panel shows
    await expect(page.locator("[data-testid='alert-detail-panel']")).toBeVisible();
    await expect(page.locator("[data-testid='alert-payload']")).toBeVisible();
    await expect(page.locator("[data-testid='alert-timeline']")).toBeVisible();
  });
});
```

#### Debug Tools E2E Tests (NEW)

```typescript
// e2e/debug.spec.ts
test.describe("Debug Tools", () => {
  test.beforeEach(async ({ page }) => {
    // Assume admin user is logged in
    await page.goto("/debug");
  });
  
  test("event simulator shows correct form fields", async ({ page }) => {
    await page.selectOption("[name='eventType']", "channel.cheer");
    
    // Cheer-specific fields should appear
    await expect(page.locator("[name='bits']")).toBeVisible();
    await expect(page.locator("[name='message']")).toBeVisible();
    
    // Switch to follow
    await page.selectOption("[name='eventType']", "channel.follow");
    
    // Follow-specific fields should appear
    await expect(page.locator("[name='user_name']")).toBeVisible();
    await expect(page.locator("[name='bits']")).not.toBeVisible();
  });
  
  test("event validation prevents invalid data", async ({ page }) => {
    await page.selectOption("[name='eventType']", "channel.cheer");
    await page.fill("[name='bits']", "0");
    await page.click("[data-testid='send-event-button']");
    
    await expect(page.locator("[data-testid='validation-error']")).toContainText("Bits must be greater than 0");
  });
  
  test("simulated event appears in history", async ({ page }) => {
    await page.selectOption("[name='eventType']", "channel.raid");
    await page.fill("[name='from_broadcaster_user_name']", "raidertest");
    await page.fill("[name='viewers']", "100");
    await page.click("[data-testid='send-event-button']");
    
    // Check history section
    await expect(page.locator("[data-testid='event-history']")).toContainText("raidertest");
    await expect(page.locator("[data-testid='event-history']")).toContainText("channel.raid");
  });
  
  test("engine health check shows status", async ({ page }) => {
    await page.click("[data-testid='health-tab']");
    
    await page.click("[data-testid='test-connection-button']");
    
    await expect(page.locator("[data-testid='connection-status']")).toContainText("Connected");
    await expect(page.locator("[data-testid='last-ping']")).toBeVisible();
  });
  
  test("webhook inspector shows recent deliveries", async ({ page }) => {
    await page.click("[data-testid='webhook-tab']");
    
    // Should show webhook list
    await expect(page.locator("[data-testid='webhook-list']")).toBeVisible();
    
    // Click on webhook to see payload
    await page.click("[data-testid='webhook-item']:first-child");
    await expect(page.locator("[data-testid='webhook-payload']")).toBeVisible();
  });
});
```

#### Storage Settings E2E Tests (NEW)

```typescript
// e2e/settings.spec.ts
test.describe("Storage Settings", () => {
  test("user can configure S3 storage", async ({ page }) => {
    await page.goto("/settings/storage");
    
    // Select S3 provider
    await page.selectOption("[name='provider']", "s3");
    
    // Fill in S3-specific fields
    await page.fill("[name='bucket']", "my-test-bucket");
    await page.fill("[name='region']", "us-east-1");
    await page.fill("[name='accessKey']", "AKIAIOSFODNN7EXAMPLE");
    await page.fill("[name='secretKey']", "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY");
    
    // Test connection
    await page.click("[data-testid='test-connection-button']");
    await expect(page.locator("[data-testid='connection-test-result']")).toContainText("Success");
    
    // Save configuration
    await page.click("[data-testid='save-storage-config']");
    await expect(page.locator("[data-testid='toast-success']")).toContainText("Storage configuration saved");
  });
  
  test("credentials are masked after saving", async ({ page }) => {
    await page.goto("/settings/storage");
    
    // Existing config with credentials
    await page.selectOption("[name='provider']", "s3");
    
    // Credentials should be masked
    const accessKeyInput = page.locator("[name='accessKey']");
    await expect(accessKeyInput).toHaveAttribute("type", "password");
    await expect(accessKeyInput).toHaveValue(""); // Empty or placeholder
    
    // Secret key should also be masked
    const secretKeyInput = page.locator("[name='secretKey']");
    await expect(secretKeyInput).toHaveAttribute("type", "password");
  });
  
  test("file provider shows path field only", async ({ page }) => {
    await page.goto("/settings/storage");
    
    await page.selectOption("[name='provider']", "file");
    
    // Should only show destination path
    await expect(page.locator("[name='destination']")).toBeVisible();
    await expect(page.locator("[name='bucket']")).not.toBeVisible();
    await expect(page.locator("[name='region']")).not.toBeVisible();
  });
  
  test("connection failure shows error", async ({ page }) => {
    await page.goto("/settings/storage");
    
    await page.selectOption("[name='provider']", "s3");
    await page.fill("[name='bucket']", "invalid-bucket");
    await page.fill("[name='accessKey']", "invalid");
    
    await page.click("[data-testid='test-connection-button']");
    
    await expect(page.locator("[data-testid='connection-test-result']")).toContainText("Failed");
    await expect(page.locator("[data-testid='connection-error']")).toBeVisible();
  });
});
```

#### Scene Management E2E Tests (NEW)

```typescript
// e2e/scenes.spec.ts
test.describe("Scene Management", () => {
  test("user can create a scene", async ({ page }) => {
    await page.goto("/scenes");
    
    await page.click("[data-testid='create-scene-button']");
    await page.fill("[name='sceneName']", "Test Scene");
    await page.fill("[name='sceneDescription']", "A test scene");
    await page.click("[data-testid='confirm-create-scene']");
    
    // Should redirect to scene editor
    await page.waitForURL(/\/scenes\/.+\/edit/);
    
    // Verify scene created
    await expect(page.locator("[data-testid='scene-name']")).toHaveValue("Test Scene");
  });
  
  test("user can add widget to scene", async ({ page }) => {
    await page.goto("/scenes/test-scene-id/edit");
    
    // Open widget palette
    await page.click("[data-testid='open-widget-palette']");
    
    // Drag widget to canvas
    const widget = page.locator("[data-testid='widget-option-alert-container']");
    const canvas = page.locator("[data-testid='scene-canvas']");
    await widget.dragTo(canvas, { targetPosition: { x: 100, y: 100 } });
    
    // Verify widget on canvas
    await expect(page.locator("[data-testid='scene-widget']")).toBeVisible();
  });
  
  test("user can copy browser source URL", async ({ page }) => {
    await page.goto("/scenes");
    
    // Click on scene
    await page.click("[data-testid='scene-card']:first-child");
    
    // Copy URL button
    await page.click("[data-testid='copy-browser-source-url']");
    
    // Verify toast
    await expect(page.locator("[data-testid='toast-success']")).toContainText("URL copied to clipboard");
  });
  
  test("scene editor saves changes", async ({ page }) => {
    await page.goto("/scenes/test-scene-id/edit");
    
    // Add widget
    await page.click("[data-testid='open-widget-palette']");
    await page.click("[data-testid='widget-option-chat-overlay']");
    
    // Configure widget
    await page.click("[data-testid='scene-widget']:first-child");
    await page.fill("[name='widgetConfig.maxMessages']", "10");
    
    // Save
    await page.click("[data-testid='save-scene-button']");
    
    // Verify success
    await expect(page.locator("[data-testid='toast-success']")).toContainText("Scene saved");
    
    // Reload and verify persistence
    await page.reload();
    await expect(page.locator("[name='widgetConfig.maxMessages']")).toHaveValue("10");
  });
  
  test("overlay preview renders scene", async ({ page }) => {
    await page.goto("/scenes/test-scene-id");
    
    // Open preview
    await page.click("[data-testid='preview-overlay-button']");
    
    // Should open preview modal with iframe
    const previewFrame = page.locator("[data-testid='overlay-preview-frame']");
    await expect(previewFrame).toBeVisible();
    
    // Frame should load overlay URL
    await expect(previewFrame).toHaveAttribute("src", /\/api\/browser-source\//);
  });
});
```

#### Vertical Workflow Builder E2E Tests (NEW)

```typescript
// e2e/workflow-builder.spec.ts
test.describe("Vertical Workflow Builder", () => {
  test("workflow displays vertically", async ({ page }) => {
    await page.goto("/workflows/test-workflow-id/edit");
    
    // Get positions of nodes
    const triggerNode = page.locator("[data-testid='node-__trigger']");
    const actionNode = page.locator("[data-testid='node-action-1']");
    
    const triggerBox = await triggerNode.boundingBox();
    const actionBox = await actionNode.boundingBox();
    
    // Action should be below trigger (y-axis)
    expect(actionBox.y).toBeGreaterThan(triggerBox.y);
  });
  
  test("condition branches display left and right", async ({ page }) => {
    await page.goto("/workflows/workflow-with-condition/edit");
    
    const conditionNode = page.locator("[data-testid='node-condition-1']");
    const trueBranch = page.locator("[data-testid='node-action-true']");
    const falseBranch = page.locator("[data-testid='node-action-false']");
    
    const conditionBox = await conditionNode.boundingBox();
    const trueBox = await trueBranch.boundingBox();
    const falseBox = await falseBranch.boundingBox();
    
    // True branch left, false branch right
    expect(trueBox.x).toBeLessThan(conditionBox.x);
    expect(falseBox.x).toBeGreaterThan(conditionBox.x);
  });
  
  test("step panel syncs with canvas selection", async ({ page }) => {
    await page.goto("/workflows/test-workflow-id/edit");
    
    // Click on node in canvas
    await page.click("[data-testid='node-action-1']");
    
    // Step panel should highlight same step
    await expect(page.locator("[data-testid='step-panel-item-action-1']")).toHaveClass(/selected/);
    
    // Click different step in panel
    await page.click("[data-testid='step-panel-item-action-2']");
    
    // Canvas should center on that node
    await expect(page.locator("[data-testid='node-action-2']")).toBeInViewport();
  });
  
  test("quick add inserts step between existing steps", async ({ page }) => {
    await page.goto("/workflows/test-workflow-id/edit");
    
    // Click add button between trigger and action
    await page.click("[data-testid='add-step-between-__trigger-action-1']");
    
    // Select action from picker
    await page.click("[data-testid='action-sendChatMessage']");
    
    // Verify new step inserted
    await expect(page.locator("[data-testid='node-action-3']")).toBeVisible();
    
    // Verify edges updated
    await expect(page.locator("[data-testid='edge-__trigger-action-3']")).toBeVisible();
    await expect(page.locator("[data-testid='edge-action-3-action-1']")).toBeVisible();
  });
  
  test("touch interactions work on canvas", async ({ page }) => {
    await page.goto("/workflows/test-workflow-id/edit");
    
    // Simulate pinch zoom
    await page.touchscreen.pinchandzoom({
      center: { x: 400, y: 300 },
      scale: 2,
    });
    
    // Canvas should zoom in
    const canvas = page.locator("[data-testid='react-flow-canvas']");
    await expect(canvas).toHaveCSS("transform", /scale\(2\)/);
  });
});
```

---

### Visual Regression Tests

```typescript
// visual/dashboard.spec.ts
test.describe("Dashboard Visual Regression", () => {
  test("dashboard with widgets matches snapshot", async ({ page }) => {
    await page.goto("/dashboard");
    
    // Add several widgets
    await page.click("[data-testid='add-widget-button']");
    await page.click("[data-testid='widget-option-stream-status']");
    await page.click("[data-testid='add-widget-button']");
    await page.click("[data-testid='widget-option-recent-events']");
    
    // Wait for data to load
    await page.waitForSelector("[data-testid='widget-loaded']");
    
    // Screenshot comparison
    expect(await page.screenshot()).toMatchSnapshot("dashboard-with-widgets.png");
  });
});

// visual/scenes.spec.ts
test.describe("Scene Editor Visual Regression", () => {
  test("scene editor canvas matches snapshot", async ({ page }) => {
    await page.goto("/scenes/test-scene/edit");
    
    // Add some widgets
    await page.click("[data-testid='open-widget-palette']");
    await page.click("[data-testid='widget-option-alert-container']");
    await page.click("[data-testid='widget-option-chat-overlay']");
    
    // Position widgets
    await page.dragAndDrop(
      "[data-testid='scene-widget']:first-child",
      "[data-testid='scene-canvas']",
      { targetPosition: { x: 100, y: 100 } }
    );
    
    expect(await page.screenshot()).toMatchSnapshot("scene-editor-with-widgets.png");
  });
});

// visual/workflows.spec.ts
test.describe("Workflow Builder Visual Regression", () => {
  test("vertical workflow layout matches snapshot", async ({ page }) => {
    await page.goto("/workflows/complex-workflow/edit");
    
    // Wait for layout to stabilize
    await page.waitForTimeout(500);
    
    expect(await page.screenshot()).toMatchSnapshot("vertical-workflow-layout.png");
  });
  
  test("condition branches visible", async ({ page }) => {
    await page.goto("/workflows/conditional-workflow/edit");
    
    await page.waitForTimeout(500);
    
    expect(await page.screenshot()).toMatchSnapshot("workflow-condition-branches.png");
  });
});
```

---

### Test Coverage Requirements by Work Stream

| Work Stream | Unit Tests | Integration Tests | E2E Tests | Visual Tests |
|------------|------------|-------------------|-----------|--------------|
| A: Registration | Auth logic, credential encryption | Registration flow, health checks | Complete registration | - |
| B: Modules | Module metadata parsing | Install/uninstall flow | Install from ZIP | - |
| C: Workflows | Projection logic, JSON validation | CRUD operations, webhooks | Create, edit, delete workflows | Workflow canvas |
| D: Webhooks | Webhook parsing, idempotency | All webhook handlers | - | - |
| E: Transport | RPC utilities, error handling | Session management | - | - |
| **F: Dashboard** | Widget registry, layout calc | Layout save/load | Add, arrange, remove widgets | Dashboard grid |
| **G: Alert Log** | Status transitions | Webhook processing, replay | View, filter, replay alerts | Alert list |
| **H: Debug** | Event validation | Event simulation | Send test events, view history | - |
| **I: Storage** | Config validation | Get/set config | Configure storage | - |
| **J: Scenes** | Widget positioning | Scene CRUD, widget ops | Create scene, add widgets, preview | Scene editor |
| **K: Vertical Workflow** | Vertical layout algorithm | Builder integration | Edit workflow, step panel | Workflow canvas |

---

## Monitoring & Observability

### Metrics to Track

1. **Registration Health**
   - Registration success rate
   - Registration duration
   - Credential rotation frequency

2. **RPC Performance**
   - Call latency (p50, p95, p99)
   - Error rate by error type
   - Retry rate

3. **Webhook Health**
   - Delivery success rate
   - Delivery latency
   - Retry rate
   - Queue depth (if using queue)

4. **Correlation System**
   - Pending operation count
   - Timeout rate
   - Average correlation time

5. **UI Performance**
   - Page load times
   - Query latency
   - Action completion times

### Logging Standards

```typescript
// Structured logging for all engine calls
logger.info("engine.rpc.request", {
  instanceId,
  rpc: "createWorkflow",
  correlationKey,
  duration_ms: 123,
});

logger.error("engine.rpc.error", {
  instanceId,
  rpc: "createWorkflow",
  correlationKey,
  error: error.message,
  error_type: error.constructor.name,
  retry_count: 2,
});

// Structured logging for webhooks
logger.info("webhook.received", {
  instanceId,
  event_type: "workflow.created",
  event_id: event.id,
  delivery_timestamp: Date.now(),
});

logger.error("webhook.processing_error", {
  instanceId,
  event_type: "workflow.created",
  error: error.message,
  payload_size: JSON.stringify(payload).length,
});
```

---

## Security Considerations

### Authentication & Authorization

1. **Registration Security**
   - Client credentials transmitted once (TLS)
   - clientSecret encrypted at rest
   - webhookSecret used for webhook auth only

2. **RPC Security**
   - All RPC over HTTPS
   - Client credentials in every request
   - Request signing (if supported by engine)

3. **Webhook Security**
   - Bearer token authentication
   - Idempotency keys prevent replay attacks
   - Rate limiting on webhook endpoint
   - Payload size limits

4. **UI Authorization**
   - All actions check user authentication
   - Instance-level access control
   - Account membership verification

### Data Protection

1. **Credentials**
   ```typescript
   // Encrypt sensitive fields
   {
     clientSecret: encrypt(clientSecret),
     webhookSecret: encrypt(webhookSecret),
   }
   ```

2. **PII**
   - Minimize PII in logs
   - Redact tokens in error messages
   - Audit access to sensitive data

---

## Deployment & Migration

### Database Migration

1. **Schema Updates**
   - Add new tables first (nullable columns)
   - Backfill data in batches
   - Make columns required
   - Drop old columns

2. **Data Migration**
   - Existing workflows: wipe and recreate
   - Existing modules: re-sync from engine
   - Correlation tables: start fresh

### Rollback Plan

1. **Code Rollback**
   - Keep old RPC endpoints for compatibility
   - Feature flags for new behavior
   - Gradual rollout with monitoring

2. **Data Rollback**
   - Backup before migration
   - Restore script tested
   - Documented rollback steps

---

## Success Criteria

### Functional - Core (Streams A-E)

- [ ] User can register a new engine instance
- [ ] User can install a module from ZIP file
- [ ] User sees real-time progress during installation
- [ ] User can uninstall a module
- [ ] User can create a workflow via basic editor
- [ ] User can edit a workflow in visual builder
- [ ] User can toggle workflow enabled/disabled
- [ ] User can delete a workflow
- [ ] All changes sync bidirectionally with engine
- [ ] Webhook events are processed reliably
- [ ] Errors are handled gracefully with clear messages

### Functional - Dashboard (Stream F)

- [ ] User can add/remove widgets from dashboard
- [ ] User can drag to rearrange dashboard widgets
- [ ] User can resize dashboard widgets
- [ ] Dashboard layout persists per user per instance
- [ ] Dashboard widgets show real-time data
- [ ] All 7 built-in widgets work correctly:
  - Stream Status Widget
  - Recent Events Widget
  - Quick Actions Widget
  - Chat Preview Widget
  - Module Status Widget
  - Workflow Activity Widget
  - Alert Queue Widget

### Functional - Alert Log (Stream G)

- [ ] All alerts appear in log within 1 second of firing
- [ ] User can filter alerts by date, type, status
- [ ] User can replay individual alerts
- [ ] Alert detail shows complete information
- [ ] Real-time alert updates work without page refresh
- [ ] Alert replay successfully triggers browser overlay

### Functional - Debug Tools (Stream H)

- [ ] All major Twitch event types can be simulated:
  - Follow, Subscribe, Cheer, Raid
  - Channel point redemptions
  - Stream online/offline
- [ ] Form validation prevents invalid event data
- [ ] Simulated events appear in alert log/workflows as if real
- [ ] Engine health diagnostics show accurate status
- [ ] Recent simulated events show in history

### Functional - Storage Settings (Stream I)

- [ ] User can view current storage configuration
- [ ] User can switch between storage providers (File, S3, R2, MinIO)
- [ ] Credentials are never exposed in UI (write-only fields)
- [ ] Connection test works before saving configuration
- [ ] Clear warning shown about restart required
- [ ] Configuration persists in engine settings

### Functional - Scene Management (Stream J)

- [ ] User can create new scenes
- [ ] User can view list of all scenes
- [ ] User can add widgets to scene via drag-and-drop
- [ ] User can position and resize widgets on canvas
- [ ] User can configure widget settings
- [ ] User can copy browser source URL for OBS Studio
- [ ] User can preview overlay in browser
- [ ] Changes save to engine and reflect immediately in overlay

### Functional - Vertical Workflow Editor (Stream K)

- [ ] Workflows flow vertically from top to bottom
- [ ] Condition branches are clearly visible (left/right)
- [ ] Nodes don't overlap with auto-layout
- [ ] Touch interactions work smoothly on canvas
- [ ] Step panel syncs with canvas selection
- [ ] Quick add interface makes workflow creation faster
- [ ] JSON-first workflow editing works correctly

### Performance

- [ ] Page load < 2 seconds
- [ ] RPC calls < 500ms (p95)
- [ ] Webhook processing < 100ms
- [ ] UI updates reactively within 1 second of webhook
- [ ] Dashboard widget data refreshes < 1 second
- [ ] Scene editor canvas renders at 60fps
- [ ] Workflow builder with 50+ nodes remains responsive

### Performance

- [ ] Page load < 2 seconds
- [ ] RPC calls < 500ms (p95)
- [ ] Webhook processing < 100ms
- [ ] UI updates reactively within 1 second of webhook

### Reliability

- [ ] 99.9% webhook delivery success
- [ ] < 0.1% correlation timeout rate
- [ ] Zero data loss during normal operation
- [ ] Automatic recovery from transient failures

### Security

- [ ] All credentials encrypted at rest
- [ ] All communication over TLS
- [ ] Proper authorization on all actions
- [ ] No credential exposure in logs

### Testing Coverage Requirements

#### Unit Test Coverage
- [ ] **Minimum 80% code coverage** for all utility functions
- [ ] **100% coverage** for critical path functions:
  - Workflow projection logic
  - Widget layout calculations
  - Alert status transitions
  - Event validation functions
  - Storage configuration validators
  - Scene widget positioning
- [ ] All error handling branches tested
- [ ] All edge cases documented and tested

#### Integration Test Coverage
- [ ] **All Convex actions** must have integration tests
- [ ] **All webhook handlers** must have integration tests
- [ ] Database operations tested with real Convex backend
- [ ] Engine RPC calls mocked and tested
- [ ] Correlation pattern tested end-to-end
- [ ] Each work stream must have integration test suite

#### E2E Test Coverage
- [ ] **All critical user flows** must have E2E tests:
  - Registration and onboarding
  - Module install/uninstall
  - Workflow CRUD operations
  - Dashboard widget management
  - Alert log viewing and replay
  - Debug event simulation
  - Storage configuration
  - Scene creation and editing
- [ ] **Happy path and error scenarios** covered
- [ ] **Cross-browser testing** (Chrome, Firefox, Safari)
- [ ] **Mobile responsiveness** tested for key pages

#### Visual Regression Coverage
- [ ] **Dashboard** with all widget types
- [ ] **Scene editor** with widgets placed
- [ ] **Workflow builder** - simple and complex workflows
- [ ] **Alert log** with various alert states
- [ ] **Settings pages** - all configuration UIs

#### Test Data Requirements
- [ ] Test factories for all data types
- [ ] Realistic mock data for:
  - Twitch events (follow, sub, cheer, raid)
  - Module configurations
  - Workflow definitions
  - Alert payloads
  - Scene layouts
- [ ] Edge case data sets (empty, maximum, malformed)

#### Test Automation Requirements
- [ ] **Pre-commit hooks**: Unit tests must pass
- [ ] **CI/CD pipeline**: All tests run on PR
- [ ] **Nightly runs**: Full E2E suite
- [ ] **Performance benchmarks**: Track over time
- [ ] **Flaky test detection**: Auto-quarantine

---

## Appendix

### Glossary

- **Instance**: A woofx3 engine deployment (single-tenant)
- **instanceId**: Convex-generated ID for an instance (the `_id` field)
- **Application**: Engine-internal multi-tenancy concept (currently 1:1 with instance)
- **applicationId**: Engine-generated ID for an application
- **Correlation**: Pattern for matching async operations with their results
- **Correlation Key**: UUID generated by Convex to track an async operation
- **Projection**: UI-specific representation of engine data (e.g., ReactFlow nodes/edges)
- **RPC**: Remote Procedure Call via capnweb HTTP batch
- **Webhook**: Engine-initiated HTTP callback to Convex
- **Transient Event**: Short-lived event for showing operation progress in UI

### References

1. [CLAUDE.md](./CLAUDE.md) - Architecture overview
2. [2026-04-19-workflow-json-first-creation-design.md](./docs/superpowers/specs/2026-04-19-workflow-json-first-creation-design.md) - Workflow design
3. [woofx3 Engine Documentation](./docs/) - Engine-side documentation

---

**Document Version:** 1.0  
**Last Updated:** 2026-05-16  
**Author:** Prometheus (Planning Agent)  
**Status:** Draft - Ready for Implementation Planning