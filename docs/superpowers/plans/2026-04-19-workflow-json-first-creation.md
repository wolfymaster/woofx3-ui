# JSON-First Workflow CRUD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make canonical `WorkflowDefinition` JSON the single source of truth for workflow execution across the engine, Convex, and UI. ReactFlow nodes/edges become a projection derived in the browser.

**Architecture:** Three-layer round-trip. UI builds JSON → Convex action proxies to engine and blocks on a correlation webhook → engine mints `engineWorkflowId`, validates, persists, emits `workflow.*` webhook → Convex upserts row → UI reactive subscription renders → UI pushes derived nodes/edges back as a projection cache. Every CRUD op follows the same skeleton.

**Tech Stack:** TypeScript. Engine side: woofx3 Bun/Node service, capnweb RPC, NATS, `@woofx3/api` shared package, Biome. Convex side: `@convex-dev/auth`, Convex cron, capnweb HTTP batch. UI side: React 18 + ReactFlow + dagre, wouter, TanStack Query, Shadcn.

**Spec:** `docs/superpowers/specs/2026-04-19-workflow-json-first-creation-design.md` — keep open during implementation.

**Repos touched:**
- `~/code/wolfymaster/woofx3` (engine)
- `~/code/wolfymaster/woofx3-ui` (Convex + UI, this repo)

**Split into three parts / three PRs** in dependency order. Each part ends with `VERIFY` + `COMMIT` gates. Do not start Part B until Part A is merged; do not start Part C until Part B is merged.

**Conventions:**
- `bun`/`bunx`, never `npm`/`npx`.
- Biome: 2-space indent, double quotes, semicolons, braces on every branch.
- No `Co-Authored-By` trailers.
- After each task's green tests, run `bun run check` (or the engine's equivalent) to catch typos.

---

## Part A — Engine changes (woofx3 repo)

Work in `~/code/wolfymaster/woofx3`. Branch: `feat/workflow-json-first`.

### Task A1: Canonical `WorkflowDefinition` type in `@woofx3/api`

**Files:**
- Create: `shared/clients/typescript/api/workflow-definition.ts`
- Modify: `shared/clients/typescript/api/index.ts` (add export)

- [ ] **Step 1: Write the type**

```ts
// shared/clients/typescript/api/workflow-definition.ts

/**
 * Canonical workflow JSON schema — source of truth for workflow execution
 * definition. Mirrors woofx3/docs/workflow/schema.md. No UI concerns (no
 * positions, no node types) — execution only.
 */

export type Duration = string | number; // e.g. "30s" or raw nanoseconds

export type ConditionOperator =
  | "eq" | "ne" | "gt" | "gte" | "lt" | "lte"
  | "contains" | "starts_with" | "ends_with"
  | "in" | "not_in" | "exists" | "not_exists"
  | "regex" | "between";

export interface ConditionConfig {
  field: string;
  operator: ConditionOperator;
  value?: unknown;
}

export interface TriggerConfig {
  type: "event";
  eventType: string;
  conditions?: ConditionConfig[];
}

export interface AggregationConfig {
  strategy: "count" | "sum" | "threshold";
  field?: string;
  threshold: number;
  timeWindow?: Duration;
}

export interface WaitConfig {
  type: "event" | "aggregation";
  eventType: string;
  conditions?: ConditionConfig[];
  aggregation?: AggregationConfig;
  timeout?: Duration;
  onTimeout?: "continue" | "fail";
}

export interface SubWorkflowConfig {
  workflowId: string;
  waitUntilCompletion?: boolean;
  eventType?: string;
  eventData?: Record<string, unknown>;
  timeout?: Duration;
}

export type TaskType = "action" | "log" | "wait" | "condition" | "workflow";

export interface TaskDefinition {
  id: string;
  type: TaskType;
  dependsOn?: string[];
  parameters?: Record<string, unknown>;
  exports?: Record<string, string>;
  onError?: "fail" | "continue";
  timeout?: Duration;

  condition?: ConditionConfig;
  conditions?: ConditionConfig[];
  conditionLogic?: "and" | "or";
  onTrue?: string[];
  onFalse?: string[];

  wait?: WaitConfig;
  workflow?: SubWorkflowConfig;
}

export interface WorkflowOptions {
  timeout?: Duration;
  maxConcurrent?: number;
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  description?: string;
  trigger: TriggerConfig;
  tasks: TaskDefinition[];
  options?: WorkflowOptions;
}
```

- [ ] **Step 2: Export from package root**

Edit `shared/clients/typescript/api/index.ts`, add:
```ts
export * from "./workflow-definition";
```

- [ ] **Step 3: Type-check**

Run: `cd shared/clients/typescript/api && bun run check` (or the repo's typecheck command — check `package.json`).
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add shared/clients/typescript/api/workflow-definition.ts shared/clients/typescript/api/index.ts
git commit -m "feat(api): add canonical WorkflowDefinition type"
```

---

### Task A2: Workflow webhook event types

**Files:**
- Modify: `shared/clients/typescript/api/webhooks.ts`

- [ ] **Step 1: Add event type constants**

In `webhooks.ts`, extend `EngineEventType`:
```ts
export const EngineEventType = {
  MODULE_INSTALLED: "module.installed",
  MODULE_INSTALL_FAILED: "module.install_failed",
  MODULE_DELETED: "module.deleted",
  MODULE_DELETE_FAILED: "module.delete_failed",
  MODULE_TRIGGER_REGISTERED: "module.trigger.registered",
  MODULE_ACTION_REGISTERED: "module.action.registered",
  WORKFLOW_CREATED: "workflow.created",
  WORKFLOW_UPDATED: "workflow.updated",
  WORKFLOW_DELETED: "workflow.deleted",
} as const;
```

- [ ] **Step 2: Add event payload interfaces**

Append to `webhooks.ts`:
```ts
import type { WorkflowDefinition } from "./workflow-definition";

export interface WorkflowSnapshot {
  id: string;
  definition: WorkflowDefinition;
  isEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowCreatedEvent {
  type: typeof EngineEventType.WORKFLOW_CREATED;
  applicationId: string;
  correlationKey?: string;
  workflow: WorkflowSnapshot;
}

export interface WorkflowUpdatedEvent {
  type: typeof EngineEventType.WORKFLOW_UPDATED;
  applicationId: string;
  correlationKey?: string;
  workflow: WorkflowSnapshot;
}

export interface WorkflowDeletedEvent {
  type: typeof EngineEventType.WORKFLOW_DELETED;
  applicationId: string;
  correlationKey?: string;
  workflowId: string;
}
```

- [ ] **Step 3: Extend `CallbackEvent` union and `CallbackEventByType` map**

```ts
export type CallbackEvent =
  | ModuleTriggerRegisteredEvent
  | ModuleActionRegisteredEvent
  | ModuleInstalledEvent
  | ModuleInstallFailedEvent
  | ModuleDeletedEvent
  | ModuleDeleteFailedEvent
  | WorkflowCreatedEvent
  | WorkflowUpdatedEvent
  | WorkflowDeletedEvent;

export type CallbackEventByType = {
  [EngineEventType.MODULE_TRIGGER_REGISTERED]: ModuleTriggerRegisteredEvent;
  [EngineEventType.MODULE_ACTION_REGISTERED]: ModuleActionRegisteredEvent;
  [EngineEventType.MODULE_INSTALLED]: ModuleInstalledEvent;
  [EngineEventType.MODULE_INSTALL_FAILED]: ModuleInstallFailedEvent;
  [EngineEventType.MODULE_DELETED]: ModuleDeletedEvent;
  [EngineEventType.MODULE_DELETE_FAILED]: ModuleDeleteFailedEvent;
  [EngineEventType.WORKFLOW_CREATED]: WorkflowCreatedEvent;
  [EngineEventType.WORKFLOW_UPDATED]: WorkflowUpdatedEvent;
  [EngineEventType.WORKFLOW_DELETED]: WorkflowDeletedEvent;
};
```

- [ ] **Step 4: Type-check & commit**

```bash
bun run check
git add shared/clients/typescript/api/webhooks.ts
git commit -m "feat(api): add workflow.* webhook event types"
```

---

### Task A3: WorkflowDefinition validator (pure function, TDD)

**Files:**
- Create: `api/src/workflow/validate-definition.ts`
- Create: `api/src/workflow/validate-definition.test.ts`

- [ ] **Step 1: Write failing tests first**

```ts
// api/src/workflow/validate-definition.test.ts
import { describe, expect, test } from "bun:test";
import { validateWorkflowDefinition } from "./validate-definition";

describe("validateWorkflowDefinition", () => {
  test("accepts a minimal valid definition", () => {
    const def = {
      id: "x",
      name: "X",
      trigger: { type: "event", eventType: "cheer.user.twitch" },
      tasks: [
        { id: "t1", type: "action", parameters: { action: "print", message: "hi" } },
      ],
    };
    expect(validateWorkflowDefinition(def)).toEqual({ ok: true, value: def });
  });

  test("rejects missing trigger", () => {
    const r = validateWorkflowDefinition({ id: "x", name: "X", tasks: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.errors[0].path).toBe("trigger"); }
  });

  test("rejects task dependsOn referencing unknown id", () => {
    const r = validateWorkflowDefinition({
      id: "x", name: "X",
      trigger: { type: "event", eventType: "e" },
      tasks: [
        { id: "t1", type: "action", dependsOn: ["ghost"], parameters: {} },
      ],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => e.path === "tasks[0].dependsOn[0]")).toBe(true);
    }
  });

  test("rejects duplicate task ids", () => {
    const r = validateWorkflowDefinition({
      id: "x", name: "X",
      trigger: { type: "event", eventType: "e" },
      tasks: [
        { id: "t1", type: "action", parameters: {} },
        { id: "t1", type: "action", parameters: {} },
      ],
    });
    expect(r.ok).toBe(false);
  });

  test("rejects condition task with onTrue referencing unknown task", () => {
    const r = validateWorkflowDefinition({
      id: "x", name: "X",
      trigger: { type: "event", eventType: "e" },
      tasks: [
        { id: "c1", type: "condition",
          conditions: [{ field: "${trigger.data.x}", operator: "eq", value: 1 }],
          onTrue: ["missing"] },
      ],
    });
    expect(r.ok).toBe(false);
  });

  test("rejects unknown operator", () => {
    const r = validateWorkflowDefinition({
      id: "x", name: "X",
      trigger: { type: "event", eventType: "e",
        conditions: [{ field: "${trigger.data.x}", operator: "like" as never, value: 1 }] },
      tasks: [{ id: "t1", type: "action", parameters: {} }],
    });
    expect(r.ok).toBe(false);
  });

  test("accepts empty trigger conditions", () => {
    const r = validateWorkflowDefinition({
      id: "x", name: "X",
      trigger: { type: "event", eventType: "e", conditions: [] },
      tasks: [{ id: "t1", type: "action", parameters: {} }],
    });
    expect(r.ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run test — expect failure**

Run: `cd api && bun test src/workflow/validate-definition.test.ts`
Expected: FAIL — `validateWorkflowDefinition` not found.

- [ ] **Step 3: Implement validator**

```ts
// api/src/workflow/validate-definition.ts
import type {
  ConditionConfig,
  ConditionOperator,
  TaskDefinition,
  WorkflowDefinition,
} from "@woofx3/api";

export interface ValidationError {
  path: string;
  message: string;
}

export type ValidationResult =
  | { ok: true; value: WorkflowDefinition }
  | { ok: false; errors: ValidationError[] };

const OPERATORS: ReadonlySet<ConditionOperator> = new Set([
  "eq", "ne", "gt", "gte", "lt", "lte",
  "contains", "starts_with", "ends_with",
  "in", "not_in", "exists", "not_exists",
  "regex", "between",
]);

const TASK_TYPES = new Set(["action", "log", "wait", "condition", "workflow"]);

function validateConditions(
  cs: ConditionConfig[] | undefined,
  prefix: string,
  errors: ValidationError[],
): void {
  if (!cs) { return; }
  cs.forEach((c, i) => {
    const base = `${prefix}[${i}]`;
    if (typeof c.field !== "string" || c.field.length === 0) {
      errors.push({ path: `${base}.field`, message: "required string" });
    }
    if (!OPERATORS.has(c.operator)) {
      errors.push({ path: `${base}.operator`, message: `unknown operator: ${String(c.operator)}` });
    }
  });
}

export function validateWorkflowDefinition(input: unknown): ValidationResult {
  const errors: ValidationError[] = [];

  if (!input || typeof input !== "object") {
    return { ok: false, errors: [{ path: "", message: "definition must be an object" }] };
  }
  const def = input as Partial<WorkflowDefinition>;

  if (typeof def.id !== "string" || def.id.length === 0) {
    errors.push({ path: "id", message: "required string" });
  }
  if (typeof def.name !== "string" || def.name.length === 0) {
    errors.push({ path: "name", message: "required string" });
  }

  if (!def.trigger || typeof def.trigger !== "object") {
    errors.push({ path: "trigger", message: "required object" });
  } else {
    if (def.trigger.type !== "event") {
      errors.push({ path: "trigger.type", message: 'must be "event"' });
    }
    if (typeof def.trigger.eventType !== "string" || def.trigger.eventType.length === 0) {
      errors.push({ path: "trigger.eventType", message: "required string" });
    }
    validateConditions(def.trigger.conditions, "trigger.conditions", errors);
  }

  if (!Array.isArray(def.tasks) || def.tasks.length === 0) {
    errors.push({ path: "tasks", message: "required non-empty array" });
  } else {
    const ids = new Set<string>();
    for (const t of def.tasks) {
      if (typeof t.id !== "string" || t.id.length === 0) { continue; }
      if (ids.has(t.id)) {
        errors.push({ path: `tasks.${t.id}`, message: "duplicate task id" });
      }
      ids.add(t.id);
    }

    def.tasks.forEach((t: TaskDefinition, i: number) => {
      const p = `tasks[${i}]`;
      if (typeof t.id !== "string" || t.id.length === 0) {
        errors.push({ path: `${p}.id`, message: "required string" });
      }
      if (!TASK_TYPES.has(t.type)) {
        errors.push({ path: `${p}.type`, message: `unknown task type: ${String(t.type)}` });
      }
      validateConditions(t.conditions, `${p}.conditions`, errors);
      if (t.condition) { validateConditions([t.condition], `${p}.condition`, errors); }

      (t.dependsOn ?? []).forEach((d, j) => {
        if (!ids.has(d)) {
          errors.push({ path: `${p}.dependsOn[${j}]`, message: `unknown task id: ${d}` });
        }
      });
      (t.onTrue ?? []).forEach((r, j) => {
        if (!ids.has(r)) {
          errors.push({ path: `${p}.onTrue[${j}]`, message: `unknown task id: ${r}` });
        }
      });
      (t.onFalse ?? []).forEach((r, j) => {
        if (!ids.has(r)) {
          errors.push({ path: `${p}.onFalse[${j}]`, message: `unknown task id: ${r}` });
        }
      });
    });
  }

  if (errors.length > 0) { return { ok: false, errors }; }
  return { ok: true, value: input as WorkflowDefinition };
}
```

- [ ] **Step 4: Run tests — expect all pass**

Run: `cd api && bun test src/workflow/validate-definition.test.ts`
Expected: PASS (7/7).

- [ ] **Step 5: Commit**

```bash
git add api/src/workflow/validate-definition.ts api/src/workflow/validate-definition.test.ts
git commit -m "feat(api): validate canonical WorkflowDefinition"
```

---

### Task A4: Switch engine `createWorkflow` / `updateWorkflow` / `deleteWorkflow` to accept `WorkflowDefinition`

**Files:**
- Modify: `api/src/api.ts:1484-1560` (createWorkflow, updateWorkflow, deleteWorkflow method bodies + signatures)
- Modify: `shared/clients/typescript/api/api.ts` (`CreateWorkflowInput`, `UpdateWorkflowInput`, `Woofx3EngineApi` method signatures)

- [ ] **Step 1: Update shared interface first**

In `shared/clients/typescript/api/api.ts`, replace `CreateWorkflowInput` and `UpdateWorkflowInput`:
```ts
import type { WorkflowDefinition } from "./workflow-definition";

export interface CreateWorkflowInput {
  accountId: string;
  definition: Omit<WorkflowDefinition, "id">;
  correlationKey?: string;
}

export interface UpdateWorkflowInput {
  definition: WorkflowDefinition;
  correlationKey?: string;
}

export interface WorkflowMutationResult {
  id: string;
  definition: WorkflowDefinition;
  isEnabled: boolean;
}
```

And change the method signatures in `Woofx3EngineApi`:
```ts
createWorkflow(data: CreateWorkflowInput): Promise<WorkflowMutationResult>;
updateWorkflow(id: string, data: UpdateWorkflowInput): Promise<WorkflowMutationResult | null>;
deleteWorkflow(id: string, correlationKey?: string): Promise<boolean>;
setWorkflowEnabled(id: string, isEnabled: boolean, correlationKey?: string): Promise<{ id: string; isEnabled: boolean }>;
```

- [ ] **Step 2: Implement server-side `createWorkflow`**

In `api/src/api.ts`, replace the `createWorkflow` method body with:
```ts
async createWorkflow(data: CreateWorkflowInput): Promise<WorkflowMutationResult> {
  const id = crypto.randomUUID();
  const defToStore: WorkflowDefinition = { id, ...data.definition };

  const result = validateWorkflowDefinition(defToStore);
  if (!result.ok) {
    throw new Error(`Invalid workflow definition: ${result.errors.map((e) => `${e.path}: ${e.message}`).join("; ")}`);
  }

  this.logger.info("Creating workflow", { id, name: defToStore.name });
  const applicationId = data.accountId || (await this.ensureApplicationId());

  const variables: Record<string, string> = {
    _definition: JSON.stringify(defToStore),
  };

  const response = await this.db.createWorkflow({
    id,
    name: defToStore.name,
    description: defToStore.description ?? "",
    applicationId,
    createdBy: "",
    enabled: false,
    steps: [],
    variables,
    onSuccess: "",
    onFailure: "",
    maxRetries: 0,
    timeoutSeconds: 0,
    createdByType: "USER",
    createdByRef: "",
  });
  if (response.status?.code !== "OK" || !response.workflow) {
    throw new Error(response.status?.message || "Failed to create workflow");
  }

  const createdId = response.workflow.id;
  const out: WorkflowMutationResult = {
    id: createdId,
    definition: defToStore,
    isEnabled: false,
  };

  // Fire-and-forget webhook. Must happen AFTER the DB commit.
  void this.emitWorkflowWebhook({
    type: EngineEventType.WORKFLOW_CREATED,
    applicationId,
    correlationKey: data.correlationKey,
    workflow: {
      id: createdId,
      definition: { ...defToStore, id: createdId },
      isEnabled: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  });

  return out;
}
```

Adjust imports at top of `api/src/api.ts`:
```ts
import type { CreateWorkflowInput, UpdateWorkflowInput, WorkflowMutationResult } from "@woofx3/api";
import type { WorkflowDefinition } from "@woofx3/api";
import { EngineEventType } from "@woofx3/api/webhooks";
import { validateWorkflowDefinition } from "./workflow/validate-definition";
```

Note: if `db.createWorkflow` rejects an `id` input parameter, remove the `id` field from that call — some codegen'd DB clients auto-generate IDs. In that case, read `response.workflow.id` and patch it into the stored definition via a follow-up `updateWorkflow` DB call, OR accept the engine-generated ID as `defToStore.id`.

- [ ] **Step 3: Implement server-side `updateWorkflow`**

```ts
async updateWorkflow(id: string, data: UpdateWorkflowInput): Promise<WorkflowMutationResult | null> {
  if (data.definition.id !== id) {
    throw new Error(`definition.id (${data.definition.id}) must match path id (${id})`);
  }
  const result = validateWorkflowDefinition(data.definition);
  if (!result.ok) {
    throw new Error(`Invalid workflow definition: ${result.errors.map((e) => `${e.path}: ${e.message}`).join("; ")}`);
  }

  const existing = await this.db.getWorkflow({ id });
  if (existing.status?.code !== "OK" || !existing.workflow) {
    this.logger.warn("Workflow not found for update", { id });
    return null;
  }

  const variables: Record<string, string> = {
    ...(existing.workflow.variables ?? {}),
    _definition: JSON.stringify(data.definition),
  };
  delete variables._steps;
  delete variables._trigger;
  delete variables._nodes;
  delete variables._edges;

  const response = await this.db.updateWorkflow({
    id,
    name: data.definition.name,
    description: data.definition.description ?? "",
    enabled: existing.workflow.enabled ?? false,
    steps: existing.workflow.steps ?? [],
    variables,
    onSuccess: existing.workflow.onSuccess ?? "",
    onFailure: existing.workflow.onFailure ?? "",
    maxRetries: existing.workflow.maxRetries ?? 0,
    timeoutSeconds: existing.workflow.timeoutSeconds ?? 0,
  });
  if (response.status?.code !== "OK" || !response.workflow) { return null; }

  const applicationId = await this.ensureApplicationId();
  const out: WorkflowMutationResult = {
    id,
    definition: data.definition,
    isEnabled: response.workflow.enabled ?? false,
  };

  void this.emitWorkflowWebhook({
    type: EngineEventType.WORKFLOW_UPDATED,
    applicationId,
    correlationKey: data.correlationKey,
    workflow: {
      id,
      definition: data.definition,
      isEnabled: out.isEnabled,
      createdAt: existing.workflow.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  });

  return out;
}
```

- [ ] **Step 4: Implement server-side `deleteWorkflow`**

```ts
async deleteWorkflow(id: string, correlationKey?: string): Promise<boolean> {
  const applicationId = await this.ensureApplicationId();
  this.logger.info("Deleting workflow", { id });
  const response = await this.db.deleteWorkflow({ id });
  const deleted = response.code === "OK";
  if (deleted) {
    void this.emitWorkflowWebhook({
      type: EngineEventType.WORKFLOW_DELETED,
      applicationId,
      correlationKey,
      workflowId: id,
    });
  }
  return deleted;
}
```

- [ ] **Step 5: Implement `setWorkflowEnabled`**

```ts
async setWorkflowEnabled(id: string, isEnabled: boolean, correlationKey?: string): Promise<{ id: string; isEnabled: boolean }> {
  const existing = await this.db.getWorkflow({ id });
  if (existing.status?.code !== "OK" || !existing.workflow) {
    throw new Error("Workflow not found");
  }
  const response = await this.db.updateWorkflow({
    id,
    name: existing.workflow.name ?? "",
    description: existing.workflow.description ?? "",
    enabled: isEnabled,
    steps: existing.workflow.steps ?? [],
    variables: existing.workflow.variables ?? {},
    onSuccess: existing.workflow.onSuccess ?? "",
    onFailure: existing.workflow.onFailure ?? "",
    maxRetries: existing.workflow.maxRetries ?? 0,
    timeoutSeconds: existing.workflow.timeoutSeconds ?? 0,
  });
  if (response.status?.code !== "OK" || !response.workflow) {
    throw new Error("Failed to toggle workflow enabled state");
  }

  const applicationId = await this.ensureApplicationId();
  const defRaw = existing.workflow.variables?._definition;
  const definition: WorkflowDefinition | undefined = defRaw ? JSON.parse(defRaw) : undefined;
  if (definition) {
    void this.emitWorkflowWebhook({
      type: EngineEventType.WORKFLOW_UPDATED,
      applicationId,
      correlationKey,
      workflow: {
        id,
        definition,
        isEnabled,
        createdAt: existing.workflow.createdAt ?? new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });
  }

  return { id, isEnabled };
}
```

- [ ] **Step 6: Add private `emitWorkflowWebhook` helper**

Add this private method to the `Api` class:
```ts
private async emitWorkflowWebhook(
  event: WorkflowCreatedEvent | WorkflowUpdatedEvent | WorkflowDeletedEvent,
): Promise<void> {
  if (!this.webhookClient) {
    this.logger.warn("No webhook client set, skipping workflow webhook", { type: event.type });
    return;
  }
  try {
    await this.webhookClient.send(event);
  } catch (err) {
    this.logger.error("Failed to send workflow webhook", { type: event.type, err });
  }
}
```

Add imports:
```ts
import type { WorkflowCreatedEvent, WorkflowUpdatedEvent, WorkflowDeletedEvent } from "@woofx3/api/webhooks";
```

- [ ] **Step 7: Type-check**

```bash
cd ~/code/wolfymaster/woofx3
bun run check
```
Expected: PASS (may need to adjust for broken consumers — if `getWorkflow`/`workflowToItem` read `_steps`, leave those code paths untouched for now; Task A5 removes them).

- [ ] **Step 8: Commit**

```bash
git add api/src/api.ts shared/clients/typescript/api/api.ts
git commit -m "feat(engine): accept canonical WorkflowDefinition in RPC"
```

---

### Task A5: Remove legacy `_steps` / `_trigger` read paths

**Files:**
- Modify: `api/src/api.ts:1419-1475` (`workflowToItem` and related getters)

- [ ] **Step 1: Find all legacy reads**

Run: `grep -n "_steps\|_trigger\|_nodes\|_edges" api/src/api.ts`
Note every line.

- [ ] **Step 2: Replace reads with `_definition`**

In `workflowToItem` (around line 1419), change the steps/trigger extraction to read `_definition`:
```ts
private workflowToItem(wf: workflow.Workflow): WorkflowItem {
  const defRaw = wf.variables?._definition;
  const definition: WorkflowDefinition | null = defRaw ? JSON.parse(defRaw) : null;
  return {
    id: wf.id ?? "",
    name: wf.name ?? "",
    description: wf.description ?? "",
    accountId: wf.applicationId ?? "",
    isEnabled: wf.enabled ?? false,
    definition,
    stats: { runsToday: 0, successRate: 0 },
    createdAt: wf.createdAt ?? "",
    updatedAt: wf.updatedAt ?? "",
  };
}
```

Update `Workflow` return type in `shared/clients/typescript/api/api.ts` to drop `steps`/`trigger` and add `definition: WorkflowDefinition | null`. Drop `WorkflowStep` and `WorkflowTrigger` exports (breaking change, user-approved).

- [ ] **Step 3: Run the engine's test suite**

```bash
cd ~/code/wolfymaster/woofx3 && bun test
```
Expected: all green. Fix any callers that referenced `.steps` / `.trigger` on `Workflow`.

- [ ] **Step 4: Commit**

```bash
git add api/src/api.ts shared/clients/typescript/api/api.ts
git commit -m "refactor(engine): remove legacy _steps/_trigger workflow paths"
```

---

### Task A6: Update engine dependents + link shared package

**Files:**
- Scan: anywhere in `woofx3` that imports `CreateWorkflowInput`, `WorkflowStep`, `WorkflowTrigger`, or the old `Workflow` shape

- [ ] **Step 1: Grep for legacy consumers**

```bash
grep -rn "WorkflowStep\|WorkflowTrigger\|\.steps\b\|createWorkflow.*steps" ~/code/wolfymaster/woofx3/api ~/code/wolfymaster/woofx3/services 2>/dev/null
```

- [ ] **Step 2: Fix each site**

For each caller, switch to `definition` or delete if unused. Document each change in the commit message.

- [ ] **Step 3: Run the full engine test suite**

```bash
cd ~/code/wolfymaster/woofx3 && bun test
```

- [ ] **Step 4: VERIFY end-to-end for Part A**

```bash
cd ~/code/wolfymaster/woofx3 && bun run check && bun test
```
Both must pass before moving on. If any test is flaky, fix before continuing.

- [ ] **Step 5: Commit and push**

```bash
git push -u origin feat/workflow-json-first
```

Open PR with the spec linked. Merge when CI is green.

---

## Part B — Convex changes (woofx3-ui)

Start **after Part A is merged** so the `@woofx3/api` package is up to date. Work in `~/code/wolfymaster/woofx3-ui` on a new branch `feat/workflow-json-first`.

Bump the engine checkout/link so `@woofx3/api` resolves to the updated types: run `bun run link-sdk` (per `CLAUDE.md`). Verify with `bun run check` that `WorkflowDefinition`/`WorkflowCreatedEvent` are importable.

### Task B1: Update Convex `workflows` schema + correlation tables

**Files:**
- Modify: `convex/schema.ts`

- [ ] **Step 1: Replace the workflows table definition**

Edit `convex/schema.ts` — find `workflows: defineTable(...)` and replace with:
```ts
workflows: defineTable({
  instanceId: v.id("instances"),
  applicationId: v.string(),
  engineWorkflowId: v.string(),
  definition: v.any(),        // WorkflowDefinition; enforced in code
  isEnabled: v.boolean(),
  nodes: v.optional(v.array(v.any())),
  edges: v.optional(v.array(v.any())),
  projectionUpdatedAt: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_instance", ["instanceId"])
  .index("by_engine_id", ["instanceId", "engineWorkflowId"]),
```

- [ ] **Step 2: Add the two correlation tables**

Append to `convex/schema.ts`:
```ts
pendingWorkflowOperations: defineTable({
  correlationKey: v.string(),
  instanceId: v.id("instances"),
  op: v.union(v.literal("create"), v.literal("update"), v.literal("delete")),
  expiresAt: v.number(),
})
  .index("by_correlation", ["correlationKey"])
  .index("by_expiry", ["expiresAt"]),

completedWorkflowOperations: defineTable({
  correlationKey: v.string(),
  engineWorkflowId: v.string(),
  op: v.union(v.literal("create"), v.literal("update"), v.literal("delete")),
  completedAt: v.number(),
}).index("by_correlation", ["correlationKey"]),
```

- [ ] **Step 3: Push schema to dev Convex**

```bash
bunx convex dev --once
```
Expected: migration succeeds (fresh DB per spec; wipe if prompted).

- [ ] **Step 4: Commit**

```bash
git add convex/schema.ts
git commit -m "feat(convex): JSON-first workflows schema + correlation tables"
```

---

### Task B2: Rewrite `convex/workflows.ts` — queries + projection mutation

**Files:**
- Modify: `convex/workflows.ts` (full rewrite; keep the file path, replace contents)

- [ ] **Step 1: Replace the file with queries + projection mutation**

```ts
// convex/workflows.ts
import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { getInstanceMembership } from "./lib/teamAccess";

export const list = query({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, { instanceId }): Promise<Doc<"workflows">[]> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) { return []; }
    const membership = await getInstanceMembership(ctx, instanceId, userId);
    if (!membership) { return []; }
    return ctx.db
      .query("workflows")
      .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
      .take(100);
  },
});

export const getByEngineId = query({
  args: {
    instanceId: v.id("instances"),
    engineWorkflowId: v.string(),
  },
  handler: async (ctx, { instanceId, engineWorkflowId }): Promise<Doc<"workflows"> | null> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) { return null; }
    const membership = await getInstanceMembership(ctx, instanceId, userId);
    if (!membership) { return null; }
    const row = await ctx.db
      .query("workflows")
      .withIndex("by_engine_id", (q) => q.eq("instanceId", instanceId).eq("engineWorkflowId", engineWorkflowId))
      .first();
    return row;
  },
});

export const updateProjection = mutation({
  args: {
    instanceId: v.id("instances"),
    engineWorkflowId: v.string(),
    nodes: v.array(v.any()),
    edges: v.array(v.any()),
  },
  handler: async (ctx, { instanceId, engineWorkflowId, nodes, edges }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) { throw new Error("Not authenticated"); }
    const membership = await getInstanceMembership(ctx, instanceId, userId);
    if (!membership) { throw new Error("Not authorized"); }

    const row = await ctx.db
      .query("workflows")
      .withIndex("by_engine_id", (q) => q.eq("instanceId", instanceId).eq("engineWorkflowId", engineWorkflowId))
      .first();
    if (!row) { return null; }
    await ctx.db.patch(row._id, {
      nodes,
      edges,
      projectionUpdatedAt: Date.now(),
    });
    return null;
  },
});
```

- [ ] **Step 2: Type-check**

```bash
bun run check
```
Expected: PASS, but may fail temporarily because `create`/`update`/`remove`/`syncToEngine` are gone. Confirm only the expected errors.

- [ ] **Step 3: Commit**

```bash
git add convex/workflows.ts
git commit -m "feat(convex): workflows queries + updateProjection mutation"
```

---

### Task B3: Convex actions — `createFromDefinition`, `updateFromDefinition`, `deleteByEngineId`, `setEnabled`

**Files:**
- Create: `convex/workflowActions.ts`

Public actions live in a separate file from queries/mutations because actions cannot share a file with queries that register on the same name unless carefully split. Following the repo's existing pattern (`registration.ts`, `workflowCatalog.ts`).

- [ ] **Step 1: Write the actions file**

```ts
// convex/workflowActions.ts
"use node";

import { getAuthUserId } from "@convex-dev/auth/server";
import type { WorkflowDefinition } from "@woofx3/api";
import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action } from "./_generated/server";
import { createEngineRpcSession, type EngineApi } from "./lib/engineInstanceUrl";

const CORRELATION_TIMEOUT_MS = 10_000;
const CORRELATION_POLL_MS = 250;

async function waitForCompletion(
  ctx: Parameters<Parameters<typeof action>[0]["handler"]>[0],
  correlationKey: string,
): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < CORRELATION_TIMEOUT_MS) {
    const row = await ctx.runQuery(internal.workflowInternal.findCompletion, { correlationKey });
    if (row) { return row.engineWorkflowId; }
    await new Promise((r) => setTimeout(r, CORRELATION_POLL_MS));
  }
  throw new Error("Engine did not confirm the change within 10s");
}

async function requireInstanceContext(ctx: any, instanceId: Id<"instances">) {
  const userId = await getAuthUserId(ctx);
  if (!userId) { throw new Error("Not authenticated"); }
  const bundle = await ctx.runQuery(internal.workflowCatalogContext.catalogContextForUser, {
    instanceId,
    userId,
  });
  if (!bundle) { throw new Error("Not authorized or instance not found"); }
  if (!bundle.clientId || !bundle.clientSecret) {
    throw new Error("Instance is not registered with the engine");
  }
  return bundle;
}

export const createFromDefinition = action({
  args: {
    instanceId: v.id("instances"),
    definition: v.any(), // Omit<WorkflowDefinition, "id">
  },
  handler: async (ctx, { instanceId, definition }): Promise<{ engineWorkflowId: string }> => {
    const bundle = await requireInstanceContext(ctx, instanceId);
    const correlationKey = crypto.randomUUID();

    await ctx.runMutation(internal.workflowInternal.insertPending, {
      correlationKey,
      instanceId,
      op: "create",
      expiresAt: Date.now() + CORRELATION_TIMEOUT_MS + 5_000,
    });

    const rpc = createEngineRpcSession<EngineApi>(bundle.url, bundle.clientId, bundle.clientSecret);
    await rpc.createWorkflow({
      accountId: bundle.applicationId,
      definition: definition as Omit<WorkflowDefinition, "id">,
      correlationKey,
    });

    const engineWorkflowId = await waitForCompletion(ctx, correlationKey);
    return { engineWorkflowId };
  },
});

export const updateFromDefinition = action({
  args: {
    instanceId: v.id("instances"),
    engineWorkflowId: v.string(),
    definition: v.any(), // WorkflowDefinition
  },
  handler: async (ctx, { instanceId, engineWorkflowId, definition }): Promise<{ engineWorkflowId: string }> => {
    const bundle = await requireInstanceContext(ctx, instanceId);
    const correlationKey = crypto.randomUUID();

    await ctx.runMutation(internal.workflowInternal.insertPending, {
      correlationKey,
      instanceId,
      op: "update",
      expiresAt: Date.now() + CORRELATION_TIMEOUT_MS + 5_000,
    });

    const rpc = createEngineRpcSession<EngineApi>(bundle.url, bundle.clientId, bundle.clientSecret);
    await rpc.updateWorkflow(engineWorkflowId, {
      definition: definition as WorkflowDefinition,
      correlationKey,
    });

    const result = await waitForCompletion(ctx, correlationKey);
    return { engineWorkflowId: result };
  },
});

export const deleteByEngineId = action({
  args: {
    instanceId: v.id("instances"),
    engineWorkflowId: v.string(),
  },
  handler: async (ctx, { instanceId, engineWorkflowId }): Promise<{ deleted: true }> => {
    const bundle = await requireInstanceContext(ctx, instanceId);
    const correlationKey = crypto.randomUUID();

    await ctx.runMutation(internal.workflowInternal.insertPending, {
      correlationKey,
      instanceId,
      op: "delete",
      expiresAt: Date.now() + CORRELATION_TIMEOUT_MS + 5_000,
    });

    const rpc = createEngineRpcSession<EngineApi>(bundle.url, bundle.clientId, bundle.clientSecret);
    await rpc.deleteWorkflow(engineWorkflowId, correlationKey);

    await waitForCompletion(ctx, correlationKey);
    return { deleted: true };
  },
});

export const setEnabled = action({
  args: {
    instanceId: v.id("instances"),
    engineWorkflowId: v.string(),
    isEnabled: v.boolean(),
  },
  handler: async (ctx, { instanceId, engineWorkflowId, isEnabled }): Promise<{ isEnabled: boolean }> => {
    const bundle = await requireInstanceContext(ctx, instanceId);
    const correlationKey = crypto.randomUUID();

    await ctx.runMutation(internal.workflowInternal.insertPending, {
      correlationKey,
      instanceId,
      op: "update",
      expiresAt: Date.now() + CORRELATION_TIMEOUT_MS + 5_000,
    });

    const rpc = createEngineRpcSession<EngineApi>(bundle.url, bundle.clientId, bundle.clientSecret);
    await rpc.setWorkflowEnabled(engineWorkflowId, isEnabled, correlationKey);

    await waitForCompletion(ctx, correlationKey);
    return { isEnabled };
  },
});
```

- [ ] **Step 2: `EngineApi` may need to expose `setWorkflowEnabled`**

Confirm `convex/lib/engineInstanceUrl.ts` `EngineApi` interface covers all the methods called above. The interface extends `Woofx3EngineApi`, so as long as Part A updated that interface, no change is needed here. If type errors appear, widen the local interface.

- [ ] **Step 3: Commit**

```bash
git add convex/workflowActions.ts
git commit -m "feat(convex): workflow CRUD actions with correlation waits"
```

---

### Task B4: Internal Convex helpers — pending/completed tables

**Files:**
- Create: `convex/workflowInternal.ts`

- [ ] **Step 1: Write internal helpers**

```ts
// convex/workflowInternal.ts
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internalMutation, internalQuery } from "./_generated/server";

export const insertPending = internalMutation({
  args: {
    correlationKey: v.string(),
    instanceId: v.id("instances"),
    op: v.union(v.literal("create"), v.literal("update"), v.literal("delete")),
    expiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("pendingWorkflowOperations", args);
  },
});

export const findCompletion = internalQuery({
  args: { correlationKey: v.string() },
  handler: async (ctx, { correlationKey }) => {
    return ctx.db
      .query("completedWorkflowOperations")
      .withIndex("by_correlation", (q) => q.eq("correlationKey", correlationKey))
      .first();
  },
});

export const resolveCorrelation = internalMutation({
  args: {
    correlationKey: v.string(),
    engineWorkflowId: v.string(),
    op: v.union(v.literal("create"), v.literal("update"), v.literal("delete")),
  },
  handler: async (ctx, { correlationKey, engineWorkflowId, op }) => {
    const pending = await ctx.db
      .query("pendingWorkflowOperations")
      .withIndex("by_correlation", (q) => q.eq("correlationKey", correlationKey))
      .first();
    if (pending) { await ctx.db.delete(pending._id); }
    await ctx.db.insert("completedWorkflowOperations", {
      correlationKey,
      engineWorkflowId,
      op,
      completedAt: Date.now(),
    });
  },
});

export const clearCompletion = internalMutation({
  args: { correlationKey: v.string() },
  handler: async (ctx, { correlationKey }) => {
    const row = await ctx.db
      .query("completedWorkflowOperations")
      .withIndex("by_correlation", (q) => q.eq("correlationKey", correlationKey))
      .first();
    if (row) { await ctx.db.delete(row._id); }
  },
});

export const upsertFromWebhook = internalMutation({
  args: {
    instanceId: v.id("instances"),
    applicationId: v.string(),
    engineWorkflowId: v.string(),
    definition: v.any(),
    isEnabled: v.boolean(),
  },
  handler: async (ctx, { instanceId, applicationId, engineWorkflowId, definition, isEnabled }) => {
    const existing = await ctx.db
      .query("workflows")
      .withIndex("by_engine_id", (q) => q.eq("instanceId", instanceId).eq("engineWorkflowId", engineWorkflowId))
      .first();
    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, { definition, isEnabled, applicationId, updatedAt: now });
      return existing._id;
    }
    return ctx.db.insert("workflows", {
      instanceId,
      applicationId,
      engineWorkflowId,
      definition,
      isEnabled,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const deleteFromWebhook = internalMutation({
  args: {
    instanceId: v.id("instances"),
    engineWorkflowId: v.string(),
  },
  handler: async (ctx, { instanceId, engineWorkflowId }) => {
    const row = await ctx.db
      .query("workflows")
      .withIndex("by_engine_id", (q) => q.eq("instanceId", instanceId).eq("engineWorkflowId", engineWorkflowId))
      .first();
    if (row) { await ctx.db.delete(row._id); }
  },
});

export const sweepExpiredPending = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const expired = await ctx.db
      .query("pendingWorkflowOperations")
      .withIndex("by_expiry", (q) => q.lte("expiresAt", now))
      .take(100);
    for (const row of expired) { await ctx.db.delete(row._id); }
  },
});

export const resolveCorrelationForDelete = internalMutation({
  args: { correlationKey: v.string(), engineWorkflowId: v.string() },
  handler: async (ctx, { correlationKey, engineWorkflowId }) => {
    const pending = await ctx.db
      .query("pendingWorkflowOperations")
      .withIndex("by_correlation", (q) => q.eq("correlationKey", correlationKey))
      .first();
    if (pending) { await ctx.db.delete(pending._id); }
    await ctx.db.insert("completedWorkflowOperations", {
      correlationKey,
      engineWorkflowId,
      op: "delete",
      completedAt: Date.now(),
    });
  },
});
```

- [ ] **Step 2: Commit**

```bash
git add convex/workflowInternal.ts
git commit -m "feat(convex): internal helpers for workflow correlation and upsert"
```

---

### Task B5: Webhook handler — extend for `workflow.*` events

**Files:**
- Modify: `convex/http.ts` (find the `/api/webhooks/woofx3` handler)
- Reference: existing `convex/moduleWebhook.ts` for event-narrowing patterns

- [ ] **Step 1: Inspect current dispatch**

Read `convex/http.ts` to find the dispatch block narrowing on `event.type`. Find where it currently handles `MODULE_INSTALLED` etc.

- [ ] **Step 2: Add new branches**

Add branches for `workflow.created`, `workflow.updated`, `workflow.deleted`:

```ts
// Inside the existing webhook handler, after module.* branches:

if (event.type === "workflow.created" || event.type === "workflow.updated") {
  await ctx.runMutation(internal.workflowInternal.upsertFromWebhook, {
    instanceId: instance._id,
    applicationId: event.applicationId,
    engineWorkflowId: event.workflow.id,
    definition: event.workflow.definition,
    isEnabled: event.workflow.isEnabled,
  });
  if (event.correlationKey) {
    await ctx.runMutation(internal.workflowInternal.resolveCorrelation, {
      correlationKey: event.correlationKey,
      engineWorkflowId: event.workflow.id,
      op: event.type === "workflow.created" ? "create" : "update",
    });
  }
  return new Response(null, { status: 204 });
}

if (event.type === "workflow.deleted") {
  await ctx.runMutation(internal.workflowInternal.deleteFromWebhook, {
    instanceId: instance._id,
    engineWorkflowId: event.workflowId,
  });
  if (event.correlationKey) {
    await ctx.runMutation(internal.workflowInternal.resolveCorrelationForDelete, {
      correlationKey: event.correlationKey,
      engineWorkflowId: event.workflowId,
    });
  }
  return new Response(null, { status: 204 });
}
```

- [ ] **Step 3: Commit**

```bash
git add convex/http.ts
git commit -m "feat(convex): handle workflow.* webhooks"
```

---

### Task B6: Cron to sweep expired pending operations

**Files:**
- Modify: `convex/crons.ts` if it exists, otherwise create.
- (check via: `ls convex/crons.ts`)

- [ ] **Step 1: Register a cron**

```ts
// convex/crons.ts
import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval(
  "sweep expired workflow pending operations",
  { minutes: 1 },
  internal.workflowInternal.sweepExpiredPending,
);

export default crons;
```

If `convex/crons.ts` already exists, add the single `interval` line to the existing `cronJobs()` chain — don't create a duplicate file.

- [ ] **Step 2: Commit**

```bash
git add convex/crons.ts
git commit -m "feat(convex): sweep expired pending workflow operations"
```

---

### Task B7: Remove deprecated Convex workflow code paths

**Files:**
- Delete / audit: `syncToEngine` action and legacy `create`/`update`/`remove` in the prior `convex/workflows.ts` are already gone after B2.
- Audit: `client/src/lib/queryClient.ts` — remove any legacy `/api/workflows` handling.

- [ ] **Step 1: Grep for legacy callers**

```bash
grep -rn "syncToEngine\|/api/workflows\|api\.workflows\.create\b\|api\.workflows\.update\b" \
  ~/code/wolfymaster/woofx3-ui/client ~/code/wolfymaster/woofx3-ui/convex 2>/dev/null
```

- [ ] **Step 2: Remove each legacy callsite**

Only the `basic-editor.tsx` caller matters; it's rewritten in Part C. For now, disable its POST (leave the component — it'll be rewritten) or leave it broken and move on. Document in the commit message that UI is temporarily broken until Part C lands.

- [ ] **Step 3: VERIFY Part B**

```bash
bun run check
bunx biome check .
bunx convex dev --once   # ensure functions deploy cleanly
```

- [ ] **Step 4: Commit and push**

```bash
git add -p   # review each hunk
git commit -m "chore(convex): remove legacy workflow sync code paths"
git push -u origin feat/workflow-json-first
```

Open PR; merge when green. UI may show a broken "Create Workflow" button until Part C merges — that is expected per the three-part split.

---

## Part C — UI changes (woofx3-ui)

Start **after Part B is merged**. Branch `feat/workflow-json-first-ui` (same repo).

### Task C1: Add `dagre` dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install dagre**

```bash
bun add dagre @types/dagre
```

- [ ] **Step 2: Commit**

```bash
git add package.json bun.lockb
git commit -m "chore: add dagre for auto-layout"
```

---

### Task C2: Pure function `definitionToReactFlow` (TDD)

**Files:**
- Create: `client/src/lib/workflow-projection.ts`
- Create: `client/src/lib/workflow-projection.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// client/src/lib/workflow-projection.test.ts
import { describe, expect, test } from "bun:test";
import type { WorkflowDefinition } from "@woofx3/api";
import { definitionToReactFlow } from "./workflow-projection";

const baseDef: WorkflowDefinition = {
  id: "wf",
  name: "Test",
  trigger: { type: "event", eventType: "cheer.user.twitch" },
  tasks: [],
};

describe("definitionToReactFlow", () => {
  test("trigger-only produces one node, no edges", () => {
    const { nodes, edges } = definitionToReactFlow(baseDef);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].id).toBe("__trigger");
    expect(nodes[0].type).toBe("trigger");
    expect(edges).toHaveLength(0);
  });

  test("single action task wires trigger → action edge", () => {
    const def: WorkflowDefinition = {
      ...baseDef,
      tasks: [{ id: "a1", type: "action", parameters: { action: "print" } }],
    };
    const { nodes, edges } = definitionToReactFlow(def);
    expect(nodes.map((n) => n.id).sort()).toEqual(["__trigger", "a1"]);
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ source: "__trigger", target: "a1" });
  });

  test("dependsOn creates edge from parent to child, no implicit trigger edge", () => {
    const def: WorkflowDefinition = {
      ...baseDef,
      tasks: [
        { id: "a1", type: "action", parameters: {} },
        { id: "a2", type: "action", dependsOn: ["a1"], parameters: {} },
      ],
    };
    const { edges } = definitionToReactFlow(def);
    expect(edges.map((e) => `${e.source}->${e.target}`).sort()).toEqual([
      "__trigger->a1",
      "a1->a2",
    ]);
  });

  test("condition onTrue/onFalse produce branch-tagged edges", () => {
    const def: WorkflowDefinition = {
      ...baseDef,
      tasks: [
        { id: "c1", type: "condition",
          conditions: [{ field: "${trigger.data.amount}", operator: "gte", value: 100 }],
          onTrue: ["a1"], onFalse: ["a2"] },
        { id: "a1", type: "action", dependsOn: ["c1"], parameters: {} },
        { id: "a2", type: "action", dependsOn: ["c1"], parameters: {} },
      ],
    };
    const { edges } = definitionToReactFlow(def);
    const trueEdge = edges.find((e) => e.source === "c1" && e.target === "a1");
    const falseEdge = edges.find((e) => e.source === "c1" && e.target === "a2");
    expect(trueEdge?.data?.branch).toBe("true");
    expect(falseEdge?.data?.branch).toBe("false");
  });

  test("positions are deterministic (same def → same positions)", () => {
    const def: WorkflowDefinition = {
      ...baseDef,
      tasks: [{ id: "a1", type: "action", parameters: {} }],
    };
    const a = definitionToReactFlow(def);
    const b = definitionToReactFlow(def);
    expect(a.nodes.map((n) => n.position)).toEqual(b.nodes.map((n) => n.position));
  });

  test("task with no dependsOn and referenced by onTrue gets no trigger edge", () => {
    const def: WorkflowDefinition = {
      ...baseDef,
      tasks: [
        { id: "c1", type: "condition",
          conditions: [{ field: "x", operator: "eq", value: 1 }],
          onTrue: ["a1"] },
        { id: "a1", type: "action", parameters: {} }, // no dependsOn
      ],
    };
    const { edges } = definitionToReactFlow(def);
    expect(edges.find((e) => e.source === "__trigger" && e.target === "a1")).toBeUndefined();
    expect(edges.find((e) => e.source === "c1" && e.target === "a1")).toBeDefined();
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
bun test client/src/lib/workflow-projection.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the pure function**

```ts
// client/src/lib/workflow-projection.ts
import dagre from "dagre";
import type { Edge, Node } from "reactflow";
import type { WorkflowDefinition, TaskDefinition } from "@woofx3/api";

export interface ProjectionNode extends Node {
  data: {
    kind: "trigger" | "task";
    eventType?: string;
    task?: TaskDefinition;
  };
}

const NODE_WIDTH = 220;
const NODE_HEIGHT = 80;

export function definitionToReactFlow(def: WorkflowDefinition): {
  nodes: ProjectionNode[];
  edges: Edge[];
} {
  const nodes: ProjectionNode[] = [];
  const edges: Edge[] = [];

  nodes.push({
    id: "__trigger",
    type: "trigger",
    position: { x: 0, y: 0 },
    data: { kind: "trigger", eventType: def.trigger.eventType },
  });

  for (const task of def.tasks) {
    nodes.push({
      id: task.id,
      type: task.type,
      position: { x: 0, y: 0 },
      data: { kind: "task", task },
    });
  }

  const referencedByBranch = new Set<string>();
  for (const task of def.tasks) {
    for (const r of task.onTrue ?? []) { referencedByBranch.add(r); }
    for (const r of task.onFalse ?? []) { referencedByBranch.add(r); }
  }

  for (const task of def.tasks) {
    if ((task.dependsOn?.length ?? 0) === 0 && !referencedByBranch.has(task.id)) {
      edges.push({
        id: `__trigger->${task.id}`,
        source: "__trigger",
        target: task.id,
      });
    }
    for (const parent of task.dependsOn ?? []) {
      edges.push({
        id: `${parent}->${task.id}`,
        source: parent,
        target: task.id,
      });
    }
    if (task.type === "condition") {
      for (const r of task.onTrue ?? []) {
        edges.push({
          id: `${task.id}->${r}:true`,
          source: task.id,
          target: r,
          data: { branch: "true" },
        });
      }
      for (const r of task.onFalse ?? []) {
        edges.push({
          id: `${task.id}->${r}:false`,
          source: task.id,
          target: r,
          data: { branch: "false" },
        });
      }
    }
  }

  applyDagreLayout(nodes, edges);
  return { nodes, edges };
}

function applyDagreLayout(nodes: ProjectionNode[], edges: Edge[]): void {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "LR", nodesep: 40, ranksep: 80 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const node of nodes) {
    g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }
  for (const edge of edges) {
    g.setEdge(edge.source, edge.target);
  }
  dagre.layout(g);
  for (const node of nodes) {
    const pos = g.node(node.id);
    if (pos) {
      node.position = { x: pos.x - NODE_WIDTH / 2, y: pos.y - NODE_HEIGHT / 2 };
    }
  }
}
```

- [ ] **Step 4: Run — expect PASS**

```bash
bun test client/src/lib/workflow-projection.test.ts
```
Expected: PASS (6/6).

- [ ] **Step 5: Commit**

```bash
git add client/src/lib/workflow-projection.ts client/src/lib/workflow-projection.test.ts
git commit -m "feat(ui): definitionToReactFlow projection with dagre layout"
```

---

### Task C3: Preset → canonical JSON mapping (TDD)

**Files:**
- Create: `client/src/lib/workflow-presets-json.ts`
- Create: `client/src/lib/workflow-presets-json.test.ts`
- Modify: `client/src/lib/workflow-presets.ts` — remove `generateWorkflowFromPresets` and `generateMultiTierWorkflow`; keep shared types.

- [ ] **Step 1: Write failing tests**

```ts
// client/src/lib/workflow-presets-json.test.ts
import { describe, expect, test } from "bun:test";
import type { ActionPreset, TierConfig, TriggerPreset } from "./workflow-presets";
import { buildDefinitionFromPresets, buildTieredDefinition } from "./workflow-presets-json";

const cheerTrigger = {
  id: "cheer",
  name: "Cheer",
  description: "When a user cheers",
  category: "Twitch",
  color: "",
  event: "cheer.user.twitch",
} as unknown as TriggerPreset & { event: string };

const chatAction = {
  id: "sendChatMessage",
  name: "Send Chat Message",
  description: "Sends a message",
  category: "Chat",
  color: "",
} as ActionPreset;

describe("buildDefinitionFromPresets", () => {
  test("simple trigger+action produces a single-task definition", () => {
    const def = buildDefinitionFromPresets(cheerTrigger, chatAction, {}, { message: "hi" });
    expect(def.trigger).toEqual({ type: "event", eventType: "cheer.user.twitch", conditions: [] });
    expect(def.tasks).toEqual([
      { id: "action-1", type: "action", parameters: { action: "sendChatMessage", message: "hi" } },
    ]);
    expect(def.name).toMatch(/Cheer/);
  });
});

describe("buildTieredDefinition", () => {
  test("tier with single amount becomes condition + action pair", () => {
    const tiers: TierConfig[] = [
      { id: "t1", values: { amount: { type: "single", value: 100 } }, action: chatAction, actionConfig: { message: "100!" } },
    ];
    const def = buildTieredDefinition(cheerTrigger, tiers);
    const checkIds = def.tasks.filter((t) => t.type === "condition").map((t) => t.id);
    const actionIds = def.tasks.filter((t) => t.type === "action").map((t) => t.id);
    expect(checkIds).toHaveLength(1);
    expect(actionIds).toHaveLength(1);
    const cond = def.tasks.find((t) => t.type === "condition");
    expect(cond?.conditions?.[0]).toMatchObject({
      field: "${trigger.data.amount}",
      operator: "eq",
      value: 100,
    });
    expect(cond?.onTrue).toEqual([actionIds[0]]);
  });

  test("tier with range becomes between operator", () => {
    const tiers: TierConfig[] = [
      { id: "t1", values: { amount: { type: "range", min: 100, max: 500 } }, action: chatAction, actionConfig: {} },
    ];
    const def = buildTieredDefinition(cheerTrigger, tiers);
    const cond = def.tasks.find((t) => t.type === "condition");
    expect(cond?.conditions?.[0]).toMatchObject({
      field: "${trigger.data.amount}",
      operator: "between",
      value: [100, 500],
    });
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
bun test client/src/lib/workflow-presets-json.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// client/src/lib/workflow-presets-json.ts
import type { WorkflowDefinition, TaskDefinition, ConditionConfig } from "@woofx3/api";
import type {
  ActionPreset,
  ConfigValue,
  TierConfig,
  TriggerConfigValues,
  TriggerPreset,
} from "./workflow-presets";

type TriggerWithEvent = TriggerPreset & { event?: string };

function triggerEventType(t: TriggerWithEvent): string {
  if (!t.event) {
    throw new Error(`Trigger preset "${t.id}" is missing an "event" field`);
  }
  return t.event;
}

function configValuesToConditions(values: TriggerConfigValues): ConditionConfig[] {
  // Preset trigger config fields that aren't "amount" are used as trigger-level
  // conditions. Amount is handled per-tier via buildTieredDefinition.
  const out: ConditionConfig[] = [];
  for (const [key, raw] of Object.entries(values)) {
    if (key === "amount") { continue; }
    if (raw === null || raw === undefined || raw === "") { continue; }
    out.push({
      field: `\${trigger.data.${key}}`,
      operator: "eq",
      value: raw as unknown,
    });
  }
  return out;
}

function actionParameters(action: ActionPreset, actionConfig: TriggerConfigValues): Record<string, unknown> {
  return { action: action.id, ...actionConfig };
}

export function buildDefinitionFromPresets(
  trigger: TriggerWithEvent,
  action: ActionPreset,
  triggerConfig: TriggerConfigValues,
  actionConfig: TriggerConfigValues,
): Omit<WorkflowDefinition, "id"> {
  return {
    name: `${trigger.name} → ${action.name}`,
    description: `When ${trigger.description.toLowerCase()}, ${action.description.toLowerCase()}.`,
    trigger: {
      type: "event",
      eventType: triggerEventType(trigger),
      conditions: configValuesToConditions(triggerConfig),
    },
    tasks: [
      {
        id: "action-1",
        type: "action",
        parameters: actionParameters(action, actionConfig),
      },
    ],
  };
}

function amountToCondition(amount: ConfigValue | undefined): ConditionConfig | null {
  if (!amount) { return null; }
  if (amount.type === "single" && amount.value !== undefined) {
    return { field: "${trigger.data.amount}", operator: "eq", value: amount.value };
  }
  if (amount.type === "range" && amount.min !== undefined && amount.max !== undefined) {
    return { field: "${trigger.data.amount}", operator: "between", value: [amount.min, amount.max] };
  }
  return null;
}

export function buildTieredDefinition(
  trigger: TriggerWithEvent,
  tiers: TierConfig[],
): Omit<WorkflowDefinition, "id"> {
  const tasks: TaskDefinition[] = [];
  tiers.forEach((tier, i) => {
    if (!tier.action) { return; }
    const checkId = `tier-${i + 1}-check`;
    const actionId = `tier-${i + 1}-action`;
    const cond = amountToCondition(tier.values.amount as ConfigValue | undefined);
    tasks.push({
      id: checkId,
      type: "condition",
      conditions: cond ? [cond] : [],
      onTrue: [actionId],
    });
    tasks.push({
      id: actionId,
      type: "action",
      dependsOn: [checkId],
      parameters: actionParameters(tier.action, tier.actionConfig),
    });
  });

  return {
    name: `${trigger.name} — tiered`,
    description: `Multi-tier ${trigger.name.toLowerCase()} automation.`,
    trigger: { type: "event", eventType: triggerEventType(trigger), conditions: [] },
    tasks,
  };
}
```

- [ ] **Step 4: Remove old generators from `workflow-presets.ts`**

Delete `generateWorkflowFromPresets` and `generateMultiTierWorkflow` from `client/src/lib/workflow-presets.ts`. Keep all type exports.

- [ ] **Step 5: Run — expect PASS**

```bash
bun test client/src/lib/workflow-presets-json.test.ts
bun run check
```
Expected: tests PASS, check reveals `basic-editor.tsx` still imports the removed generators — that is fixed in Task C4.

- [ ] **Step 6: Commit**

```bash
git add client/src/lib/workflow-presets-json.ts client/src/lib/workflow-presets-json.test.ts client/src/lib/workflow-presets.ts
git commit -m "feat(ui): preset→WorkflowDefinition JSON mapping"
```

---

### Task C4: Rewrite `basic-editor.tsx` to emit canonical JSON via Convex action

**Files:**
- Modify: `client/src/components/workflows/basic-editor.tsx`

- [ ] **Step 1: Swap the mutation target**

Replace the `createWorkflow` mutation block (currently uses `apiRequest` POST to `/api/workflows`) with a Convex action call:

```ts
import { useAction } from "convex/react";
import { api } from "@convex/_generated/api";

// inside the component:
const instanceId = instance?._id;
const createFromDefinition = useAction(api.workflowActions.createFromDefinition);

const createWorkflow = useMutation({
  mutationFn: async (definition: Omit<WorkflowDefinition, "id">) => {
    if (!instanceId) { throw new Error("No instance selected"); }
    return createFromDefinition({ instanceId, definition });
  },
  onSuccess: ({ engineWorkflowId }) => {
    toast({ title: "Workflow created" });
    navigate(`/workflows/${engineWorkflowId}`);
  },
  onError: (err) => {
    toast({
      title: "Failed to create workflow",
      description: err instanceof Error ? err.message : String(err),
      variant: "destructive",
    });
  },
});
```

- [ ] **Step 2: Swap the `handleCreate` helper to produce canonical JSON**

```ts
import { buildDefinitionFromPresets, buildTieredDefinition } from "@/lib/workflow-presets-json";

const handleCreate = () => {
  if (!selectedTrigger) { return; }
  let definition: Omit<WorkflowDefinition, "id">;
  if (supportsTiers && tiers.length > 0) {
    const validTiers = tiers.filter((t) => t.action);
    if (validTiers.length === 0) { return; }
    definition = buildTieredDefinition(selectedTrigger, validTiers);
  } else {
    if (!selectedAction) { return; }
    definition = buildDefinitionFromPresets(selectedTrigger, selectedAction, triggerConfig, actionConfig);
  }
  createWorkflow.mutate(definition);
};
```

- [ ] **Step 3: Add a "Preview JSON" collapsible on the final step**

Above the action buttons, before "Create Workflow":
```tsx
{canCreate && (
  <details className="mt-6">
    <summary className="text-sm text-muted-foreground cursor-pointer">Preview generated JSON</summary>
    <pre className="mt-2 p-3 bg-muted rounded text-xs overflow-auto max-h-64">
      {JSON.stringify(previewDefinition, null, 2)}
    </pre>
  </details>
)}
```

Where `previewDefinition` is computed via the same `buildDefinitionFromPresets` / `buildTieredDefinition` call used by `handleCreate`, gated on `canCreate`.

- [ ] **Step 4: Type-check + test locally**

```bash
bun run check
bun run dev  # load the UI, walk through basic-editor, confirm the preview renders
```

- [ ] **Step 5: Commit**

```bash
git add client/src/components/workflows/basic-editor.tsx
git commit -m "feat(ui): basic editor emits canonical JSON via Convex action"
```

---

### Task C5: Rewrite `workflow-builder.tsx` to treat definition as source of truth

**Files:**
- Modify: `client/src/pages/workflow-builder.tsx`

This is the largest UI task. Approach: keep the component shell, replace internal state management so `definition: WorkflowDefinition` is the state of record. Nodes/edges are memoized projections.

- [ ] **Step 1: Replace initial state to load from Convex**

```tsx
import { useParams, useLocation } from "wouter";
import { useQuery, useAction, useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import { definitionToReactFlow } from "@/lib/workflow-projection";
import type { WorkflowDefinition } from "@woofx3/api";

const params = useParams<{ id: string }>();
const engineWorkflowId = params?.id;
const instance = useStore($currentInstance);
const instanceId = instance?._id;

const workflow = useQuery(
  api.workflows.getByEngineId,
  instanceId && engineWorkflowId ? { instanceId, engineWorkflowId } : "skip",
);

const [definition, setDefinition] = useState<WorkflowDefinition | null>(null);
useEffect(() => {
  if (workflow?.definition) { setDefinition(workflow.definition as WorkflowDefinition); }
}, [workflow?.definition]);
```

- [ ] **Step 2: Derive nodes/edges from the definition, not local state**

```tsx
const projection = useMemo(
  () => (definition ? definitionToReactFlow(definition) : { nodes: [], edges: [] }),
  [definition],
);
const [nodes, setNodes, onNodesChange] = useNodesState(projection.nodes);
const [edges, setEdges, onEdgesChange] = useEdgesState(projection.edges);

// Re-sync when projection changes
useEffect(() => {
  setNodes(projection.nodes);
  setEdges(projection.edges);
}, [projection, setNodes, setEdges]);
```

Drags update the *local* `nodes` but never `definition` — layout is ephemeral (per the non-goal in the spec).

- [ ] **Step 3: Replace the Save handler**

```tsx
const updateFromDefinition = useAction(api.workflowActions.updateFromDefinition);
const updateProjection = useMutation(api.workflows.updateProjection);

const handleSave = async () => {
  if (!definition || !instanceId) { return; }
  try {
    await updateFromDefinition({ instanceId, engineWorkflowId: definition.id, definition });
    toast({ title: "Workflow saved" });
    // Fire-and-forget projection cache update using current rendered nodes/edges
    void updateProjection({
      instanceId,
      engineWorkflowId: definition.id,
      nodes: projection.nodes,
      edges: projection.edges,
    });
  } catch (err) {
    toast({
      title: "Save failed",
      description: err instanceof Error ? err.message : String(err),
      variant: "destructive",
    });
  }
};
```

Wire `<Button data-testid="button-save-workflow" onClick={handleSave}>`.

- [ ] **Step 4: Add "Preview JSON" toolbar button**

```tsx
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
const [showPreview, setShowPreview] = useState(false);

// in the toolbar:
<Button variant="outline" onClick={() => setShowPreview(true)} data-testid="button-preview-json">
  Preview JSON
</Button>

// at the bottom of the component:
<Sheet open={showPreview} onOpenChange={setShowPreview}>
  <SheetContent className="w-[640px] sm:max-w-none">
    <SheetHeader><SheetTitle>Workflow JSON</SheetTitle></SheetHeader>
    <pre className="mt-4 p-3 bg-muted rounded text-xs overflow-auto max-h-[80vh]">
      {JSON.stringify(definition ?? {}, null, 2)}
    </pre>
  </SheetContent>
</Sheet>
```

- [ ] **Step 5: Add a "Delete" control and plumb through `deleteByEngineId`**

Similar pattern; `useAction(api.workflowActions.deleteByEngineId)`; on success navigate to `/workflows`.

- [ ] **Step 6: Drop the hard-coded `initialNodes` / `initialEdges`**

They are replaced by the query-based projection. Delete from the file.

- [ ] **Step 7: Type-check and run the app**

```bash
bun run check
bun run dev  # manually exercise create → edit → save → preview
```

- [ ] **Step 8: Commit**

```bash
git add client/src/pages/workflow-builder.tsx
git commit -m "feat(ui): workflow builder driven by WorkflowDefinition"
```

---

### Task C6: Fire-and-forget projection push from builder mount

**Files:**
- Modify: `client/src/pages/workflow-builder.tsx`

- [ ] **Step 1: Push projection once on initial load**

After the first non-null `definition` is loaded, push the projection to Convex:
```tsx
const hasPushedRef = useRef(false);
useEffect(() => {
  if (!definition || !instanceId || hasPushedRef.current) { return; }
  hasPushedRef.current = true;
  void updateProjection({
    instanceId,
    engineWorkflowId: definition.id,
    nodes: projection.nodes,
    edges: projection.edges,
  });
}, [definition, instanceId, projection, updateProjection]);
```

Skip the push if `workflow.projectionUpdatedAt` is newer than the current definition's `updatedAt` — optimization, optional for v1.

- [ ] **Step 2: Commit**

```bash
git add client/src/pages/workflow-builder.tsx
git commit -m "feat(ui): cache projection in Convex after builder mount"
```

---

### Task C7: Update route + workflow list to use `engineWorkflowId`

**Files:**
- Modify: `client/src/App.tsx` — change `<Route path="/workflows/:id">` is already generic; ensure the param semantically means engineWorkflowId now.
- Find and update: `client/src/pages/workflows.tsx` (or wherever the list is) — navigation links must use `workflow.engineWorkflowId`, display must read `workflow.definition.name`.

- [ ] **Step 1: Locate the workflow list**

```bash
grep -rn "api.workflows.list\|/workflows/\\$" client/src 2>/dev/null
```

- [ ] **Step 2: Update links and labels**

Change:
- `href={`/workflows/${wf._id}`}` → `href={`/workflows/${wf.engineWorkflowId}`}`
- `{wf.name}` → `{wf.definition?.name ?? wf.engineWorkflowId}`

- [ ] **Step 3: Type-check**

```bash
bun run check
```

- [ ] **Step 4: Commit**

```bash
git add client/src client/src/App.tsx
git commit -m "feat(ui): use engineWorkflowId in routes and list"
```

---

### Task C8: VERIFY Part C end-to-end

- [ ] **Step 1: Full typecheck + lint**

```bash
bun run check
bunx biome check .
bun test
```
All three must pass.

- [ ] **Step 2: Manual E2E smoke test**

1. `bun run dev` + `bunx convex dev` in separate panes.
2. Log in, select an instance that has engine modules installed (triggers/actions catalog populated).
3. Go to Workflows → Create → basic-editor.
4. Pick a trigger (e.g. Cheer) + an action (e.g. Send Chat Message), fill required config.
5. Expand "Preview generated JSON" — confirm the JSON shape matches the spec's canonical schema.
6. Click Create Workflow.
7. Expect: a brief "creating…" state, navigation to `/workflows/<engineWorkflowId>`, canvas renders trigger + action nodes auto-laid-out.
8. Click "Preview JSON" in the builder toolbar — confirm it shows the same definition with an engine-minted `id`.
9. Click Save — confirm toast, no error.
10. Click Delete — confirm it navigates back and the workflow is gone from the list.

- [ ] **Step 3: Playwright (optional in v1 — add if time)**

If adding: a test that covers the smoke steps above, using Playwright's auto-wait for the navigation.

- [ ] **Step 4: Commit any test additions and push**

```bash
git push -u origin feat/workflow-json-first-ui
```

Open PR. Merge when green.

---

## Post-merge cleanup

- [ ] **Update Notion task(s)** for "Project: UI" → "JSON-first workflow CRUD" to Done.
- [ ] **Update `docs/ui/` VitePress pages** describing the new workflow creation path. The spec linked here is the reference; the product-area docs should summarize the flow for the team.

---

## Self-review notes (internal to plan author)

Checked against spec:
- Engine RPC shape change → Task A4, A5 (covers `createWorkflow`, `updateWorkflow`, `deleteWorkflow`, `setWorkflowEnabled`).
- Engine webhooks → Task A2, emission in A4.
- Engine validation → Task A3.
- Shared `WorkflowDefinition` type → Task A1.
- Convex schema changes → Task B1.
- Pending/completed tables → Task B1 + B4.
- Convex actions with correlation polling → Task B3.
- Webhook handler branches → Task B5.
- Cron → Task B6.
- Legacy cleanup → A5, A6, B7.
- `definitionToReactFlow` → Task C2.
- Dagre layout → Task C1, C2.
- Preset mapping → Task C3.
- Basic editor rewrite → Task C4.
- Visual builder rewrite → Task C5.
- Projection cache push → Task C6.
- URL / list updates → Task C7.
- Preview JSON → Task C4 (basic editor) + Task C5 (builder toolbar).
- Error handling / timeout → Task B3 (`waitForCompletion` with 10s).
- Testing → unit tests on validator (A3), projection (C2), preset mapping (C3); manual smoke (C8).

Gaps deliberately left out:
- Reconciliation job (out of scope per spec).
- Position persistence (out of scope per spec).
- Migration of existing rows (user-confirmed wipe).
- Playwright E2E (noted as optional in C8).
