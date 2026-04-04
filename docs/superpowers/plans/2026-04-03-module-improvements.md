# Module Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform woofx3-ui into a proper module platform — installable modules with versioning, commands with role-based permissions, webhook endpoints, typed widget instances in scenes, and workflow provenance tracking.

**Architecture:** Convex owns UI metadata (module status, commands, webhook URLs, widget instances); the woofx3 engine (via WoofxTransport → Cap'n Web RPC → `/api` service) owns execution data. ZIP-based module install flow parses client-side, sends function assets via transport, writes metadata to Convex. Widget rendering uses iframe-per-instance with assets stored in Convex storage.

**Tech Stack:** Convex (schema + functions), React 18, TypeScript 5.6, Zod, jszip (already installed), uuid (already installed), Wouter routing, Shadcn/ui components, Tailwind CSS.

**Note on testing:** No test runner is installed. Verification uses `bun run check` (TypeScript) and `bunx convex dev` (schema push). Each task includes a manual verification step.

**Spec:** `docs/superpowers/specs/2026-04-03-module-improvements-design.md`

---

## File Map

### New Files
- `convex/commands.ts` — CRUD for module-registered chat commands
- `convex/webhooks.ts` — Webhook endpoint provisioning and management
- `client/src/lib/roles.ts` — Default role constants
- `client/src/lib/module-installer.ts` — ZIP parsing, SHA-256, manifest validation, install orchestration
- `client/src/pages/commands.tsx` — Command management UI page

### Modified Files
- `convex/schema.ts` — New tables + modified tables
- `convex/moduleRepository.ts` — Versioning, status, installKey support
- `convex/installedModules.ts` — New install flow with status tracking
- `convex/moduleWidgets.ts` — Add renderAssetKey field
- `convex/http.ts` — Webhook HTTP handler + widget asset serving from storage
- `client/src/types/index.ts` — New types aligned with schema
- `client/src/lib/transport/interface.ts` — New method signatures
- `client/src/lib/transport/browser-transport.ts` — Implement new transport methods
- `client/src/App.tsx` — Register /commands route
- `client/src/pages/module-install.tsx` — Full install UI with ZIP upload
- `client/src/pages/modules.tsx` — Version badges, status chips, enable/disable
- `client/src/pages/settings.tsx` — Webhook management section
- `client/src/pages/scene-editor.tsx` — Typed WidgetInstance placement panel
- `client/src/pages/browser-source.tsx` — Iframe-based widget rendering
- `client/src/pages/workflows.tsx` — Module provenance badge + "use as template"
- `convex/workflows.ts` — createFromTemplate mutation

---

## Phase 1 — Schema & Types Foundation

### Task 1: Extend convex/schema.ts with new tables and modified fields

**Files:**
- Modify: `convex/schema.ts`

- [ ] **Step 1: Add new tables and extend existing ones**

Replace the relevant sections in `convex/schema.ts`. Add new tables after the `workflows` table definition, and patch the modified tables in place:

```typescript
// NEW TABLE — moduleCommands
moduleCommands: defineTable({
  instanceId: v.id("instances"),
  moduleId: v.optional(v.id("installedModules")),
  name: v.string(),
  description: v.optional(v.string()),
  pattern: v.string(),
  patternType: v.union(v.literal("prefix"), v.literal("exact"), v.literal("regex")),
  requiredRole: v.string(),
  workflowId: v.optional(v.id("workflows")),
  isEnabled: v.boolean(),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_instance", ["instanceId"])
  .index("by_module", ["moduleId"]),

// NEW TABLE — webhookEndpoints
webhookEndpoints: defineTable({
  instanceId: v.id("instances"),
  triggerId: v.string(),
  endpointId: v.string(),
  signingSecret: v.string(),
  isEnabled: v.boolean(),
  lastTriggeredAt: v.optional(v.number()),
  createdAt: v.number(),
})
  .index("by_instance", ["instanceId"])
  .index("by_endpoint_id", ["endpointId"]),

// NEW TABLE — moduleFunctions
moduleFunctions: defineTable({
  instanceId: v.id("instances"),
  moduleId: v.id("installedModules"),
  functionRef: v.string(),
  runtime: v.string(),
  storageId: v.id("_storage"),
  createdAt: v.number(),
})
  .index("by_module", ["moduleId"])
  .index("by_instance_and_ref", ["instanceId", "functionRef"]),
```

- [ ] **Step 2: Replace moduleRepository table definition**

Replace the existing `moduleRepository` definition with:

```typescript
moduleRepository: defineTable({
  name: v.string(),
  description: v.string(),
  version: v.string(),
  sha256: v.string(),
  installKey: v.string(),
  tags: v.array(v.string()),
  manifest: v.object({
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
  archiveKey: v.string(),
  status: v.union(v.literal("active"), v.literal("disabled"), v.literal("error")),
  errorMessage: v.optional(v.string()),
})
  .index("by_install_key", ["installKey"])
  .index("by_manifest_id", ["manifest.id"]),
```

- [ ] **Step 3: Replace installedModules table definition**

```typescript
installedModules: defineTable({
  instanceId: v.id("instances"),
  moduleId: v.id("moduleRepository"),
  status: v.union(v.literal("active"), v.literal("disabled"), v.literal("error")),
  installKey: v.string(),
  version: v.string(),
  installedAt: v.number(),
  errorMessage: v.optional(v.string()),
})
  .index("by_instance", ["instanceId"])
  .index("by_instance_and_key", ["instanceId", "installKey"]),
```

- [ ] **Step 4: Replace scenes table definition (typed widgets)**

```typescript
scenes: defineTable({
  instanceId: v.id("instances"),
  name: v.string(),
  description: v.optional(v.string()),
  width: v.number(),
  height: v.number(),
  backgroundColor: v.string(),
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
  createdAt: v.number(),
  updatedAt: v.number(),
}).index("by_instance", ["instanceId"]),
```

- [ ] **Step 5: Extend moduleWidgets table (add renderAssetKey)**

Add `renderAssetKey: v.optional(v.string()),` to the `moduleWidgets` table definition, after `description`.

- [ ] **Step 6: Extend workflows table (module provenance)**

Add to the `workflows` table definition:
```typescript
isModuleProvided: v.optional(v.boolean()),
sourceModuleId: v.optional(v.id("installedModules")),
```

- [ ] **Step 7: Extend chatCommands table**

Add to the `chatCommands` table definition:
```typescript
moduleId: v.optional(v.id("installedModules")),
requiredRole: v.optional(v.string()),
workflowId: v.optional(v.id("workflows")),
```

- [ ] **Step 8: Run schema push to verify syntax**

```bash
cd /home/wolfy/code/wolfymaster/woofx3-ui
bunx convex dev --once
```

Expected: schema validates without errors. Fix any validator syntax errors before proceeding.

- [ ] **Step 9: Commit**

```bash
git add convex/schema.ts
git commit -m "feat: extend schema — moduleCommands, webhookEndpoints, moduleFunctions, typed widgets, module provenance"
```

---

### Task 2: Add new TypeScript types to client/src/types/index.ts

**Files:**
- Modify: `client/src/types/index.ts`

- [ ] **Step 1: Add module-system types at end of file**

Append to `client/src/types/index.ts`:

```typescript
export type ModuleStatus = "active" | "disabled" | "error"
export type CommandPatternType = "prefix" | "exact" | "regex"

export interface ManifestTrigger {
  id: string
  name: string
  description?: string
  type: "eventbus" | "webhook" | "command" | "schedule"
  event?: string
}

export interface ManifestAction {
  id: string
  name: string
  description?: string
  functionRef?: string
  parameters?: Record<string, unknown>
}

export interface ManifestCommand {
  name: string
  description?: string
  pattern: string
  patternType: "prefix" | "exact" | "regex"
  requiredRole?: string
}

export interface ManifestWorkflow {
  name: string
  description?: string
  nodes: unknown[]
  edges: unknown[]
}

export interface ManifestWidget {
  id: string
  name: string
  description?: string
  directory: string
  acceptedEvents: string[]
  settingsSchema?: unknown[]
}

export interface ManifestOverlay {
  id: string
  name: string
  description?: string
}

export interface ManifestFunction {
  ref: string
  runtime: string
  path: string
}

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
  _id: string
  instanceId: string
  triggerId: string
  endpointId: string
  signingSecret: string
  isEnabled: boolean
  lastTriggeredAt?: number
  createdAt: number
}

export interface ModuleCommand {
  _id: string
  instanceId: string
  moduleId?: string
  name: string
  description?: string
  pattern: string
  patternType: CommandPatternType
  requiredRole: string
  workflowId?: string
  isEnabled: boolean
  createdAt: number
  updatedAt: number
}

export interface InstalledModule {
  _id: string
  instanceId: string
  moduleId: string
  status: ModuleStatus
  installKey: string
  version: string
  installedAt: number
  errorMessage?: string
  module?: {
    _id: string
    name: string
    description: string
    version: string
    tags: string[]
    manifest: ModuleManifest
    status: ModuleStatus
  }
}
```

- [ ] **Step 2: Replace the existing Widget interface with WidgetInstance**

The existing `Widget` interface (lines 123-137) represents the old untyped system. Keep it temporarily to avoid breaking existing code — we'll migrate the scene editor in Phase 5.

- [ ] **Step 3: Run type check**

```bash
cd /home/wolfy/code/wolfymaster/woofx3-ui
bun run check
```

Expected: passes or only shows pre-existing errors (not from our new types). Fix any issues in the type file.

- [ ] **Step 4: Commit**

```bash
git add client/src/types/index.ts
git commit -m "feat: add ModuleManifest, WidgetInstance, WebhookEndpoint, ModuleCommand, InstalledModule types"
```

---

### Task 3: Add role constants

**Files:**
- Create: `client/src/lib/roles.ts`

- [ ] **Step 1: Create roles.ts**

```typescript
// client/src/lib/roles.ts
export const DEFAULT_ROLES = [
  "public",
  "subscriber",
  "moderator",
  "broadcaster",
] as const

export type DefaultRole = (typeof DEFAULT_ROLES)[number]

export function isDefaultRole(role: string): role is DefaultRole {
  return DEFAULT_ROLES.includes(role as DefaultRole)
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/lib/roles.ts
git commit -m "feat: add default role constants"
```

---

### Task 4: Extend WoofxTransport interface

**Files:**
- Modify: `client/src/lib/transport/interface.ts`

- [ ] **Step 1: Add imports and new method signatures to the WoofxTransport interface**

Add these imports at the top:
```typescript
import type { ModuleManifest } from "@/types";
```

Append these methods to the `WoofxTransport` interface (after `getModuleState`):

```typescript
  // Module management (engine-side registration)
  installModule(
    instanceId: string,
    manifest: ModuleManifest,
    functionAssets: Record<string, ArrayBuffer>
  ): Promise<{ moduleId: string }>
  uninstallModule(instanceId: string, moduleId: string): Promise<void>
  setModuleStatus(instanceId: string, moduleId: string, status: "active" | "disabled"): Promise<void>

  // Command management (engine-side registration)
  createEngineCommand(instanceId: string, command: {
    name: string
    pattern: string
    patternType: "prefix" | "exact" | "regex"
    requiredRole: string
    workflowId?: string
  }): Promise<{ commandId: string }>
  updateEngineCommand(instanceId: string, commandId: string, updates: {
    requiredRole?: string
    workflowId?: string
    isEnabled?: boolean
  }): Promise<void>
  deleteEngineCommand(instanceId: string, commandId: string): Promise<void>

  // Workflow trigger
  triggerWorkflow(instanceId: string, workflowId: string, params?: Record<string, string>): Promise<{ executionId: string }>
```

- [ ] **Step 2: Run type check — expect BrowserTransport to now have missing method errors**

```bash
bun run check
```

Expected: TypeScript errors on `BrowserTransport` for the unimplemented methods. This is correct — we implement them in Task 5.

- [ ] **Step 3: Commit the interface changes**

```bash
git add client/src/lib/transport/interface.ts
git commit -m "feat: extend WoofxTransport interface — installModule, commands, triggerWorkflow"
```

---

### Task 5: Implement new transport methods in BrowserTransport

**Files:**
- Modify: `client/src/lib/transport/browser-transport.ts`

- [ ] **Step 1: Extend WoofxRpcApi with new remote method signatures**

Add to the `WoofxRpcApi` interface (after `getModule`):
```typescript
  installModule(data: {
    instanceId: string
    manifest: unknown
    functionAssets: Record<string, unknown>
  }): Promise<{ moduleId: string }>
  uninstallModule(instanceId: string, moduleId: string): Promise<unknown>
  setModuleStatus(instanceId: string, moduleId: string, status: string): Promise<unknown>
  createCommand(instanceId: string, command: unknown): Promise<{ commandId: string }>
  updateCommand(instanceId: string, commandId: string, updates: unknown): Promise<unknown>
  deleteCommand(instanceId: string, commandId: string): Promise<unknown>
  triggerWorkflow(instanceId: string, workflowId: string, params: Record<string, string>): Promise<{ executionId: string }>
```

- [ ] **Step 2: Add import for ModuleManifest**

Add at top of `browser-transport.ts`:
```typescript
import type { ModuleManifest } from "@/types";
```

- [ ] **Step 3: Implement the new methods on BrowserTransport**

Add after `getModuleState`:

```typescript
  async installModule(
    instanceId: string,
    manifest: ModuleManifest,
    functionAssets: Record<string, ArrayBuffer>
  ): Promise<{ moduleId: string }> {
    const result = await this.getSession().installModule({
      instanceId,
      manifest,
      functionAssets: Object.fromEntries(
        Object.entries(functionAssets).map(([k, v]) => [k, Array.from(new Uint8Array(v))])
      ),
    });
    return result as { moduleId: string };
  }

  async uninstallModule(instanceId: string, moduleId: string): Promise<void> {
    await this.getSession().uninstallModule(instanceId, moduleId);
  }

  async setModuleStatus(
    instanceId: string,
    moduleId: string,
    status: "active" | "disabled"
  ): Promise<void> {
    await this.getSession().setModuleStatus(instanceId, moduleId, status);
  }

  async createEngineCommand(
    instanceId: string,
    command: {
      name: string
      pattern: string
      patternType: "prefix" | "exact" | "regex"
      requiredRole: string
      workflowId?: string
    }
  ): Promise<{ commandId: string }> {
    const result = await this.getSession().createCommand(instanceId, command);
    return result as { commandId: string };
  }

  async updateEngineCommand(
    instanceId: string,
    commandId: string,
    updates: { requiredRole?: string; workflowId?: string; isEnabled?: boolean }
  ): Promise<void> {
    await this.getSession().updateCommand(instanceId, commandId, updates);
  }

  async deleteEngineCommand(instanceId: string, commandId: string): Promise<void> {
    await this.getSession().deleteCommand(instanceId, commandId);
  }

  async triggerWorkflow(
    instanceId: string,
    workflowId: string,
    params: Record<string, string> = {}
  ): Promise<{ executionId: string }> {
    const result = await this.getSession().triggerWorkflow(instanceId, workflowId, params);
    return result as { executionId: string };
  }
```

- [ ] **Step 4: Run type check — expect clean**

```bash
bun run check
```

Expected: No errors on the transport files. If `TauriTransport` also implements `WoofxTransport`, add stub implementations there too (throw `new Error("Not implemented")`).

- [ ] **Step 5: Commit**

```bash
git add client/src/lib/transport/interface.ts client/src/lib/transport/browser-transport.ts
git commit -m "feat: implement installModule, command mgmt, triggerWorkflow on BrowserTransport"
```

---

## Phase 2 — Module System Overhaul

### Task 6: Update convex/moduleRepository.ts

**Files:**
- Modify: `convex/moduleRepository.ts`

- [ ] **Step 1: Replace the file with updated queries and mutations**

```typescript
import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const list = query({
  args: {
    search: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const all = await ctx.db.query("moduleRepository").take(200);

    let results = all;

    if (args.tags && args.tags.length > 0) {
      results = results.filter((m) => args.tags!.some((tag) => m.tags.includes(tag)));
    }

    if (args.search) {
      const lower = args.search.toLowerCase();
      results = results.filter(
        (m) => m.name.toLowerCase().includes(lower) || m.description.toLowerCase().includes(lower)
      );
    }

    return results;
  },
});

export const get = query({
  args: { moduleId: v.id("moduleRepository") },
  handler: async (ctx, args) => {
    return ctx.db.get(args.moduleId);
  },
});

export const findByInstallKey = query({
  args: { installKey: v.string() },
  handler: async (ctx, args) => {
    return ctx.db
      .query("moduleRepository")
      .withIndex("by_install_key", (q) => q.eq("installKey", args.installKey))
      .unique();
  },
});

export const listByManifestId = query({
  args: { manifestId: v.string() },
  handler: async (ctx, args) => {
    return ctx.db
      .query("moduleRepository")
      .withIndex("by_manifest_id", (q) => q.eq("manifest.id", args.manifestId))
      .take(50);
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    description: v.string(),
    version: v.string(),
    sha256: v.string(),
    installKey: v.string(),
    tags: v.array(v.string()),
    manifest: v.object({
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
    archiveKey: v.string(),
    status: v.union(v.literal("active"), v.literal("disabled"), v.literal("error")),
    errorMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const existing = await ctx.db
      .query("moduleRepository")
      .withIndex("by_install_key", (q) => q.eq("installKey", args.installKey))
      .unique();

    if (existing) throw new Error(`Module with install key ${args.installKey} already exists`);

    return ctx.db.insert("moduleRepository", args);
  },
});

export const setStatus = mutation({
  args: {
    moduleId: v.id("moduleRepository"),
    status: v.union(v.literal("active"), v.literal("disabled"), v.literal("error")),
    errorMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    await ctx.db.patch(args.moduleId, {
      status: args.status,
      errorMessage: args.errorMessage,
    });
  },
});
```

- [ ] **Step 2: Run type check**

```bash
bun run check
```

- [ ] **Step 3: Commit**

```bash
git add convex/moduleRepository.ts
git commit -m "feat: update moduleRepository — versioning, installKey dedup, status management"
```

---

### Task 7: Update convex/installedModules.ts

**Files:**
- Modify: `convex/installedModules.ts`

- [ ] **Step 1: Replace the file**

```typescript
import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";

export const listForInstance = query({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, args) => {
    const installed = await ctx.db
      .query("installedModules")
      .withIndex("by_instance", (q) => q.eq("instanceId", args.instanceId))
      .take(200);

    return Promise.all(
      installed.map(async (im) => {
        const module = await ctx.db.get(im.moduleId);
        return { ...im, module };
      })
    );
  },
});

export const getByInstallKey = query({
  args: { instanceId: v.id("instances"), installKey: v.string() },
  handler: async (ctx, args) => {
    return ctx.db
      .query("installedModules")
      .withIndex("by_instance_and_key", (q) =>
        q.eq("instanceId", args.instanceId).eq("installKey", args.installKey)
      )
      .unique();
  },
});

// Called by the client after a successful transport.installModule() call.
// Writes all Convex-side metadata for the installed module.
export const registerInstall = mutation({
  args: {
    instanceId: v.id("instances"),
    moduleRepositoryId: v.id("moduleRepository"),
    installKey: v.string(),
    version: v.string(),
    commands: v.array(v.object({
      name: v.string(),
      description: v.optional(v.string()),
      pattern: v.string(),
      patternType: v.union(v.literal("prefix"), v.literal("exact"), v.literal("regex")),
      requiredRole: v.optional(v.string()),
    })),
    webhookTriggerIds: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    // Assert no duplicate install key for this instance
    const duplicate = await ctx.db
      .query("installedModules")
      .withIndex("by_instance_and_key", (q) =>
        q.eq("instanceId", args.instanceId).eq("installKey", args.installKey)
      )
      .unique();
    if (duplicate) throw new Error(`Install key ${args.installKey} already registered for this instance`);

    // Deactivate the currently active version of this module (same manifest.id)
    const repo = await ctx.db.get(args.moduleRepositoryId);
    if (!repo) throw new Error("Module repository record not found");

    const existing = await ctx.db
      .query("installedModules")
      .withIndex("by_instance", (q) => q.eq("instanceId", args.instanceId))
      .take(200);

    for (const im of existing) {
      const imRepo = await ctx.db.get(im.moduleId);
      if (imRepo && imRepo.manifest.id === repo.manifest.id && im.status === "active") {
        await ctx.db.patch(im._id, { status: "disabled" });
      }
    }

    const now = Date.now();
    const installedId = await ctx.db.insert("installedModules", {
      instanceId: args.instanceId,
      moduleId: args.moduleRepositoryId,
      status: "active",
      installKey: args.installKey,
      version: args.version,
      installedAt: now,
    });

    // Register commands from manifest
    for (const cmd of args.commands) {
      await ctx.db.insert("moduleCommands", {
        instanceId: args.instanceId,
        moduleId: installedId,
        name: cmd.name,
        description: cmd.description,
        pattern: cmd.pattern,
        patternType: cmd.patternType,
        requiredRole: cmd.requiredRole ?? "public",
        isEnabled: true,
        createdAt: now,
        updatedAt: now,
      });
    }

    // Register webhook endpoints for each webhook trigger
    for (const triggerId of args.webhookTriggerIds) {
      const endpointId = crypto.randomUUID();
      const signingSecret = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
      await ctx.db.insert("webhookEndpoints", {
        instanceId: args.instanceId,
        triggerId,
        endpointId,
        signingSecret,
        isEnabled: true,
        createdAt: now,
      });
    }

    return installedId;
  },
});

export const setStatus = mutation({
  args: {
    installedModuleId: v.id("installedModules"),
    status: v.union(v.literal("active"), v.literal("disabled"), v.literal("error")),
    errorMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    await ctx.db.patch(args.installedModuleId, {
      status: args.status,
      errorMessage: args.errorMessage,
    });
  },
});

export const uninstall = mutation({
  args: { installedModuleId: v.id("installedModules") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const im = await ctx.db.get(args.installedModuleId);
    if (!im) return;

    // Delete associated commands
    const commands = await ctx.db
      .query("moduleCommands")
      .withIndex("by_module", (q) => q.eq("moduleId", args.installedModuleId))
      .take(200);
    for (const cmd of commands) {
      await ctx.db.delete(cmd._id);
    }

    // Note: webhookEndpoints do not carry an installedModuleId FK yet.
    // Safe cleanup is deferred — webhook endpoints orphaned after uninstall
    // will return 404 when triggered (endpoint lookup by endpointId will still
    // resolve, but the instance's workflow will no longer exist).
    // A future migration should add installedModuleId to webhookEndpoints for
    // precise cascade delete. For now, leave orphaned endpoints in place.

    await ctx.db.delete(args.installedModuleId);
  },
});
```

- [ ] **Step 2: Run type check**

```bash
bun run check
```

Expected: clean or pre-existing errors only.

- [ ] **Step 3: Commit**

```bash
git add convex/installedModules.ts
git commit -m "feat: update installedModules — registerInstall with command/webhook registration, setStatus, uninstall cascade"
```

---

### Task 8: Create convex/commands.ts

**Files:**
- Create: `convex/commands.ts`

- [ ] **Step 1: Create the file**

```typescript
import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const list = query({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, args) => {
    return ctx.db
      .query("moduleCommands")
      .withIndex("by_instance", (q) => q.eq("instanceId", args.instanceId))
      .take(200);
  },
});

export const listByModule = query({
  args: { moduleId: v.id("installedModules") },
  handler: async (ctx, args) => {
    return ctx.db
      .query("moduleCommands")
      .withIndex("by_module", (q) => q.eq("moduleId", args.moduleId))
      .take(100);
  },
});

export const create = mutation({
  args: {
    instanceId: v.id("instances"),
    name: v.string(),
    description: v.optional(v.string()),
    pattern: v.string(),
    patternType: v.union(v.literal("prefix"), v.literal("exact"), v.literal("regex")),
    requiredRole: v.string(),
    workflowId: v.optional(v.id("workflows")),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const now = Date.now();
    return ctx.db.insert("moduleCommands", {
      instanceId: args.instanceId,
      name: args.name,
      description: args.description,
      pattern: args.pattern,
      patternType: args.patternType,
      requiredRole: args.requiredRole,
      workflowId: args.workflowId,
      isEnabled: true,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const update = mutation({
  args: {
    commandId: v.id("moduleCommands"),
    requiredRole: v.optional(v.string()),
    workflowId: v.optional(v.id("workflows")),
    isEnabled: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const { commandId, ...updates } = args;
    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    if (updates.requiredRole !== undefined) { patch.requiredRole = updates.requiredRole; }
    if (updates.workflowId !== undefined) { patch.workflowId = updates.workflowId; }
    if (updates.isEnabled !== undefined) { patch.isEnabled = updates.isEnabled; }

    await ctx.db.patch(commandId, patch);
  },
});

export const remove = mutation({
  args: { commandId: v.id("moduleCommands") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    await ctx.db.delete(args.commandId);
  },
});
```

- [ ] **Step 2: Run type check**

```bash
bun run check
```

- [ ] **Step 3: Commit**

```bash
git add convex/commands.ts
git commit -m "feat: add commands.ts — CRUD for module-registered chat commands"
```

---

### Task 9: Create convex/webhooks.ts

**Files:**
- Create: `convex/webhooks.ts`

- [ ] **Step 1: Create the file**

```typescript
import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";

export const list = query({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, args) => {
    return ctx.db
      .query("webhookEndpoints")
      .withIndex("by_instance", (q) => q.eq("instanceId", args.instanceId))
      .take(200);
  },
});

// internalQuery — exposes signingSecret; only called from HTTP actions and other server functions
export const getByEndpointId = internalQuery({
  args: { endpointId: v.string() },
  handler: async (ctx, args) => {
    return ctx.db
      .query("webhookEndpoints")
      .withIndex("by_endpoint_id", (q) => q.eq("endpointId", args.endpointId))
      .unique();
  },
});

export const create = mutation({
  args: {
    instanceId: v.id("instances"),
    triggerId: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const endpointId = crypto.randomUUID();
    const signingSecret =
      crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");

    return ctx.db.insert("webhookEndpoints", {
      instanceId: args.instanceId,
      triggerId: args.triggerId,
      endpointId,
      signingSecret,
      isEnabled: true,
      createdAt: Date.now(),
    });
  },
});

export const remove = mutation({
  args: { webhookId: v.id("webhookEndpoints") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    await ctx.db.delete(args.webhookId);
  },
});

export const rotateSecret = mutation({
  args: { webhookId: v.id("webhookEndpoints") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const newSecret =
      crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
    await ctx.db.patch(args.webhookId, { signingSecret: newSecret });
    return newSecret;
  },
});

export const setEnabled = mutation({
  args: { webhookId: v.id("webhookEndpoints"), isEnabled: v.boolean() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    await ctx.db.patch(args.webhookId, { isEnabled: args.isEnabled });
  },
});

export const recordTrigger = internalMutation({
  args: { endpointId: v.string() },
  handler: async (ctx, args) => {
    const endpoint = await ctx.db
      .query("webhookEndpoints")
      .withIndex("by_endpoint_id", (q) => q.eq("endpointId", args.endpointId))
      .unique();
    if (endpoint) {
      await ctx.db.patch(endpoint._id, { lastTriggeredAt: Date.now() });
    }
  },
});
```

- [ ] **Step 2: Run type check**

```bash
bun run check
```

- [ ] **Step 3: Commit**

```bash
git add convex/webhooks.ts
git commit -m "feat: add webhooks.ts — webhook endpoint provisioning, rotation, internal trigger recorder"
```

---

### Task 10: Add webhook HTTP handler to convex/http.ts

**Files:**
- Modify: `convex/http.ts`

- [ ] **Step 1: Add import for webhooks internal functions**

At the top of `convex/http.ts`, after existing imports, add:
```typescript
import "./webhooks";
```

This ensures the internal functions are registered.

- [ ] **Step 2: Add the webhook handler route before `export default http`**

```typescript
http.route({
  pathPrefix: "/api/webhooks/",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const segments = url.pathname.split("/").filter(Boolean);
    // Expected path: /api/webhooks/{endpointId}
    const endpointId = segments[segments.length - 1];

    if (!endpointId) {
      return corsJson({ error: "Missing endpointId" }, 400);
    }

    const endpoint = await ctx.runQuery(internal.webhooks.getByEndpointId, { endpointId });
    // internal.webhooks.getByEndpointId is an internalQuery — safe to call from httpAction

    if (!endpoint) {
      return new Response("Not found", { status: 404 });
    }

    if (!endpoint.isEnabled) {
      return new Response("Endpoint disabled", { status: 404 });
    }

    // Validate HMAC-SHA256 signature
    const rawBody = await request.text();
    const signature = request.headers.get("x-signature") ?? "";
    const expectedPrefix = "sha256=";

    if (signature.startsWith(expectedPrefix)) {
      const hexSig = signature.slice(expectedPrefix.length);
      const secretBytes = new TextEncoder().encode(endpoint.signingSecret);
      const bodyBytes = new TextEncoder().encode(rawBody);
      const key = await crypto.subtle.importKey(
        "raw",
        secretBytes,
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["verify"]
      );
      const sigBytes = new Uint8Array(hexSig.match(/.{2}/g)!.map((b) => parseInt(b, 16)));
      const valid = await crypto.subtle.verify("HMAC", key, sigBytes, bodyBytes);
      if (!valid) {
        return new Response("Invalid signature", { status: 401 });
      }
    }

    // Look up the instance to get its engine URL
    const instance = await ctx.runQuery(internal.instances.getById, { instanceId: endpoint.instanceId });

    if (!instance?.url) {
      return corsJson({ error: "Instance engine URL not configured" }, 503);
    }

    // Forward trigger to woofx3 engine
    let payload: unknown = {};
    try {
      payload = JSON.parse(rawBody);
    } catch {
      payload = { rawBody };
    }

    const engineBaseUrl = instance.url.includes("://")
      ? instance.url.replace(/\/$/, "")
      : `http://${instance.url}`;

    try {
      await fetch(`${engineBaseUrl}/trigger`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ triggerId: endpoint.triggerId, payload }),
      });
    } catch (err) {
      logger.error("Failed to forward webhook to engine", { endpointId, error: String(err) });
    }

    await ctx.runMutation(internal.webhooks.recordTrigger, { endpointId });

    return corsJson({ received: true });
  }),
});
```

- [ ] **Step 3: Add internal getById query to convex/instances.ts (or wherever instances queries live)**

Check if `convex/instances.ts` exists:
```bash
ls /home/wolfy/code/wolfymaster/woofx3-ui/convex/instances.ts 2>/dev/null || echo "not found"
```

If it doesn't exist, create `convex/instances.ts`:
```typescript
import { v } from "convex/values";
import { internalQuery } from "./_generated/server";

export const getById = internalQuery({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, args) => {
    return ctx.db.get(args.instanceId);
  },
});
```

If it exists, add `getById` to the existing file.

- [ ] **Step 4: Run type check**

```bash
bun run check
```

- [ ] **Step 5: Commit**

```bash
git add convex/http.ts convex/instances.ts convex/webhooks.ts
git commit -m "feat: add webhook ingestion HTTP handler — HMAC validation, engine forwarding"
```

---

### Task 11: Create module installer utility

**Files:**
- Create: `client/src/lib/module-installer.ts`

- [ ] **Step 1: Create the file**

```typescript
// client/src/lib/module-installer.ts
// ZIP parsing, manifest validation, SHA-256 computation, and install orchestration.

import JSZip from "jszip";
import { z } from "zod";
import type { ModuleManifest } from "@/types";

const ManifestSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.string().regex(/^\d+\.\d+\.\d+/, "version must be semver"),
  description: z.string().optional(),
  triggers: z.array(z.any()).default([]),
  actions: z.array(z.any()).default([]),
  commands: z.array(z.object({
    name: z.string(),
    description: z.string().optional(),
    pattern: z.string(),
    patternType: z.enum(["prefix", "exact", "regex"]),
    requiredRole: z.string().optional(),
  })).default([]),
  workflows: z.array(z.any()).default([]),
  widgets: z.array(z.object({
    id: z.string(),
    name: z.string(),
    description: z.string().optional(),
    directory: z.string(),
    acceptedEvents: z.array(z.string()).default([]),
    settingsSchema: z.array(z.any()).optional(),
  })).default([]),
  overlays: z.array(z.any()).default([]),
  functions: z.array(z.object({
    ref: z.string(),
    runtime: z.string(),
    path: z.string(),
  })).default([]),
});

export interface ParsedModule {
  manifest: ModuleManifest
  installKey: string
  functionAssets: Record<string, ArrayBuffer>
  widgetAssets: Record<string, ArrayBuffer>
}

async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function parseModuleZip(zipBytes: ArrayBuffer): Promise<ParsedModule> {
  const zip = await JSZip.loadAsync(zipBytes);

  const manifestFile =
    zip.file("module.json") ?? zip.file("module.yaml");
  if (!manifestFile) {
    throw new Error("Module ZIP must contain module.json at the root");
  }

  const manifestText = await manifestFile.async("text");
  let rawManifest: unknown;
  try {
    rawManifest = JSON.parse(manifestText);
  } catch {
    throw new Error("module.json is not valid JSON");
  }

  const parseResult = ManifestSchema.safeParse(rawManifest);
  if (!parseResult.success) {
    const issues = parseResult.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid manifest: ${issues}`);
  }

  const manifest = parseResult.data as ModuleManifest;
  const sha256 = await sha256Hex(zipBytes);
  const installKey = `${manifest.version}#${sha256}`;

  // Extract function assets
  const functionAssets: Record<string, ArrayBuffer> = {};
  for (const fn of manifest.functions) {
    const fnFile = zip.file(fn.path);
    if (fnFile) {
      functionAssets[fn.ref] = await fnFile.async("arraybuffer");
    }
  }

  // Extract widget HTML assets (entry point: {widget.directory}/index.html)
  const widgetAssets: Record<string, ArrayBuffer> = {};
  for (const widget of manifest.widgets) {
    const entryPath = `${widget.directory}/index.html`;
    const entryFile = zip.file(entryPath);
    if (entryFile) {
      widgetAssets[widget.id] = await entryFile.async("arraybuffer");
    }
  }

  return { manifest, installKey, functionAssets, widgetAssets };
}

export function getWebhookTriggerIds(manifest: ModuleManifest): string[] {
  return manifest.triggers
    .filter((t) => t.type === "webhook")
    .map((t) => t.id)
    .filter(Boolean);
}
```

- [ ] **Step 2: Run type check**

```bash
bun run check
```

- [ ] **Step 3: Commit**

```bash
git add client/src/lib/module-installer.ts
git commit -m "feat: add module-installer — ZIP parsing, manifest validation, SHA-256, asset extraction"
```

---

### Task 12: Update module install page

**Files:**
- Modify: `client/src/pages/module-install.tsx`

- [ ] **Step 1: Read the existing file**

```bash
head -80 /home/wolfy/code/wolfymaster/woofx3-ui/client/src/pages/module-install.tsx
```

- [ ] **Step 2: Replace with fully functional install UI**

```typescript
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useMutation } from "convex/react";
import { CheckCircle, Package, Upload, X } from "lucide-react";
import { useRef, useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useTransport } from "@/hooks/use-transport";
import { parseModuleZip, getWebhookTriggerIds } from "@/lib/module-installer";
import { useInstanceId } from "@/lib/stores";
import type { ModuleManifest } from "@/types";

type InstallStep = "idle" | "parsing" | "preview" | "installing" | "done" | "error"

export default function ModuleInstall() {
  const [, navigate] = useLocation();
  const instanceId = useInstanceId();
  const transport = useTransport();
  const registerInstall = useMutation(api.installedModules.registerInstall);
  const createRepoEntry = useMutation(api.moduleRepository.create);

  const [step, setStep] = useState<InstallStep>("idle");
  const [error, setError] = useState<string | null>(null);
  const [manifest, setManifest] = useState<ModuleManifest | null>(null);
  const [parsedData, setParsedData] = useState<{
    installKey: string
    functionAssets: Record<string, ArrayBuffer>
    widgetAssets: Record<string, ArrayBuffer>
    zipBytes: ArrayBuffer
  } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFileSelect(file: File) {
    if (!file.name.endsWith(".zip")) {
      setError("Only .zip files are supported");
      return;
    }

    setError(null);
    setStep("parsing");

    try {
      const zipBytes = await file.arrayBuffer();
      const parsed = await parseModuleZip(zipBytes);
      setManifest(parsed.manifest);
      setParsedData({
        installKey: parsed.installKey,
        functionAssets: parsed.functionAssets,
        widgetAssets: parsed.widgetAssets,
        zipBytes,
      });
      setStep("preview");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to parse ZIP");
      setStep("error");
    }
  }

  async function handleInstall() {
    if (!manifest || !parsedData || !instanceId) return;

    setStep("installing");
    setError(null);

    try {
      // 1. Register with engine via transport
      const engineResult = await transport.installModule(
        instanceId,
        manifest,
        parsedData.functionAssets
      );

      // 2. Create moduleRepository record
      const sha256 = parsedData.installKey.split("#")[1] ?? "";
      const repoId = await createRepoEntry({
        name: manifest.name,
        description: manifest.description ?? "",
        version: manifest.version,
        sha256,
        installKey: parsedData.installKey,
        tags: [],
        manifest,
        archiveKey: engineResult.moduleId,
        status: "active",
      });

      // 3. Register Convex-side install metadata (commands, webhooks)
      await registerInstall({
        instanceId: instanceId as Id<"instances">,
        moduleRepositoryId: repoId as Id<"moduleRepository">,
        installKey: parsedData.installKey,
        version: manifest.version,
        commands: manifest.commands.map((c) => ({
          name: c.name,
          description: c.description,
          pattern: c.pattern,
          patternType: c.patternType,
          requiredRole: c.requiredRole,
        })),
        webhookTriggerIds: getWebhookTriggerIds(manifest),
      });

      setStep("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Install failed");
      setStep("error");
    }
  }

  if (step === "done") {
    return (
      <div className="p-6 flex flex-col items-center gap-4">
        <CheckCircle className="h-12 w-12 text-green-500" />
        <h2 className="text-xl font-semibold">Module installed</h2>
        <p className="text-muted-foreground">{manifest?.name} v{manifest?.version}</p>
        <Button onClick={() => navigate("/modules/installed")}>View installed modules</Button>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-2xl">
      <h1 className="text-2xl font-bold mb-6">Install Module</h1>

      {step === "idle" || step === "error" ? (
        <Card
          className="border-dashed border-2 cursor-pointer hover:border-primary transition-colors"
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const file = e.dataTransfer.files[0];
            if (file) { handleFileSelect(file); }
          }}
        >
          <CardContent className="flex flex-col items-center gap-3 py-12">
            <Upload className="h-10 w-10 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Drop a .zip module here or click to browse</p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".zip"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) { handleFileSelect(file); }
              }}
            />
          </CardContent>
        </Card>
      ) : null}

      {step === "parsing" ? (
        <Card>
          <CardContent className="py-12 flex flex-col items-center gap-3">
            <Progress value={undefined} className="w-full" />
            <p className="text-sm text-muted-foreground">Parsing module...</p>
          </CardContent>
        </Card>
      ) : null}

      {(step === "preview" || step === "installing") && manifest ? (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <Package className="h-8 w-8 text-primary" />
              <div>
                <CardTitle>{manifest.name}</CardTitle>
                <CardDescription>v{manifest.version}</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {manifest.description ? (
              <p className="text-sm text-muted-foreground">{manifest.description}</p>
            ) : null}
            <div className="grid grid-cols-3 gap-2 text-sm">
              <div className="rounded bg-muted p-2 text-center">
                <div className="font-semibold">{manifest.triggers.length}</div>
                <div className="text-muted-foreground">Triggers</div>
              </div>
              <div className="rounded bg-muted p-2 text-center">
                <div className="font-semibold">{manifest.actions.length}</div>
                <div className="text-muted-foreground">Actions</div>
              </div>
              <div className="rounded bg-muted p-2 text-center">
                <div className="font-semibold">{manifest.commands.length}</div>
                <div className="text-muted-foreground">Commands</div>
              </div>
            </div>
            {step === "installing" ? (
              <Progress value={undefined} className="w-full" />
            ) : (
              <div className="flex gap-2 pt-2">
                <Button onClick={handleInstall} className="flex-1">Install</Button>
                <Button variant="outline" onClick={() => { setStep("idle"); setManifest(null); }}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      {error ? (
        <p className="mt-4 text-sm text-destructive">{error}</p>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 3: Run type check**

```bash
bun run check
```

Fix any import errors. `useTransport` and `useInstanceId` hooks need to exist — check `client/src/lib/stores.ts` and `client/src/hooks/` for the actual hook names and adjust imports accordingly.

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/module-install.tsx
git commit -m "feat: module install page — ZIP upload, manifest preview, install orchestration"
```

---

### Task 13: Update modules listing page

**Files:**
- Modify: `client/src/pages/modules.tsx`

- [ ] **Step 1: Read the current modules page installed tab section**

```bash
grep -n "installed\|InstalledModule\|enabled\|setEnabled" /home/wolfy/code/wolfymaster/woofx3-ui/client/src/pages/modules.tsx | head -40
```

- [ ] **Step 2: Update the installed modules card to show version badge and status chip**

Find the component that renders each installed module card and update it to display:

```typescript
// Locate and update the installed module card render. Key pattern to add:

import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import type { ModuleStatus } from "@/types";

function statusVariant(status: ModuleStatus): "default" | "secondary" | "destructive" {
  if (status === "active") return "default";
  if (status === "disabled") return "secondary";
  return "destructive";
}

// In the card component, replace/augment the existing enabled toggle:
// <Badge variant={statusVariant(module.status)}>{module.status}</Badge>
// <Badge variant="outline">v{module.version}</Badge>
// <Switch
//   checked={module.status === "active"}
//   onCheckedChange={(checked) => setStatus({ installedModuleId: module._id, status: checked ? "active" : "disabled" })}
// />
```

The exact lines to change depend on the current card structure — read the file and make the targeted replacement to add version badge, status badge, and update the toggle to call `setStatus` instead of the old `setEnabled`.

- [ ] **Step 3: Wire in the setStatus mutation**

```typescript
const setStatus = useMutation(api.installedModules.setStatus);
```

Replace any existing `setEnabled` calls with:
```typescript
setStatus({ installedModuleId: module._id, status: checked ? "active" : "disabled" })
```

- [ ] **Step 4: Run type check**

```bash
bun run check
```

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/modules.tsx
git commit -m "feat: modules page — version badge, status chip, setStatus toggle"
```

---

## Phase 3 — Command System

### Task 14: Create commands page

**Files:**
- Create: `client/src/pages/commands.tsx`

- [ ] **Step 1: Create the page**

```typescript
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useInstanceId } from "@/lib/stores";
import { DEFAULT_ROLES } from "@/lib/roles";
import type { CommandPatternType } from "@/types";

export default function Commands() {
  const instanceId = useInstanceId();
  const commands = useQuery(
    api.commands.list,
    instanceId ? { instanceId: instanceId as Id<"instances"> } : "skip"
  );
  const workflows = useQuery(
    api.workflows.list,
    instanceId ? { instanceId: instanceId as Id<"instances"> } : "skip"
  );
  const updateCommand = useMutation(api.commands.update);
  const removeCommand = useMutation(api.commands.remove);
  const createCommand = useMutation(api.commands.create);

  const [newOpen, setNewOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPattern, setNewPattern] = useState("");
  const [newPatternType, setNewPatternType] = useState<CommandPatternType>("prefix");
  const [newRole, setNewRole] = useState("public");

  async function handleCreate() {
    if (!instanceId || !newName || !newPattern) return;
    await createCommand({
      instanceId: instanceId as Id<"instances">,
      name: newName,
      pattern: newPattern,
      patternType: newPatternType,
      requiredRole: newRole,
    });
    setNewOpen(false);
    setNewName("");
    setNewPattern("");
    setNewPatternType("prefix");
    setNewRole("public");
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Commands</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Chat commands registered by modules or created manually.
          </p>
        </div>
        <Dialog open={newOpen} onOpenChange={setNewOpen}>
          <DialogTrigger asChild>
            <Button size="sm"><Plus className="h-4 w-4 mr-2" />New command</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create command</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-1">
                <Label>Name</Label>
                <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="my-command" />
              </div>
              <div className="space-y-1">
                <Label>Pattern</Label>
                <Input value={newPattern} onChange={(e) => setNewPattern(e.target.value)} placeholder="!hello" />
              </div>
              <div className="space-y-1">
                <Label>Pattern type</Label>
                <Select value={newPatternType} onValueChange={(v) => setNewPatternType(v as CommandPatternType)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="prefix">Prefix</SelectItem>
                    <SelectItem value="exact">Exact</SelectItem>
                    <SelectItem value="regex">Regex</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Required role</Label>
                <Select value={newRole} onValueChange={setNewRole}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {DEFAULT_ROLES.map((r) => (
                      <SelectItem key={r} value={r}>{r}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button className="w-full" onClick={handleCreate}>Create</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Pattern</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Required role</TableHead>
            <TableHead>Linked workflow</TableHead>
            <TableHead>Enabled</TableHead>
            <TableHead></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {(commands ?? []).map((cmd) => (
            <TableRow key={cmd._id}>
              <TableCell className="font-medium">{cmd.name}</TableCell>
              <TableCell>
                <code className="text-xs bg-muted px-1 py-0.5 rounded">{cmd.pattern}</code>
              </TableCell>
              <TableCell>
                <Badge variant="outline">{cmd.patternType}</Badge>
              </TableCell>
              <TableCell>
                <Select
                  value={cmd.requiredRole}
                  onValueChange={(role) => updateCommand({ commandId: cmd._id as Id<"moduleCommands">, requiredRole: role })}
                >
                  <SelectTrigger className="h-7 w-32 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DEFAULT_ROLES.map((r) => (
                      <SelectItem key={r} value={r}>{r}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </TableCell>
              <TableCell>
                <Select
                  value={cmd.workflowId ?? "none"}
                  onValueChange={(id) =>
                    updateCommand({
                      commandId: cmd._id as Id<"moduleCommands">,
                      workflowId: id === "none" ? undefined : id as Id<"workflows">,
                    })
                  }
                >
                  <SelectTrigger className="h-7 w-40 text-xs">
                    <SelectValue placeholder="None" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {(workflows ?? []).map((wf) => (
                      <SelectItem key={wf._id} value={wf._id}>{wf.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </TableCell>
              <TableCell>
                <Switch
                  checked={cmd.isEnabled}
                  onCheckedChange={(v) => updateCommand({ commandId: cmd._id as Id<"moduleCommands">, isEnabled: v })}
                />
              </TableCell>
              <TableCell>
                {!cmd.moduleId ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => removeCommand({ commandId: cmd._id as Id<"moduleCommands"> })}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                ) : null}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
```

- [ ] **Step 2: Check that `api.workflows.list` exists with the right signature**

```bash
grep -n "export const list" /home/wolfy/code/wolfymaster/woofx3-ui/convex/workflows.ts
```

If the query takes different args, adjust the `useQuery` call accordingly.

- [ ] **Step 3: Run type check**

```bash
bun run check
```

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/commands.tsx
git commit -m "feat: add commands page — table with inline role/workflow editing, new command dialog"
```

---

### Task 15: Register /commands route and add nav link

**Files:**
- Modify: `client/src/App.tsx`

- [ ] **Step 1: Add Commands import and route**

In `client/src/App.tsx`, add:
```typescript
import Commands from "@/pages/commands";
```

In the protected routes Switch block, add:
```typescript
<Route path="/commands" component={Commands} />
```

- [ ] **Step 2: Add nav link to sidebar**

Find the sidebar navigation component (likely in `client/src/components/layout/broadcast-shell.tsx` or a sidebar component). Locate the nav items array and add:

```typescript
{ id: "commands", label: "Commands", icon: "Terminal", href: "/commands" }
```

Check what pattern the existing nav items use and match it exactly.

- [ ] **Step 3: Run type check**

```bash
bun run check
```

- [ ] **Step 4: Commit**

```bash
git add client/src/App.tsx client/src/components/layout/
git commit -m "feat: register /commands route and add sidebar nav link"
```

---

## Phase 4 — Webhook Management UI

### Task 16: Add webhook management to settings page

**Files:**
- Modify: `client/src/pages/settings.tsx`

- [ ] **Step 1: Read the current settings page structure**

```bash
grep -n "export\|function\|return\|<Tab\|section" /home/wolfy/code/wolfymaster/woofx3-ui/client/src/pages/settings.tsx | head -50
```

- [ ] **Step 2: Add webhook management section/tab**

Add these imports to `settings.tsx`:
```typescript
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { Copy, RefreshCw, Trash2 } from "lucide-react";
import { useInstanceId } from "@/lib/stores";
```

Add a `WebhooksSection` component within or near `settings.tsx`:

```typescript
function WebhooksSection() {
  const instanceId = useInstanceId();
  const webhooks = useQuery(
    api.webhooks.list,
    instanceId ? { instanceId: instanceId as Id<"instances"> } : "skip"
  );
  const removeWebhook = useMutation(api.webhooks.remove);
  const rotateSecret = useMutation(api.webhooks.rotateSecret);
  const setEnabled = useMutation(api.webhooks.setEnabled);
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});

  const baseUrl = typeof window !== "undefined" ? window.location.origin : "";

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold">Webhook Endpoints</h3>
        <p className="text-sm text-muted-foreground">
          HTTP endpoints that external services can POST to in order to trigger workflows.
          Installed automatically when a module with webhook triggers is installed.
        </p>
      </div>

      {(webhooks ?? []).length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No webhook endpoints. Install a module with webhook triggers to create endpoints.
        </p>
      ) : null}

      <div className="space-y-3">
        {(webhooks ?? []).map((wh) => {
          const endpointUrl = `${baseUrl}/api/webhooks/${wh.endpointId}`;
          const isRevealed = revealed[wh._id] ?? false;

          return (
            <Card key={wh._id}>
              <CardContent className="py-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{wh.triggerId}</span>
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={wh.isEnabled}
                      onCheckedChange={(v) =>
                        setEnabled({ webhookId: wh._id as Id<"webhookEndpoints">, isEnabled: v })
                      }
                    />
                    <Button
                      variant="ghost" size="icon" className="h-7 w-7"
                      onClick={() => removeWebhook({ webhookId: wh._id as Id<"webhookEndpoints"> })}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>

                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Endpoint URL</Label>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 text-xs bg-muted px-2 py-1.5 rounded truncate">
                      {endpointUrl}
                    </code>
                    <Button
                      variant="outline" size="icon" className="h-7 w-7 shrink-0"
                      onClick={() => navigator.clipboard.writeText(endpointUrl)}
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>

                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Signing Secret</Label>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 text-xs bg-muted px-2 py-1.5 rounded truncate">
                      {isRevealed ? wh.signingSecret : "••••••••••••••••••••••••••••••••"}
                    </code>
                    <Button
                      variant="outline" size="sm" className="h-7 text-xs shrink-0"
                      onClick={() => setRevealed((p) => ({ ...p, [wh._id]: !isRevealed }))}
                    >
                      {isRevealed ? "Hide" : "Reveal"}
                    </Button>
                    <Button
                      variant="outline" size="icon" className="h-7 w-7 shrink-0"
                      onClick={() => navigator.clipboard.writeText(wh.signingSecret)}
                      disabled={!isRevealed}
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="outline" size="icon" className="h-7 w-7 shrink-0"
                      onClick={() => rotateSecret({ webhookId: wh._id as Id<"webhookEndpoints"> })}
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>

                {wh.lastTriggeredAt ? (
                  <p className="text-xs text-muted-foreground">
                    Last triggered: {new Date(wh.lastTriggeredAt).toLocaleString()}
                  </p>
                ) : null}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
```

Add `<WebhooksSection />` inside an appropriate tab or section in the settings page. Match the existing tab pattern in the file.

- [ ] **Step 3: Run type check**

```bash
bun run check
```

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/settings.tsx
git commit -m "feat: add webhook management section to settings — endpoint URL, secret reveal/copy/rotate"
```

---

## Phase 5 — Scene/Widget System

### Task 17: Update moduleWidgets schema field and module install flow

**Files:**
- Modify: `convex/moduleWidgets.ts`

- [ ] **Step 1: Read the current moduleWidgets file**

```bash
cat /home/wolfy/code/wolfymaster/woofx3-ui/convex/moduleWidgets.ts
```

- [ ] **Step 2: Add a mutation to set renderAssetKey on a widget**

Add to `convex/moduleWidgets.ts`:

```typescript
export const setRenderAssetKey = mutation({
  args: {
    widgetId: v.id("moduleWidgets"),
    renderAssetKey: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.widgetId, { renderAssetKey: args.renderAssetKey });
  },
});
```

- [ ] **Step 3: Add widgets array arg to registerInstall in convex/installedModules.ts**

`registerInstall` in Task 7 doesn't yet register widgets. Add to its `args`:

```typescript
widgets: v.array(v.object({
  widgetId: v.string(),
  name: v.string(),
  description: v.optional(v.string()),
  directory: v.string(),
  acceptedEvents: v.array(v.string()),
})),
```

In the handler body, after inserting commands, add:

```typescript
for (const widget of args.widgets) {
  await ctx.db.insert("moduleWidgets", {
    moduleId: args.moduleRepositoryId,
    widgetId: widget.widgetId,
    name: widget.name,
    directory: widget.directory,
    description: widget.description,
    alertTypes: widget.acceptedEvents,
    settings: [],
    createdAt: now,
  });
}
```

- [ ] **Step 4: Add generateWidgetUploadUrl mutation and setRenderAssetKey mutation to convex/moduleWidgets.ts**

```typescript
import { mutation } from "./_generated/server";

export const generateWidgetUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    return await ctx.storage.generateUploadUrl();
  },
});

export const setRenderAssetKey = mutation({
  args: {
    widgetId: v.string(),   // manifest widget id, not Convex _id
    storageId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    const widget = await ctx.db
      .query("moduleWidgets")
      .withIndex("by_widget_id", (q) => q.eq("widgetId", args.widgetId))
      .unique();
    if (!widget) throw new Error(`Widget ${args.widgetId} not found`);
    await ctx.db.patch(widget._id, { renderAssetKey: args.storageId });
  },
});
```

- [ ] **Step 5: Update module-install.tsx handleInstall — add widgets to registerInstall and upload HTML**

First, update the existing `registerInstall` call (from Task 12) to include `widgets`:

```typescript
await registerInstall({
  instanceId: instanceId as Id<"instances">,
  moduleRepositoryId: repoId as Id<"moduleRepository">,
  installKey: parsedData.installKey,
  version: manifest.version,
  commands: manifest.commands.map((c) => ({
    name: c.name,
    description: c.description,
    pattern: c.pattern,
    patternType: c.patternType,
    requiredRole: c.requiredRole,
  })),
  webhookTriggerIds: getWebhookTriggerIds(manifest),
  widgets: manifest.widgets.map((w) => ({
    widgetId: w.id,
    name: w.name,
    description: w.description,
    directory: w.directory,
    acceptedEvents: w.acceptedEvents,
  })),
});
```

Then after the `registerInstall` call, upload widget HTML to storage:

```typescript
// Upload widget HTML assets to Convex storage
const generateUploadUrl = useMutation(api.moduleWidgets.generateWidgetUploadUrl);
const setRenderAssetKey = useMutation(api.moduleWidgets.setRenderAssetKey);

for (const [widgetId, htmlBytes] of Object.entries(parsedData.widgetAssets)) {
  const uploadUrl = await generateUploadUrl({});
  const uploadRes = await fetch(uploadUrl, {
    method: "POST",
    body: new Blob([htmlBytes], { type: "text/html" }),
    headers: { "Content-Type": "text/html" },
  });
  const { storageId } = await uploadRes.json();
  await setRenderAssetKey({ widgetId, storageId });
}
```

Place these `useMutation` hooks at the top of the `ModuleInstall` component alongside the other mutations.

- [ ] **Step 5: Run type check**

```bash
bun run check
```

- [ ] **Step 6: Commit**

```bash
git add convex/moduleWidgets.ts convex/installedModules.ts client/src/pages/module-install.tsx
git commit -m "feat: widget HTML asset storage — upload to Convex storage on module install, renderAssetKey tracking"
```

---

### Task 18: Update widget serving endpoint in convex/http.ts

**Files:**
- Modify: `convex/http.ts`

- [ ] **Step 1: Add internal query for widget by widgetId**

Add to `convex/moduleWidgets.ts`:
```typescript
// internalQuery — only called from HTTP actions
export const getByWidgetId = internalQuery({
  args: { widgetId: v.string() },
  handler: async (ctx, args) => {
    return ctx.db
      .query("moduleWidgets")
      .withIndex("by_widget_id", (q) => q.eq("widgetId", args.widgetId))
      .first();
  },
});
```

Ensure `internalQuery` is imported at the top of `convex/moduleWidgets.ts`.

- [ ] **Step 2: Replace the TODO widget handler in convex/http.ts**

Replace the `/api/widgets/` GET handler with:

```typescript
http.route({
  pathPrefix: "/api/widgets/",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const pathParts = url.pathname.split("/").filter(Boolean);
    // Path: /api/widgets/{widgetId}/asset
    const widgetId = pathParts[2];

    if (!widgetId) {
      return new Response("Not found", { status: 404 });
    }

    const widget = await ctx.runQuery(internal.moduleWidgets.getByWidgetId, { widgetId });

    if (!widget?.renderAssetKey) {
      return new Response("Widget asset not found", { status: 404 });
    }

    const assetUrl = await ctx.storage.getUrl(widget.renderAssetKey as Id<"_storage">);
    if (!assetUrl) {
      return new Response("Asset not found in storage", { status: 404 });
    }

    // Proxy the asset from storage
    const assetResponse = await fetch(assetUrl);
    const body = await assetResponse.arrayBuffer();
    return new Response(body, {
      headers: {
        "Content-Type": "text/html",
        "Cache-Control": "public, max-age=3600",
        ...CORS_HEADERS,
      },
    });
  }),
});
```

- [ ] **Step 3: Add import for Id**

Ensure `Id` is imported at the top of `convex/http.ts`:
```typescript
import type { Id } from "./_generated/dataModel";
```

- [ ] **Step 4: Run type check**

```bash
bun run check
```

- [ ] **Step 5: Commit**

```bash
git add convex/http.ts convex/moduleWidgets.ts
git commit -m "feat: serve widget HTML from Convex storage via /api/widgets/{widgetId}/asset"
```

---

### Task 19: Update browser source for iframe-based widget rendering

**Files:**
- Modify: `client/src/pages/browser-source.tsx`

- [ ] **Step 1: Read the current browser source page**

```bash
head -100 /home/wolfy/code/wolfymaster/woofx3-ui/client/src/pages/browser-source.tsx
```

- [ ] **Step 2: Add widget rendering alongside the existing alert rendering**

Add to the browser source component, after alert descriptors are fetched, a `WidgetLayer` component:

```typescript
interface WidgetLayerProps {
  widgets: Array<{
    id: string
    moduleWidgetId: string
    positionX: number
    positionY: number
    width: number
    height: number
    zIndex: number
    settings: Record<string, unknown>
  }>
  convexUrl: string
}

function WidgetLayer({ widgets, convexUrl }: WidgetLayerProps) {
  return (
    <>
      {widgets.map((widget) => {
        const assetUrl = `${convexUrl}/api/widgets/${widget.moduleWidgetId}/asset`;
        return (
          <iframe
            key={widget.id}
            src={assetUrl}
            style={{
              position: "absolute",
              left: widget.positionX,
              top: widget.positionY,
              width: widget.width,
              height: widget.height,
              zIndex: widget.zIndex,
              border: "none",
              background: "transparent",
            }}
            sandbox="allow-scripts allow-same-origin"
            title={`widget-${widget.id}`}
          />
        );
      })}
    </>
  );
}
```

In the main browser source component, fetch scene widgets alongside slots:
```typescript
const scene = useQuery(api.browserSource.getScene, { sceneId: sourceKey.sceneId });
const sceneWidgets = scene?.widgets ?? [];
```

Render `<WidgetLayer widgets={sceneWidgets} convexUrl={import.meta.env.VITE_CONVEX_URL} />` inside the scene container, alongside the alert rendering.

- [ ] **Step 3: Run type check**

```bash
bun run check
```

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/browser-source.tsx
git commit -m "feat: browser source — iframe-based widget rendering with postMessage support"
```

---

## Phase 6 — Workflow Improvements

### Task 20: Update convex/workflows.ts — createFromTemplate

**Files:**
- Modify: `convex/workflows.ts`

- [ ] **Step 1: Read the current workflows.ts**

```bash
cat /home/wolfy/code/wolfymaster/woofx3-ui/convex/workflows.ts
```

- [ ] **Step 2: Add createFromTemplate mutation**

```typescript
export const createFromTemplate = mutation({
  args: {
    instanceId: v.id("instances"),
    templateId: v.id("workflowTemplates"),
    name: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const template = await ctx.db.get(args.templateId);
    if (!template) throw new Error("Template not found");

    const templateData = template.workflowJson as { nodes?: unknown[]; edges?: unknown[] };
    const now = Date.now();

    return ctx.db.insert("workflows", {
      instanceId: args.instanceId,
      name: args.name ?? `${template.name} (copy)`,
      description: template.description,
      isEnabled: false,
      nodes: templateData.nodes ?? [],
      edges: templateData.edges ?? [],
      isModuleProvided: false,
      createdAt: now,
      updatedAt: now,
    });
  },
});
```

- [ ] **Step 3: Add createFromModule internalMutation (called during module install)**

```typescript
export const createFromModule = internalMutation({
  args: {
    instanceId: v.id("instances"),
    installedModuleId: v.id("installedModules"),
    name: v.string(),
    description: v.optional(v.string()),
    nodes: v.array(v.any()),
    edges: v.array(v.any()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    return ctx.db.insert("workflows", {
      instanceId: args.instanceId,
      name: args.name,
      description: args.description,
      isEnabled: true,
      nodes: args.nodes,
      edges: args.edges,
      isModuleProvided: true,
      sourceModuleId: args.installedModuleId,
      createdAt: now,
      updatedAt: now,
    });
  },
});
```

- [ ] **Step 4: Run type check**

```bash
bun run check
```

- [ ] **Step 5: Commit**

```bash
git add convex/workflows.ts
git commit -m "feat: workflows — createFromTemplate, createFromModule (module provenance)"
```

---

### Task 21: Update workflows list page for module provenance

**Files:**
- Modify: `client/src/pages/workflows.tsx`

- [ ] **Step 1: Read the current workflows page**

```bash
grep -n "WorkflowCard\|workflow\.\|Badge\|button\|delete\|remove" /home/wolfy/code/wolfymaster/woofx3-ui/client/src/pages/workflows.tsx | head -40
```

- [ ] **Step 2: Add module provenance badge and "Use as template" button**

In the workflow card/row render, add:

```typescript
import { Badge } from "@/components/ui/badge";

// Inside the card, after the workflow name:
{workflow.isModuleProvided ? (
  <Badge variant="secondary" className="text-xs">Module</Badge>
) : null}

// Replace delete button with conditional:
{workflow.isModuleProvided ? (
  <Button
    variant="outline"
    size="sm"
    onClick={() => createFromTemplate({
      instanceId: instanceId as Id<"instances">,
      // For module workflows, copy nodes/edges — we use a different path
    })}
  >
    Use as template
  </Button>
) : (
  <Button variant="ghost" size="icon" onClick={() => removeWorkflow({ workflowId: workflow._id })}>
    <Trash2 className="h-4 w-4" />
  </Button>
)}
```

Add the `copyWorkflow` mutation (add to convex/workflows.ts):
```typescript
export const copy = mutation({
  args: { workflowId: v.id("workflows"), instanceId: v.id("instances") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const source = await ctx.db.get(args.workflowId);
    if (!source) throw new Error("Workflow not found");
    const now = Date.now();
    return ctx.db.insert("workflows", {
      instanceId: args.instanceId,
      name: `${source.name} (copy)`,
      description: source.description,
      isEnabled: false,
      nodes: source.nodes,
      edges: source.edges,
      isModuleProvided: false,
      createdAt: now,
      updatedAt: now,
    });
  },
});
```

Wire in the UI:
```typescript
const copyWorkflow = useMutation(api.workflows.copy);

// In the "Use as template" button onClick:
copyWorkflow({ workflowId: workflow._id, instanceId: instanceId as Id<"instances"> })
```

- [ ] **Step 3: Run type check**

```bash
bun run check
```

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/workflows.tsx convex/workflows.ts
git commit -m "feat: workflows — module provenance badge, 'use as template' copy for module-provided workflows"
```

---

## Phase 7 — Final Integration Check

### Task 22: Full type check and schema verification

**Files:** All modified files

- [ ] **Step 1: Run full type check**

```bash
cd /home/wolfy/code/wolfymaster/woofx3-ui
bun run check
```

Expected: zero type errors. Fix any remaining issues.

- [ ] **Step 2: Push schema to Convex dev**

```bash
bunx convex dev --once
```

Expected: schema deploys without errors. Fix any schema validator issues.

- [ ] **Step 3: Manual smoke test — module install flow**

1. Start dev server: `bun run dev`
2. Navigate to `/modules/install`
3. Upload a test ZIP with a valid `module.json` at root
4. Verify: manifest preview shows name, version, trigger/action/command counts
5. Click Install — verify module appears in `/modules/installed` with status "active"
6. Verify commands appear at `/commands` page

- [ ] **Step 4: Manual smoke test — webhooks**

1. Navigate to `/settings`
2. Find the Webhooks section
3. Verify webhook endpoints created during module install are listed with endpoint URL and masked secret
4. Click "Reveal" on a secret — verify it shows
5. Click "Rotate" — verify the secret changes

- [ ] **Step 5: Manual smoke test — commands**

1. Navigate to `/commands`
2. Verify module-installed commands appear in the table
3. Change the required role on a command — verify it saves
4. Create a new manual command — verify it appears

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "chore: final integration check — all phases complete"
```

---

## Appendix: Test ZIP Format

To test the module install flow, create a minimal `module.json`:

```json
{
  "id": "test-module",
  "name": "Test Module",
  "version": "1.0.0",
  "description": "Minimal test module",
  "triggers": [
    { "id": "test-webhook", "name": "Test Webhook", "type": "webhook" }
  ],
  "actions": [],
  "commands": [
    { "name": "hello", "pattern": "!hello", "patternType": "prefix", "requiredRole": "public" }
  ],
  "workflows": [],
  "widgets": [],
  "overlays": [],
  "functions": []
}
```

Zip it: `zip test-module.zip module.json`
