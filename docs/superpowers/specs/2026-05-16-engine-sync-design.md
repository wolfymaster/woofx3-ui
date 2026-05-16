# Engine Sync: Periodic Reconciliation of Convex Mirror with Engine State

**Status:** Draft
**Date:** 2026-05-16
**Area:** `convex/engineSync*`, `client/src/components/settings/engine-sync-card.tsx`, `convex/schema.ts`, `convex/crons.ts`

## Summary

Add a periodic, activity-gated reconciliation job that keeps Convex's mirror of engine-owned entities (commands, modules, workflows, scenes, assets) in sync with the actual engine state. Surface this on the Engine settings tab with last/next sync timestamps and a **Sync now** button that shows live progress.

Goals:

1. Self-healing — even if a webhook is dropped (engine offline, network blip, deploy), the next sync brings Convex back to parity.
2. Low-load — only active accounts are synced, and not all at once. A sweep cron checks per-instance `nextEligibleAt` and processes a bounded batch each tick.
3. Encapsulated — sync logic lives in pluggable "step" units; thresholds and intervals live in one config module.
4. Observable — users see `lastSyncedAt`, `nextEligibleAt`, last error, and live step-by-step progress during a manual sync.

## Motivation

Today, every engine→Convex data flow depends on individual webhook callbacks (`workflow.created`, `module.installed`, `scene.updated`, etc.) succeeding. If the engine restarts, the webhook URL is briefly unreachable, or the engine emits an event that Convex's HTTP handler can't process, the Convex mirror drifts from the engine's actual state. Today the only recovery is manual data fixing or restarting the engine to re-emit events — neither is acceptable.

The engine already exposes the building blocks we need:

- `listCommands(): CommandSnapshot[]` — full snapshot, purpose-built for reconciliation.
- `listEngineModules(): EngineModuleSummary[]` — full snapshot of installed modules.
- `getWorkflows(query)`, `getScenes(query)`, `getAssets(query)` — paginated reads we can iterate to assemble a full snapshot.

What's missing is the orchestration layer: a Convex job that drives these reads, reconciles into our tables, and is scheduled responsibly across all tenants.

A previously-orphaned `instanceSync` table already exists in the live Convex deployment with a shape close to what we want (`lastSyncedAt`, `nextEligibleAt`, `status`, `lastError`, `consecutiveErrorCount`, `lastDurationMs`). It is not declared in `schema.ts` and has no code referencing it. This spec adopts and formalizes it.

## Non-Goals

- Engine-side changes. We use only methods the engine exposes today; no new RPCs are added in the engine repo.
- Two-way sync. This is engine → Convex only. Convex → engine writes continue through existing per-mutation paths (correlation-key webhook echoes).
- Cross-instance sync. Each instance syncs independently. There is no aggregate-tenant sync.
- Authoritative state migration. The engine remains source of truth for the entities listed above; Convex is a queryable mirror.
- Realtime guarantees. Sync runs on an 8-hour cadence by default; webhooks remain the realtime path. Sync only fills the gap when webhooks miss.
- Twitch platform-data sync (followers, subs, emotes). The engine does not expose these and this spec does not add them.

## Current State

### Engine settings page

`client/src/pages/settings.tsx` renders `EngineSettingsTab()` (lines 54–239) with two cards:

1. **Engine Configuration** — URL input, Save URL, Test Connection buttons.
2. **Registration Status** — green/yellow dot showing registration state.

No sync UI today. The Sync card will sit between these two.

### Convex schema

`convex/schema.ts` (571 lines) declares 30+ tables but does **not** declare `instanceSync`. The deployment has the table with this shape (inferred from `bunx convex data instanceSync`):

```
instanceId           Id<"instances">
lastSyncedAt         number
nextEligibleAt       number
status               "success" | "error"
lastError            string
lastDurationMs       number
consecutiveErrorCount number
```

Three rows exist, all stale (consecutive errors against dead Cloudflare tunnels). No code references the table. We will declare it formally and drop the existing rows before redeploying.

### Engine snapshot methods (confirmed)

| Entity | Method | Signature | Style |
|---|---|---|---|
| Commands | `listCommands()` | `Promise<CommandSnapshot[]>` | Full snapshot |
| Modules | `listEngineModules()` | `Promise<EngineModuleSummary[]>` | Full snapshot |
| Workflows | `getWorkflows(query)` | `Promise<PaginatedWorkflows>` | Paginated (default 20) |
| Scenes | `getScenes(query)` | `Promise<PaginatedScenes>` | Paginated (default 10) |
| Assets | `getAssets(query)` | `Promise<PaginatedAssets>` | Paginated (default 12) |

Defined in `/home/wolfy/code/wolfymaster/woofx3/shared/clients/typescript/api/api.ts`, available to Convex via `@woofx3/api`.

### Activity signal

`instances.lastEngineActivityAt` (optional `number`) is already on the `instances` table. We adopt it as the "account is active" signal — if a user-driven dashboard action or engine webhook has touched this field within `inactivityThresholdMs`, the instance is eligible for periodic sync.

## Design

### Data model

**Declare existing `instanceSync` in `schema.ts` with the following final shape (all fields required, dropping the 3 orphan rows during deploy):**

```ts
instanceSync: defineTable({
  instanceId: v.id("instances"),
  lastSyncedAt: v.number(),                         // 0 = never synced
  nextEligibleAt: v.number(),                       // sweep eligibility key
  status: v.union(
    v.literal("idle"),                              // initial; never synced
    v.literal("running"),                           // sync in progress
    v.literal("success"),
    v.literal("error"),
  ),
  lastError: v.string(),                            // "" when no error
  lastDurationMs: v.number(),                       // 0 if never run
  consecutiveErrorCount: v.number(),
  syncIntervalMs: v.number(),                       // per-instance frequency override
})
  .index("by_instance", ["instanceId"])
  .index("by_next_eligible", ["nextEligibleAt"]),
```

**New table `syncRuns`** — append-only audit and live-progress feed:

```ts
syncRuns: defineTable({
  instanceId: v.id("instances"),
  trigger: v.union(v.literal("scheduled"), v.literal("manual")),
  status: v.union(
    v.literal("running"),
    v.literal("success"),
    v.literal("error"),
  ),
  startedAt: v.number(),
  completedAt: v.optional(v.number()),
  steps: v.array(
    v.object({
      name: v.union(
        v.literal("commands"),
        v.literal("modules"),
        v.literal("workflows"),
        v.literal("scenes"),
        v.literal("assets"),
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
})
  .index("by_instance_recent", ["instanceId", "startedAt"]),
```

**No changes to other tables.** `instances.lastEngineActivityAt` is reused as the activity signal.

### Module layout

```
convex/
  engineSync.ts                    # Public actions: syncNow, internalApi: runSync, sweep
  engineSyncInternal.ts            # Internal queries/mutations: state CRUD, run lifecycle
  lib/engineSync/
    config.ts                      # All thresholds and intervals
    steps.ts                       # SyncStep interface + ordered list
    steps/
      commands.ts                  # Reconcile chatCommands from listCommands()
      modules.ts                   # Reconcile instanceModules from listEngineModules()
      workflows.ts                 # Reconcile workflows from paginated getWorkflows()
      scenes.ts                    # Reconcile scenes from paginated getScenes()
      assets.ts                    # Reconcile assets from paginated getAssets()
client/src/components/settings/
  engine-sync-card.tsx             # New card; rendered in settings.tsx between existing two
```

### Configuration — single source of truth

```ts
// convex/lib/engineSync/config.ts
export const ENGINE_SYNC_CONFIG = {
  sweepIntervalMinutes: 5,                          // cron tick
  defaultSyncIntervalMs: 8 * 60 * 60 * 1000,        // 8h between scheduled syncs
  inactivityThresholdMs: 24 * 60 * 60 * 1000,       // gate: skip if no activity within this window
  sweepBatchSize: 10,                               // max instances per tick
  jitterMs: 5 * 60 * 1000,                          // ± randomization on nextEligibleAt
  pageSize: 100,                                    // for paginated engine reads
  maxConsecutiveErrors: 10,                         // beyond this, back off harder
  backoffMultiplier: 2,                             // exponential after error
  maxBackoffMs: 24 * 60 * 60 * 1000,                // cap backoff at 24h
  runHistoryRetentionDays: 14,                      // for syncRuns cleanup
} as const;
```

### Sync step interface

Every entity reconciler implements one interface so adding a new entity is a one-file change:

```ts
// convex/lib/engineSync/steps.ts
import type { ActionCtx } from "../../_generated/server";
import type { Id } from "../../_generated/dataModel";
import type { EngineApi } from "../engineInstanceUrl";

export interface SyncStepContext {
  ctx: ActionCtx;
  api: EngineApi;
  instanceId: Id<"instances">;
  applicationId: string;
}

export interface SyncStep {
  name: "commands" | "modules" | "workflows" | "scenes" | "assets";
  run(c: SyncStepContext): Promise<{ itemsProcessed: number }>;
}

export const SYNC_STEPS: readonly SyncStep[] = [
  commandsStep,
  modulesStep,
  workflowsStep,
  scenesStep,
  assetsStep,
];
```

Each step is responsible for:

1. Calling the appropriate engine RPC (single snapshot or paginated loop).
2. Reconciling into its Convex table by stable engine ID:
   - **Upsert** rows where the engine ID matches.
   - **Delete** local rows whose engine ID no longer appears in the snapshot.
3. Returning `{ itemsProcessed }` so the run record can show progress.

Reconciliation is **idempotent** — running the same step twice yields the same Convex state.

### Run orchestration

```
internal.engineSync.runSync({ instanceId, trigger })
├─ start run
│   ├─ insert syncRuns row (status="running", steps prepopulated as "pending")
│   ├─ patch instanceSync (status="running", lastError="")
├─ create capnweb session, authenticate
├─ for each step in SYNC_STEPS:
│   ├─ patch syncRuns step (status="running", startedAt=now)
│   ├─ await step.run(...)
│   ├─ patch syncRuns step (status="success"|"error", itemsProcessed, completedAt=now)
│   └─ if error: capture, continue (best-effort) or abort (configurable; default: abort)
├─ finalize
│   ├─ patch syncRuns (status, completedAt, error)
│   └─ patch instanceSync:
│         status="success" or "error"
│         lastSyncedAt = now
│         lastDurationMs = now - startedAt
│         consecutiveErrorCount = (error ? prev+1 : 0)
│         nextEligibleAt = computeNextEligibleAt(...)
│         lastError = error || ""
```

`computeNextEligibleAt`:

```
on success: now + syncIntervalMs ± jitter
on error:   now + min(syncIntervalMs * backoffMultiplier^consecutiveErrorCount, maxBackoffMs) ± jitter
```

The jitter prevents two instances that synced at the same time from re-aligning.

### Sweep orchestration

```
internal.engineSync.sweep()  [cron every sweepIntervalMinutes]
├─ q1: instanceSync where nextEligibleAt <= now AND status != "running"
│       order by nextEligibleAt asc
│       take sweepBatchSize
├─ for each candidate:
│   ├─ join: instance.lastEngineActivityAt
│   ├─ gate: skip if (now - lastEngineActivityAt) > inactivityThresholdMs
│   │       (also push out nextEligibleAt by inactivityThresholdMs so we re-check later)
│   └─ schedule internal.engineSync.runSync({ instanceId, trigger: "scheduled" })
│       via ctx.scheduler.runAfter(0, ...)
```

Sweep is small and fast — it never calls the engine; it only queues runs. Each queued `runSync` action then proceeds independently and in parallel.

### Initial state — when is the row created?

A `instanceSync` row is created **lazily on first sync attempt**. The flow:

1. User registers an instance → `instances` row created, no `instanceSync` row yet.
2. Sweep runs — it would miss this instance because no `instanceSync` row exists.

To handle this, we add a secondary sweep query: find instances **without** a corresponding `instanceSync` row and create one with:

- `lastSyncedAt: 0`
- `nextEligibleAt: now` (eligible immediately)
- `status: "idle"`
- `syncIntervalMs: ENGINE_SYNC_CONFIG.defaultSyncIntervalMs`
- everything else zero/empty

This single secondary query (limited to the same `sweepBatchSize`) keeps sweep self-contained. Alternatively, we register a `instanceSync` row inside the existing `registration.ts` flow as part of instance creation; the spec leaves both paths open for the implementation plan to choose.

### Public surface (Convex)

```ts
// convex/engineSync.ts (public)
export const syncNow = action({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, { instanceId }) => {
    // authz: caller must have access to the instance's account
    // schedule internal.engineSync.runSync immediately with trigger="manual"
    // return { runId } so the UI can subscribe to live progress
  },
});

export const getSyncState = query({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, { instanceId }) => {
    // authz
    // return { syncState, currentRun, recentRuns }
  },
});
```

`internal.engineSync.runSync` and `internal.engineSync.sweep` are not exposed.

### Cron

```ts
// convex/crons.ts (additive)
crons.interval(
  "engine sync sweep",
  { minutes: ENGINE_SYNC_CONFIG.sweepIntervalMinutes },
  internal.engineSync.sweep,
);

crons.interval(
  "engine sync run history cleanup",
  { hours: 24 },
  internal.engineSyncInternal.cleanupOldRuns,
);
```

### UI: Engine Sync Card

New component `client/src/components/settings/engine-sync-card.tsx`, rendered in `EngineSettingsTab` between the existing Engine Configuration card and Registration Status card.

Layout (informal):

```
┌── Engine Sync ────────────────────────────────────────────┐
│  Last synced: 2 hours ago    Next sync: in 6 hours        │
│  Status: ● Success           Items: 142 across 5 steps    │
│                                                           │
│  [ Sync now ]                                             │
│                                                           │
│  ── (when a run is in progress) ─────────────────────     │
│  Running... 3 of 5 steps                                  │
│  ✓ commands (12)   ✓ modules (4)   ⟳ workflows (...)      │
│   · scenes          · assets                              │
│                                                           │
│  ── (when last run errored) ─────────────────────────     │
│  ⚠ Last sync failed: <message>                            │
│  Will retry automatically in ~30 min.                     │
└───────────────────────────────────────────────────────────┘
```

Data flow:

- `api.engineSync.getSyncState({ instanceId })` — single reactive query feeds the whole card.
- `api.engineSync.syncNow({ instanceId })` — action; UI is optimistic-ish: clicking flips status to "Starting…" instantly via the next reactive update.
- Live progress is reactive automatically — the running `syncRuns` row updates as each step completes; the card re-renders.

### Error handling

| Failure mode | Behavior |
|---|---|
| Engine unreachable / capnweb auth fails | Whole run marked `error`. `consecutiveErrorCount` increments. Backoff applied to `nextEligibleAt`. |
| One step throws | Step marked `error`; remaining steps still run (best-effort). Run marked `error` overall iff any step errored. (Default: continue. Toggle in config later if needed.) |
| Engine returns malformed data | Step catches its own parse/validation errors and reports them. No throw escapes the step boundary. |
| Convex mutation race during reconcile | Idempotent upserts. If two reconciles race, last-write-wins, no duplicates (keyed by `engineWorkflowId`, `engineCommandId`, etc.). |
| `lastEngineActivityAt` stale | Instance is gated out. `nextEligibleAt` pushed forward by `inactivityThresholdMs` so we check again later. |
| `consecutiveErrorCount > maxConsecutiveErrors` | Run still scheduled, but `nextEligibleAt` capped at `maxBackoffMs`. UI shows persistent error banner. |

No PagerDuty-style alerting in v1; persistent errors are visible only in the Sync card itself.

### Testing

- Unit-test each sync step in isolation by stubbing the engine RPC and asserting the Convex mutations issued.
- Integration test the orchestrator with a fake engine that returns canned snapshots; assert run lifecycle (status transitions, error counts, backoff math).
- Manual smoke test against a real engine instance in the worktree before merging.

## Risks & Open Questions

- **Reconcile deletes.** A step that deletes "missing" Convex rows is destructive. If the engine returns an empty/partial snapshot due to a transient bug, we could wipe legitimate data. Mitigation: each step asserts the snapshot is sane (e.g., paginated fetch's `total` matches the assembled list size) before issuing deletes; abort the step on mismatch.
- **Paginated reads are not atomic.** For workflows/scenes/assets, mutations during the iteration could cause rows to appear twice or be missed. Mitigation: idempotent upserts handle duplicates; for misses, the next sync catches them.
- **`lastEngineActivityAt` accuracy.** If nothing currently updates this field, the activity gate will always skip every instance. The implementation plan must verify which code paths touch it today and add touchpoints as needed (e.g., on user login, on webhook receipt, on dashboard render).
- **Manual override interacting with `status="running"`.** If a sync is already running and the user clicks Sync now, we ignore the click and let the running sync continue. The button is disabled while `currentRun?.status === "running"`.

## Rollout

1. Land the schema change and drop the 3 orphan `instanceSync` rows.
2. Ship config, step interface, and the five steps behind no UI — they're inert until the cron is registered.
3. Register the cron with `sweepBatchSize: 1` initially for safety; bump to 10 after observing one cycle in production.
4. Ship the Sync card.
5. Verify `lastEngineActivityAt` is being updated by real user/engine activity; add touchpoints if not.
