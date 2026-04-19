# JSON-First Workflow CRUD

**Status:** Design — pending implementation plan
**Date:** 2026-04-19
**Scope:** Full CRUD of workflows across the woofx3 engine, the Convex backend in this repo, and the browser UI. Implementation crosses repositories.

## Problem

Creating a workflow in the UI today is broken end-to-end:

- `client/src/components/workflows/basic-editor.tsx` builds ReactFlow `{ nodes, edges }` from presets and POSTs them to a legacy `/api/workflows` REST endpoint that does not exist on the Convex backend.
- `convex/workflows.ts` stores those ReactFlow nodes verbatim in the `workflows` table and the `syncToEngine` action forwards them to the engine as `steps`, which the engine treats as an opaque blob (`_steps` in workflow variables) — no actual execution graph is registered.
- The engine's canonical workflow schema (`woofx3/docs/workflow/schema.md`) is `{ id, name, description?, trigger, tasks[], options? }` — a DAG defined by `dependsOn` / `onTrue` / `onFalse`, completely independent of any visual layout. Nothing in the current create flow produces this shape.
- The visual `client/src/pages/workflow-builder.tsx` is a stub with hard-coded initial nodes; "Save" is not wired to Convex.
- There is no engine → UI webhook for workflow lifecycle events (`api/webhooks.ts` only defines `MODULE_*` events), so Convex cannot reactively reflect workflow state from the engine.

## Goal

Make the canonical `WorkflowDefinition` JSON the single source of truth for a workflow's execution. ReactFlow nodes and edges become a visual projection of that JSON, derived in the browser. Every CRUD operation round-trips through the engine so the engine remains the authority for what gets executed.

Users should be able to click "Create Workflow" in the basic editor (or Save in the visual builder) and end up on a workflow page whose canvas was rendered from JSON that the engine has actually registered. A "Preview JSON" affordance lets the user inspect what is being sent.

## Non-goals

- Persisting manual node positions across sessions. Drags are ephemeral; auto-layout runs on every render. (Option revisited in a follow-up if users complain.)
- Reconciliation of engine-created-but-webhook-lost workflows. Addressed by a future spec.
- Backwards compatibility with existing `workflows` rows. The database will be wiped as part of the migration (user-confirmed).

## Principles

1. **JSON in, JSON out.** The engine accepts and emits canonical `WorkflowDefinition` JSON. Nothing downstream of the engine ever needs to parse ReactFlow shapes.
2. **Browser owns derivation.** The JSON → `{ nodes, edges }` function lives in the UI. Convex stores the result of that function as a cache but does not duplicate the logic.
3. **Engine is the authority for identity.** The engine mints `engineWorkflowId` on create and emits it in a webhook. Convex rows are keyed on it.
4. **Correlation-based confirmation.** Create / update / delete actions block on the matching webhook (via a correlation key) before returning, so the UI only navigates once state is consistent.
5. **Idempotent webhooks.** Every webhook handler is safe to re-run; duplicate deliveries are no-ops.

## Architecture

```
UI (owns definition in memory)
  │
  │  ① send WorkflowDefinition JSON
  ▼
Convex action (generates correlationKey, proxies to engine, polls for webhook completion)
  │
  │  ② capnweb RPC → engine
  ▼
Engine (validates, persists, mints id, emits webhook)
  │
  │  ③ workflow.created webhook with full definition + correlationKey
  ▼
Convex webhook handler (upserts workflows row by engineWorkflowId)
  │
  │  ④ reactive query → UI
  ▼
UI (derives nodes/edges from definition; pushes projection back to Convex for caching)
  │
  │  ⑤ workflows.updateProjection mutation (async, non-blocking)
  ▼
Convex (stores UI-computed nodes/edges as cache for list views)
```

### Ownership

| Layer | Owns |
|---|---|
| Engine | Workflow execution, `engineWorkflowId` generation, authoritative definition storage, webhook emission |
| Convex | Multi-tenant routing, definition cache, projection cache, correlation wait, access control |
| UI | JSON editing in memory, JSON → `{ nodes, edges }` derivation, "Preview JSON" rendering |

## Schema changes

### Engine RPC (`woofx3/shared/clients/typescript/api/api.ts`)

Legacy `steps[]` and flat `trigger` fields are removed. The new signatures take the canonical definition:

```ts
interface CreateWorkflowInput {
  accountId: string;
  definition: Omit<WorkflowDefinition, "id">;
  correlationKey?: string;
}

interface UpdateWorkflowInput {
  definition: WorkflowDefinition;
  correlationKey?: string;
}

createWorkflow(input: CreateWorkflowInput): Promise<{ id: string; definition: WorkflowDefinition; isEnabled: boolean }>;
updateWorkflow(id: string, input: UpdateWorkflowInput): Promise<{ id: string; definition: WorkflowDefinition; isEnabled: boolean }>;
deleteWorkflow(id: string, correlationKey?: string): Promise<boolean>;

setWorkflowEnabled(
  id: string,
  isEnabled: boolean,
  correlationKey?: string,
): Promise<{ id: string; isEnabled: boolean }>;
```

`setWorkflowEnabled` is a separate RPC because enable state is deployment state, not definition state. Toggling enabled does not require re-sending the definition; the engine emits a `workflow.updated` webhook so Convex can refresh the `isEnabled` column.

Engine-side validation rejects malformed definitions with a structured error (invalid `eventType`, unknown action, bad operator, unknown `dependsOn` references, etc.) before persisting.

### Engine webhooks (`woofx3/shared/clients/typescript/api/webhooks.ts`)

New event type constants:

```ts
WORKFLOW_CREATED: "workflow.created",
WORKFLOW_UPDATED: "workflow.updated",
WORKFLOW_DELETED: "workflow.deleted",
```

Payloads:

```ts
interface WorkflowCreatedEvent {
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
}

interface WorkflowUpdatedEvent { /* identical shape */ }

interface WorkflowDeletedEvent {
  type: "workflow.deleted";
  correlationKey?: string;
  applicationId: string;
  workflowId: string;
}
```

Emission rule: webhook is POSTed after the engine's database write commits. The engine echoes any `correlationKey` provided in the triggering RPC.

### Shared types (`@woofx3/api`)

`WorkflowDefinition` is added as an exported type mirroring `woofx3/docs/workflow/schema.md`. Both the engine and this repo's Convex / UI code import from the same source.

### Convex `workflows` table

```ts
workflows: defineTable({
  instanceId: v.id("instances"),
  applicationId: v.string(),
  engineWorkflowId: v.string(),
  definition: v.any(),
  isEnabled: v.boolean(),
  nodes: v.optional(v.array(v.any())),
  edges: v.optional(v.array(v.any())),
  projectionUpdatedAt: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_instance", ["instanceId"])
  .index("by_engine_id", ["instanceId", "engineWorkflowId"]);
```

Dropped columns: `name`, `description` — read from `definition.name` / `definition.description` at query time.

`isEnabled` is retained as a top-level column because it is **deployment state**, not part of the canonical `WorkflowDefinition` (the schema at `woofx3/docs/workflow/schema.md` has no enable flag). The webhook payload carries `workflow.isEnabled` alongside `workflow.definition`; the webhook handler writes both.

### New Convex tables for correlation

```ts
pendingWorkflowOperations: defineTable({
  correlationKey: v.string(),
  instanceId: v.id("instances"),
  op: v.union(v.literal("create"), v.literal("update"), v.literal("delete")),
  expiresAt: v.number(),
}).index("by_correlation", ["correlationKey"]);

completedWorkflowOperations: defineTable({
  correlationKey: v.string(),
  engineWorkflowId: v.string(),
  op: v.union(v.literal("create"), v.literal("update"), v.literal("delete")),
  completedAt: v.number(),
}).index("by_correlation", ["correlationKey"]);
```

A cron sweeps expired `pendingWorkflowOperations` rows. `completedWorkflowOperations` is short-lived (cleared after the action reads it, or by a similar cron).

## Create flow

**UI**

1. Builder holds an in-memory `definition: Omit<WorkflowDefinition, "id">`.
2. User clicks Save. UI calls `convex.workflows.createFromDefinition({ instanceId, definition })`.
3. While the action is in flight, the Save button is disabled and the builder shows a "creating…" state. No navigation yet.

**Convex action `workflows.createFromDefinition`**

```
args: { instanceId, definition }

1. Authenticate the caller, verify instance membership.
2. Load the instance (applicationId, clientId, clientSecret).
3. Generate correlationKey = crypto.randomUUID().
4. Insert pendingWorkflowOperations row { correlationKey, op: "create", instanceId, expiresAt: now + 10_000 }.
5. Call rpc.createWorkflow({ accountId: applicationId, definition, correlationKey }).
6. Receive { id, definition } synchronously from the engine.
7. Poll completedWorkflowOperations by correlationKey every 250ms for up to 10s.
   - On row found: delete it, return { engineWorkflowId: row.engineWorkflowId }.
   - On timeout: throw EngineConfirmTimeout.
```

**Engine** receives `createWorkflow`, validates, persists, mints `id`, returns `{ id, definition }` synchronously, then asynchronously POSTs `workflow.created` with the echoed `correlationKey`.

**Convex webhook handler** (extends `/api/webhooks/woofx3` in `convex/http.ts`)

```
On event.type === "workflow.created":
  1. Upsert workflows row by (instanceId, engineWorkflowId):
     { instanceId, applicationId, engineWorkflowId: event.workflow.id,
       definition: event.workflow.definition,
       isEnabled: event.workflow.isEnabled,
       createdAt: now, updatedAt: now }
  2. If event.correlationKey is present:
     a. Delete the matching pendingWorkflowOperations row.
     b. Insert completedWorkflowOperations { correlationKey, engineWorkflowId, op: "create", completedAt: now }.
```

**UI after action resolves**

4. Action returns `{ engineWorkflowId }`. UI navigates to `/workflows/:engineWorkflowId`.
5. Builder subscribes to `workflows.getByEngineId({ instanceId, engineWorkflowId })`, reads `definition`.
6. Builder calls `definitionToReactFlow(definition)` client-side, renders the canvas.
7. Fire-and-forget: UI calls `workflows.updateProjection({ engineWorkflowId, nodes, edges })` to cache the projection.

## Update flow

Identical skeleton to create:

- Builder edits mutate the in-memory `definition` directly (drag to add a task = append to `tasks[]`; connect two nodes = set `dependsOn` on the target; change condition branch = update `onTrue` / `onFalse`). Nodes/edges re-derive on every edit for rendering; Convex is not written.
- Save → `workflows.updateFromDefinition` action with `{ engineWorkflowId, definition }` → `rpc.updateWorkflow(engineWorkflowId, { definition, correlationKey })` → engine emits `workflow.updated` → Convex webhook upserts `definition` on the existing row → UI reactive subscription re-renders → UI pushes new projection via `updateProjection`.
- Correlation and 10s timeout identical to create.

## Delete flow

- UI calls `workflows.deleteByEngineId({ engineWorkflowId })`.
- Action inserts a pending row with `op: "delete"`, calls `rpc.deleteWorkflow(id, correlationKey)`.
- Engine deletes the workflow, emits `workflow.deleted`.
- Webhook handler deletes the Convex `workflows` row by `(instanceId, engineWorkflowId)`; missing row is a no-op.
- Action waits for `completedWorkflowOperations`, returns success on resolution.

## Projection (nodes/edges) derivation

New module: `client/src/lib/workflow-projection.ts`.

```ts
function definitionToReactFlow(def: WorkflowDefinition): { nodes: Node[]; edges: Edge[] }
```

### Rules

- **Trigger node**: `id = "__trigger"`, `type = "trigger"`, `data = { eventType: def.trigger.eventType, conditions: def.trigger.conditions }`.
- **Task node**: one per `def.tasks[i]`, `id = task.id`, `type = task.type` (`action` | `condition` | `wait` | `workflow` | `log`), `data = { parameters, conditions, wait, workflow }` populated from the task.
- **Dependency edges**: for each `task.dependsOn[i]`, emit edge `{ id: "${parent}->${task.id}", source: parent, target: task.id }`. Tasks with no `dependsOn` and not referenced by `onTrue` / `onFalse` get an edge from `__trigger`.
- **Branch edges**: a `condition` task's `onTrue` / `onFalse` each emit edges with `data: { branch: "true" | "false" }` from the condition node to each listed target. Rendered visually distinct (green / red handle).
- **Layout**: run dagre (left-to-right) on the resulting graph; write positions into each node. Deterministic.

### Mapping presets to canonical JSON

The basic-editor emits canonical JSON via a replacement for the existing `generateWorkflowFromPresets` / `generateMultiTierWorkflow` helpers.

**Simple trigger → action:**

```json
{
  "name": "Cheer → Send Message",
  "description": "When a cheer is received, send a chat message.",
  "trigger": {
    "type": "event",
    "eventType": "<triggerPreset.event>",
    "conditions": []
  },
  "tasks": [
    {
      "id": "action-1",
      "type": "action",
      "parameters": {
        "action": "<actionPreset.slug>",
        ...actionConfig
      }
    }
  ]
}
```

Trigger-level filters (from `triggerConfig`) are lowered to `trigger.conditions[]`.

**Tiered trigger (variants):**

Each tier becomes a `condition` task (checking `${trigger.data.amount}`) plus an `action` task on the `onTrue` branch. Tiers are independent — they all start from `__trigger` and their conditions are mutually exclusive at authoring time.

```json
{
  "trigger": { "type": "event", "eventType": "cheer.user.twitch" },
  "tasks": [
    { "id": "tier-1-check", "type": "condition",
      "conditions": [{ "field": "${trigger.data.amount}", "operator": "between", "value": [100, 500] }],
      "onTrue": ["tier-1-action"] },
    { "id": "tier-1-action", "type": "action",
      "dependsOn": ["tier-1-check"],
      "parameters": { "action": "sendChatMessage", "message": "..." } },
    { "id": "tier-2-check", ... },
    { "id": "tier-2-action", ... }
  ]
}
```

Exact parameter shape per action preset is resolved by reading the preset's `configFields` catalog entry and flattening form values into `parameters`.

## Preview JSON

- `workflow-builder.tsx` toolbar gets a "Preview JSON" button next to Save. Opens a Sheet rendering `JSON.stringify(definition, null, 2)` in a monospace block with a "Copy" button. Read-only in v1.
- `basic-editor.tsx` shows a collapsible "Preview generated JSON" section on the final step (before "Create Workflow") so the user can confirm what will be sent.

## Error handling (per Q9 decision)

- Create / update / delete actions have a **10s timeout** polling `completedWorkflowOperations`. On timeout, throw `EngineConfirmTimeout`; UI toasts `"Engine did not confirm the change; it may still have applied. Refresh to check."` The builder keeps the in-memory definition so the user can retry or edit.
- Engine RPC errors (validation, not-found, unreachable) surface as typed errors from the action: `EngineValidationError`, `EngineNotFoundError`, `EngineUnreachableError`. UI shows field-aware messages when the validation error carries a pointer.
- All webhook writes are idempotent by `(instanceId, engineWorkflowId)` plus event type. Duplicate deliveries safely no-op.
- Reconciliation is explicitly deferred to a follow-up spec.

## URL structure

- List: `/workflows`
- Builder: `/workflows/:engineWorkflowId` — human-readable, matches engine IDs, stable across sessions.
- Creation flow does not navigate until the create action returns, so the URL always has a real `engineWorkflowId`.

## Migration

Existing `workflows` rows are wiped as part of the database reset (user-confirmed). No rebuild path is implemented. The deprecated `syncToEngine` action, the legacy `steps[]` / `trigger` flat fields on `CreateWorkflowInput`, and the legacy `/api/workflows` REST endpoint code paths are all removed in the same change.

## Testing

- **Engine (woofx3 repo)**: unit tests for `WorkflowDefinition` validation. Integration test that `createWorkflow` → webhook emission delivers the full definition with the correct `correlationKey`.
- **Convex**: unit tests for the webhook handler covering idempotency (duplicate `workflow.created` events) and correlation resolution. Action-level test that `createFromDefinition` times out correctly when no webhook arrives within 10s.
- **UI**: pure-function tests on `definitionToReactFlow` covering trigger-only, linear chain, condition branches, and tiered flows — assertions on exact node IDs, edge sets, and deterministic layout ordering. Component tests that the basic editor produces the expected canonical JSON for each preset/tier scenario.
- **End-to-end**: Playwright test clicks "Create Workflow" in the basic editor, waits for the builder page, confirms the canvas has the expected nodes and that the stored `workflows` row contains the expected `definition`.

## Implementation split

Implementation will need at least three PRs, in dependency order:

1. **woofx3 engine PR** — `WorkflowDefinition` types in `@woofx3/api`; update `createWorkflow` / `updateWorkflow` RPCs; add `WORKFLOW_*` webhook events and emission hooks; validation.
2. **woofx3-ui Convex PR** — updated `workflows` schema; new `workflows.createFromDefinition` / `updateFromDefinition` / `deleteByEngineId` / `updateProjection` / `getByEngineId` functions; new `pendingWorkflowOperations` + `completedWorkflowOperations` tables + expiry cron; extended `/api/webhooks/woofx3` handler for `workflow.*` events.
3. **woofx3-ui UI PR** — `workflow-projection.ts`; rewrite `basic-editor.tsx` to emit canonical JSON and call the new Convex action; rewrite `workflow-builder.tsx` to treat `definition` as the state of record and derive nodes/edges on every render; "Preview JSON" affordances; Playwright tests.

Each PR is deployable on its own: (1) adds capability without consumers; (2) adds Convex endpoints that depend on (1); (3) switches the UI to the new flow once (2) is live.
