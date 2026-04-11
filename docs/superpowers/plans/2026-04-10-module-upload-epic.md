# Module Upload Epic — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the module upload pipeline end-to-end — from ZIP drop in the UI through Convex proxy to engine installation via Barkloader, with the installed module list correctly reflected back in the UI.

**Architecture:** The pipeline spans three repos: woofx3-ui (this repo: Convex backend + React frontend), woofx3 engine (Go API), and Barkloader (Rust module loader). The UI uploads a ZIP to Convex storage, a Convex action delivers it to the engine via Cap'n Proto RPC (`installModuleZip`), the engine forwards to Barkloader, Barkloader extracts manifest/triggers/actions and loads the module, then the engine sends a webhook callback to Convex with the extracted metadata. Convex persists UI-only fields (trigger/action definitions) and the frontend reactively updates.

**Tech Stack:** Convex (schema + functions), React 18, TypeScript 5.6, Cap'n Proto RPC (`capnweb`), JSZip, Shadcn/ui, Tailwind CSS.

**Note on testing:** No test runner is installed. Verification uses `bun run check` (TypeScript) and `bunx convex dev` (schema push). Each task includes a manual verification step.

---

## Epic Task Order & Dependency Map

The epic spans three repos with two parallel tracks. This plan details the **UI repo tasks** (Track B) with full implementation steps. Track A tasks (engine/Barkloader) are listed with interface contracts so UI work can proceed with clear expectations.

```
Track A (Engine — ~/code/wolfymaster/woofx3/api)          Track B (UI — this repo)
─────────────────────────────────────────────────          ────────────────────────

A1. Engine: installModuleZip RPC handler                   B1. Module listing: engine-authoritative merge
    (receives base64 zip, validates, stores)                   (orphan modules, retry, error state)
         │                                                      │
A2. Engine: Forward zip to Barkloader                      B2. Webhook handler: module install callback
    (IPC/HTTP to Barkloader process)                           (receive trigger/action defs from engine)
         │                                                      │
A3. Barkloader: Extract triggers/actions from zip          B3. Module install status tracking
    (parse manifest, separate UI/engine fields)                (pending → installing → installed → error)
         │                                                      │
A4. Barkloader: Load module from package                   B4. Upload flow hardening
    (IN PROGRESS — runtime activation)                         (delivery error handling, retry UI)
         │
A5. Engine: Send webhook callback to Convex
    (POST /api/webhooks/woofx3/notify with module data)
```

**Critical path:** A1 → A2 → A3 → A4 → A5 must complete before the full pipeline works end-to-end. However, B1–B4 can all be built and tested now against mock/stubbed engine responses. Once Track A completes, the integration "just works."

---

## Track A — Engine Interface Contracts (for reference, not implemented here)

### A5 Webhook Payload Contract

When the engine finishes installing a module (after Barkloader processes the zip), it POSTs to the Convex webhook:

```
POST <webhookUrl>/api/webhooks/woofx3/notify
Authorization: Bearer <webhookSecret>
Content-Type: application/json

{
  "instanceId": "<convex instance _id>",
  "applicationId": "<engine app id>",
  "type": "module.installed",
  "payload": {
    "name": "my-module",
    "version": "1.0.0",
    "state": "active",
    "triggers": [
      {
        "slug": "my-module.on-follow",
        "name": "On Follow",
        "description": "Fires when a user follows",
        "category": "Twitch",
        "event": "twitch.channel.follow",
        "ui": {
          "color": "#9146FF",
          "icon": "heart",
          "configFields": [],
          "supportsTiers": false
        }
      }
    ],
    "actions": [
      {
        "slug": "my-module.send-chat",
        "name": "Send Chat Message",
        "description": "Sends a message to chat",
        "category": "Chat",
        "ui": {
          "color": "#00B5AD",
          "icon": "message-square",
          "configFields": [
            { "key": "message", "type": "string", "label": "Message", "required": true }
          ]
        }
      }
    ]
  }
}
```

The `ui` sub-object on each trigger/action contains UI-only metadata that Convex persists in `triggerDefinitions`/`actionDefinitions`. The engine does NOT store `ui` fields — they pass through from manifest to webhook to Convex.

---

## File Map

### New Files
- `convex/moduleWebhook.ts` — Internal mutations for processing module install webhook callbacks

### Modified Files
- `convex/http.ts` — New webhook route for `module.installed` events
- `convex/moduleRepository.ts` — Add `status` field support, `updateStatus` mutation
- `convex/moduleEngine.ts` — Error handling, status updates on delivery
- `convex/schema.ts` — Add `status` field to `moduleRepository`, add `instanceId` index
- `client/src/pages/modules.tsx` — Orphan module merge, retry logic, status badges
- `client/src/lib/transport/interface.ts` — No changes needed (EngineModule type already sufficient)

---

## Task 1: Fix module listing merge logic for orphan engine modules

The Modules page (`client/src/pages/modules.tsx`) currently only maps over `repoModules` and checks for engine matches. Engine modules installed outside the UI (or before the catalog entry existed) are invisible. Fix the merge to show them.

**Files:**
- Modify: `client/src/pages/modules.tsx:56-70` (ModuleView type)
- Modify: `client/src/pages/modules.tsx:266-280` (allModules useMemo)

- [ ] **Step 1: Extend the ModuleView type to support orphan modules**

In `client/src/pages/modules.tsx`, the `ModuleView` type needs an `_id` that can be either a Convex ID or a synthetic string for orphans. Update the type:

```typescript
type ModuleView = {
  _id: Id<"moduleRepository"> | string;
  name: string;
  description: string;
  version: string;
  tags: string[];
  manifest: Record<string, unknown>;
  archiveKey: string;
  isInstalled: boolean;
  isEnabled: boolean;
  engineState?: string;
  isOrphan?: boolean;
};
```

Replace the existing `ModuleRepoItem` and `ModuleView` types (lines 56-70) with the above.

- [ ] **Step 2: Update the allModules merge to include orphan engine modules**

Replace the `allModules` useMemo (around line 266) with this logic that does a two-pass merge — first matching repo modules to engine state, then appending any unmatched engine modules:

```typescript
const allModules = useMemo((): ModuleView[] => {
  if (!repoModules) {
    return [];
  }
  const installedMap = new Map<string, EngineModule>();
  engineModules.forEach((m) => installedMap.set(`${m.name}:${m.version}`, m));

  const repoViews: ModuleView[] = repoModules.map((m) => {
    const key = `${m.name}:${m.version}`;
    const installed = installedMap.get(key);
    if (installed) {
      installedMap.delete(key);
    }
    return {
      ...m,
      isInstalled: !!installed,
      isEnabled: (installed?.state ?? "disabled") === "active",
      engineState: installed?.state,
    };
  });

  const orphans: ModuleView[] = Array.from(installedMap.values()).map((em) => ({
    _id: `engine:${em.name}:${em.version}`,
    name: em.name,
    description: "Installed on engine (not in module catalog)",
    version: em.version,
    tags: [],
    manifest: {},
    archiveKey: "",
    isInstalled: true,
    isEnabled: em.state === "active",
    engineState: em.state,
    isOrphan: true,
  }));

  return [...repoViews, ...orphans];
}, [repoModules, engineModules]);
```

- [ ] **Step 3: Guard install/uninstall handlers against orphan IDs**

The `handleInstall` function passes `moduleId` (type `Id<"moduleRepository">`) to `enqueueEngineInstall`. Orphan modules have a string ID, not a Convex ID, so install shouldn't be available for them. Update the `ModuleCard` component to hide the Install button for orphans:

In the `ModuleCard` component's non-installed branch (around line 176), wrap the install button:

```typescript
) : !module.isOrphan ? (
  <Button
    size="sm"
    className="flex-1"
    onClick={() => onInstall(module._id as Id<"moduleRepository">)}
    disabled={isInstalling}
    data-testid={`button-install-${module._id}`}
  >
    {isInstalling ? (
      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
    ) : (
      <Download className="h-4 w-4 mr-2" />
    )}
    {isInstalling ? "Installing..." : "Install"}
  </Button>
) : null}
```

Also update the `ModuleCardProps` type and the list-view rendering to match — the `onInstall`/`onUninstall` callbacks should accept `Id<"moduleRepository"> | string` and the handlers should guard:

```typescript
const handleInstall = async (moduleId: Id<"moduleRepository"> | string) => {
  if (!instance || typeof moduleId === "string") {
    return;
  }
  // ... rest unchanged
};
```

- [ ] **Step 4: Verify**

Run: `bun run check`
Expected: No type errors.

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/modules.tsx
git commit -m "feat(modules): show orphan engine modules in installed tab"
```

---

## Task 2: Add retry logic for engine module fetch

The `refreshEngineModules()` function fires once on mount with no retry. If the engine is slow or temporarily unreachable, the installed list appears empty. Add automatic retry with backoff.

**Files:**
- Modify: `client/src/pages/modules.tsx:244-259` (refreshEngineModules)
- Modify: `client/src/pages/modules.tsx:261-263` (useEffect)

- [ ] **Step 1: Add retry logic to refreshEngineModules**

Replace the `refreshEngineModules` function and its calling useEffect:

```typescript
const refreshEngineModules = useCallback(async (retries = 2) => {
  if (!runtimeInstanceId) {
    setEngineModules([]);
    setEngineError(null);
    return;
  }
  try {
    const modules = await transport.listEngineModules(runtimeInstanceId);
    setEngineModules(modules);
    setEngineError(null);
  } catch (err) {
    if (retries > 0) {
      await new Promise((r) => setTimeout(r, 1500));
      return refreshEngineModules(retries - 1);
    }
    console.error("Failed to fetch engine modules:", err);
    setEngineError("Could not reach engine module list.");
    setEngineModules([]);
  }
}, [runtimeInstanceId]);

useEffect(() => {
  void refreshEngineModules();
}, [refreshEngineModules]);
```

- [ ] **Step 2: Verify**

Run: `bun run check`
Expected: No type errors.

- [ ] **Step 3: Commit**

```bash
git add client/src/pages/modules.tsx
git commit -m "feat(modules): retry engine module fetch with backoff"
```

---

## Task 3: Add `status` field to moduleRepository schema

Currently `moduleRepository` has no installation status. When a module is created and delivery is enqueued, there's no way to know if it succeeded or failed. Add a `status` field.

**Files:**
- Modify: `convex/schema.ts:95-103` (moduleRepository table)
- Modify: `convex/moduleRepository.ts` (create mutation, new updateStatus mutation)

- [ ] **Step 1: Add status field and instanceId to moduleRepository schema**

In `convex/schema.ts`, replace the `moduleRepository` table definition:

```typescript
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
```

- [ ] **Step 2: Update the create mutation to set initial status**

In `convex/moduleRepository.ts`, update the `create` mutation handler to include `status`:

```typescript
handler: async (ctx, args) => {
  const userId = await getAuthUserId(ctx);
  if (!userId) {
    throw new Error("Not authenticated");
  }
  const { instanceId, ...moduleData } = args;
  const moduleId = await ctx.db.insert("moduleRepository", {
    ...moduleData,
    instanceId,
    status: "pending",
  });
  await ctx.scheduler.runAfter(0, internal.moduleEngine.deliverZipToInstance, {
    moduleId,
    instanceId,
  });
  return moduleId;
},
```

- [ ] **Step 3: Add an internal updateStatus mutation**

Add to `convex/moduleRepository.ts`:

```typescript
export const updateStatus = internalMutation({
  args: {
    moduleId: v.id("moduleRepository"),
    status: v.union(
      v.literal("pending"),
      v.literal("delivering"),
      v.literal("installed"),
      v.literal("failed"),
    ),
    statusMessage: v.optional(v.string()),
  },
  handler: async (ctx, { moduleId, status, statusMessage }) => {
    const existing = await ctx.db.get(moduleId);
    if (!existing) {
      return;
    }
    await ctx.db.patch(moduleId, { status, statusMessage });
  },
});
```

Add the missing import for `internalMutation` at the top of the file:

```typescript
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
```

- [ ] **Step 4: Verify**

Run: `bun run check`
Expected: No type errors.

Run: `bunx convex dev` (in another terminal) to verify the schema pushes successfully.

- [ ] **Step 5: Commit**

```bash
git add convex/schema.ts convex/moduleRepository.ts
git commit -m "feat(schema): add status tracking to moduleRepository"
```

---

## Task 4: Update deliverZipToInstance to track delivery status

The `moduleEngine.deliverZipToInstance` action currently fires and forgets. Update it to set status to `delivering` before the RPC call, `installed` on success, and `failed` on error.

**Files:**
- Modify: `convex/moduleEngine.ts`

- [ ] **Step 1: Add status updates around the RPC call**

Replace the full `deliverZipToInstance` handler in `convex/moduleEngine.ts`:

```typescript
"use node";

import { newHttpBatchRpcSession } from "capnweb";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";

function normalizeEngineApiUrl(instanceUrl: string): string {
  const trimmed = instanceUrl.trim();
  if (!trimmed) {
    throw new Error("Instance URL is empty");
  }
  if (trimmed.includes("://")) {
    const parsed = new URL(trimmed);
    return `${parsed.protocol}//${parsed.host}/api`;
  }
  return `https://${trimmed}/api`;
}

export const deliverZipToInstance = internalAction({
  args: {
    instanceId: v.id("instances"),
    moduleId: v.id("moduleRepository"),
  },
  handler: async (ctx, args) => {
    await ctx.runMutation(internal.moduleRepository.updateStatus, {
      moduleId: args.moduleId,
      status: "delivering",
    });

    try {
      const delivery = await ctx.runQuery(internal.moduleRepository.getInstallDeliveryData, args);
      const archiveRes = await fetch(delivery.archiveUrl);
      if (!archiveRes.ok) {
        throw new Error(`Failed to fetch module archive: ${archiveRes.status} ${archiveRes.statusText}`);
      }
      const archiveBuffer = await archiveRes.arrayBuffer();
      const zipBase64 = Buffer.from(archiveBuffer).toString("base64");

      const rpc = newHttpBatchRpcSession<{
        installModuleZip(fileName: string, zipBase64: string): Promise<unknown>;
      }>(normalizeEngineApiUrl(delivery.instanceUrl));
      await rpc.installModuleZip(delivery.fileName, zipBase64);

      await ctx.runMutation(internal.moduleRepository.updateStatus, {
        moduleId: args.moduleId,
        status: "installed",
      });

      return { delivered: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await ctx.runMutation(internal.moduleRepository.updateStatus, {
        moduleId: args.moduleId,
        status: "failed",
        statusMessage: message,
      });
      throw err;
    }
  },
});
```

- [ ] **Step 2: Verify**

Run: `bun run check`
Expected: No type errors.

- [ ] **Step 3: Commit**

```bash
git add convex/moduleEngine.ts
git commit -m "feat(moduleEngine): track delivery status on install"
```

---

## Task 5: Add webhook handler for module.installed callbacks

When the engine finishes processing a module (after Barkloader extracts triggers/actions), it sends a webhook to Convex. This handler receives that callback and upserts `triggerDefinitions` and `actionDefinitions` records.

**Files:**
- Create: `convex/moduleWebhook.ts`
- Modify: `convex/http.ts`

- [ ] **Step 1: Create convex/moduleWebhook.ts**

```typescript
import { v } from "convex/values";
import { internalMutation } from "./_generated/server";

const triggerValidator = v.object({
  slug: v.string(),
  name: v.string(),
  description: v.string(),
  category: v.string(),
  event: v.optional(v.string()),
  ui: v.object({
    color: v.string(),
    icon: v.string(),
    configFields: v.optional(v.array(v.any())),
    supportsTiers: v.optional(v.boolean()),
    tierLabel: v.optional(v.string()),
  }),
});

const actionValidator = v.object({
  slug: v.string(),
  name: v.string(),
  description: v.string(),
  category: v.string(),
  ui: v.object({
    color: v.string(),
    icon: v.string(),
    configFields: v.optional(v.array(v.any())),
  }),
});

/**
 * Process a module.installed webhook callback from the engine.
 * Upserts trigger and action definitions in Convex using slug as the idempotency key.
 */
export const processModuleInstalled = internalMutation({
  args: {
    instanceId: v.string(),
    moduleName: v.string(),
    moduleVersion: v.string(),
    triggers: v.array(triggerValidator),
    actions: v.array(actionValidator),
  },
  handler: async (ctx, { moduleName, moduleVersion, triggers, actions }) => {
    // Find the moduleRepository record by name + version
    const allModules = await ctx.db.query("moduleRepository").collect();
    const moduleRecord = allModules.find(
      (m) => m.name === moduleName && m.version === moduleVersion,
    );
    const moduleId = moduleRecord?._id;

    // Upsert trigger definitions
    for (const trigger of triggers) {
      const existing = await ctx.db
        .query("triggerDefinitions")
        .withIndex("by_slug", (q) => q.eq("slug", trigger.slug))
        .first();

      const data = {
        slug: trigger.slug,
        name: trigger.name,
        description: trigger.description,
        category: trigger.category,
        event: trigger.event,
        color: trigger.ui.color,
        icon: trigger.ui.icon,
        configFields: trigger.ui.configFields,
        supportsTiers: trigger.ui.supportsTiers,
        tierLabel: trigger.ui.tierLabel,
        moduleId,
      };

      if (existing) {
        await ctx.db.patch(existing._id, data);
      } else {
        await ctx.db.insert("triggerDefinitions", data);
      }
    }

    // Upsert action definitions
    for (const action of actions) {
      const existing = await ctx.db
        .query("actionDefinitions")
        .withIndex("by_slug", (q) => q.eq("slug", action.slug))
        .first();

      const data = {
        slug: action.slug,
        name: action.name,
        description: action.description,
        category: action.category,
        color: action.ui.color,
        icon: action.ui.icon,
        configFields: action.ui.configFields,
        moduleId,
      };

      if (existing) {
        await ctx.db.patch(existing._id, data);
      } else {
        await ctx.db.insert("actionDefinitions", data);
      }
    }

    // Update module status to installed if we found the record
    if (moduleId) {
      await ctx.db.patch(moduleId, { status: "installed" });
    }
  },
});
```

- [ ] **Step 2: Add the webhook route to convex/http.ts**

Add this route block in `convex/http.ts`, after the existing `/api/webhooks/woofx3/alerts` route (around line 204):

```typescript
http.route({ path: "/api/webhooks/woofx3/notify", method: "OPTIONS", handler: preflightHandler });
http.route({
  path: "/api/webhooks/woofx3/notify",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const payload = await request.json();

    if (!payload.instanceId || !payload.type) {
      return corsJson({ error: "Missing required fields: instanceId, type" }, 400);
    }

    // TODO: Validate webhookSecret from Authorization header against instance record
    // const authHeader = request.headers.get("Authorization");
    // const secret = authHeader?.replace("Bearer ", "");

    if (payload.type === "module.installed") {
      const p = payload.payload;
      if (!p?.name || !p?.version) {
        return corsJson({ error: "Missing module name/version in payload" }, 400);
      }

      await ctx.runMutation(internal.moduleWebhook.processModuleInstalled, {
        instanceId: payload.instanceId,
        moduleName: p.name,
        moduleVersion: p.version,
        triggers: p.triggers ?? [],
        actions: p.actions ?? [],
      });

      return corsJson({ success: true, type: "module.installed" });
    }

    // Future event types can be handled here
    return corsJson({ success: true, type: payload.type, handled: false });
  }),
});
```

Add the import for `internal` if not already present at the top of the file (it should already be there).

- [ ] **Step 3: Verify**

Run: `bun run check`
Expected: No type errors.

- [ ] **Step 4: Commit**

```bash
git add convex/moduleWebhook.ts convex/http.ts
git commit -m "feat(webhooks): handle module.installed callbacks from engine"
```

---

## Task 6: Show module install status in the Modules page

Now that modules have a `status` field, surface it in the UI so users know when delivery is in progress, succeeded, or failed.

**Files:**
- Modify: `client/src/pages/modules.tsx`

- [ ] **Step 1: Add status to the ModuleView type and merge logic**

Update the `ModuleView` type (from Task 1) to include status fields:

```typescript
type ModuleView = {
  _id: Id<"moduleRepository"> | string;
  name: string;
  description: string;
  version: string;
  tags: string[];
  manifest: Record<string, unknown>;
  archiveKey: string;
  isInstalled: boolean;
  isEnabled: boolean;
  engineState?: string;
  isOrphan?: boolean;
  status?: "pending" | "delivering" | "installed" | "failed";
  statusMessage?: string;
};
```

Update the repo-side of the merge in `allModules` to carry through the status:

```typescript
const repoViews: ModuleView[] = repoModules.map((m) => {
  const key = `${m.name}:${m.version}`;
  const installed = installedMap.get(key);
  if (installed) {
    installedMap.delete(key);
  }
  return {
    ...m,
    isInstalled: !!installed,
    isEnabled: (installed?.state ?? "disabled") === "active",
    engineState: installed?.state,
    status: (m as Record<string, unknown>).status as ModuleView["status"],
    statusMessage: (m as Record<string, unknown>).statusMessage as string | undefined,
  };
});
```

- [ ] **Step 2: Add a status badge to ModuleCard**

In the `ModuleCard` component, add a status indicator next to the existing "Installed" badge (around line 126):

```typescript
{module.status === "delivering" && (
  <Badge variant="secondary" className="shrink-0 text-xs">
    <Loader2 className="h-3 w-3 mr-1 animate-spin" />
    Installing
  </Badge>
)}
{module.status === "failed" && (
  <Badge variant="destructive" className="shrink-0 text-xs">
    Failed
  </Badge>
)}
```

- [ ] **Step 3: Add a retry button for failed modules**

In the `ModuleCard` footer, add a retry option when status is "failed". Add a new prop to `ModuleCardProps`:

```typescript
interface ModuleCardProps {
  module: ModuleView;
  onInstall: (id: Id<"moduleRepository"> | string) => void;
  onUninstall: (id: Id<"moduleRepository"> | string) => void;
  onToggleEnabled: (id: Id<"moduleRepository"> | string, enabled: boolean) => void;
  onRetry: (id: Id<"moduleRepository">) => void;
  isInstalling?: boolean;
}
```

In the card footer, add a failed state branch before the installed check:

```typescript
{module.status === "failed" ? (
  <div className="flex-1 flex items-center gap-2">
    <p className="text-xs text-destructive truncate flex-1" title={module.statusMessage}>
      {module.statusMessage || "Installation failed"}
    </p>
    <Button
      size="sm"
      variant="outline"
      onClick={() => onRetry(module._id as Id<"moduleRepository">)}
    >
      Retry
    </Button>
  </div>
) : module.isInstalled ? (
  // ... existing installed UI
```

- [ ] **Step 4: Wire up the retry handler in the Modules component**

Add a `handleRetry` function in the `Modules` component:

```typescript
const handleRetry = async (moduleId: Id<"moduleRepository">) => {
  if (!instance) {
    return;
  }
  setInstallingId(moduleId);
  try {
    await enqueueEngineInstall({ instanceId: instance._id, moduleId });
    await refreshEngineModules();
  } catch (err) {
    console.error("Retry failed:", err);
  } finally {
    setInstallingId(null);
  }
};
```

Pass `onRetry={handleRetry}` to every `<ModuleCard>` render.

- [ ] **Step 5: Verify**

Run: `bun run check`
Expected: No type errors.

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/modules.tsx
git commit -m "feat(modules): show install status and retry for failed deliveries"
```

---

## Task 7: Validate webhook secret on incoming engine callbacks

The webhook endpoint currently has a TODO for secret validation. Implement it to ensure only the registered engine can send callbacks.

**Files:**
- Modify: `convex/http.ts`
- Create: `convex/webhookAuth.ts`

- [ ] **Step 1: Create convex/webhookAuth.ts with secret validation**

```typescript
import { v } from "convex/values";
import { internalQuery } from "./_generated/server";

/**
 * Look up the webhook secret for a given instanceId.
 * Returns null if the instance doesn't exist or has no secret.
 */
export const getWebhookSecret = internalQuery({
  args: { instanceId: v.string() },
  handler: async (ctx, { instanceId }) => {
    // The instance record stores the webhook secret established during registration.
    // For now, the secret is stored in an environment variable per deployment.
    // TODO: When per-instance secrets are stored in the DB, look them up here.
    const secret = process.env.WEBHOOK_SECRET;
    return secret ?? null;
  },
});
```

- [ ] **Step 2: Add validation to the notify webhook route**

Update the webhook handler in `convex/http.ts` to validate the secret before processing:

```typescript
http.route({
  path: "/api/webhooks/woofx3/notify",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const payload = await request.json();

    if (!payload.instanceId || !payload.type) {
      return corsJson({ error: "Missing required fields: instanceId, type" }, 400);
    }

    // Validate webhook secret
    const authHeader = request.headers.get("Authorization");
    const providedSecret = authHeader?.replace("Bearer ", "");
    const expectedSecret = await ctx.runQuery(internal.webhookAuth.getWebhookSecret, {
      instanceId: payload.instanceId,
    });

    if (expectedSecret && providedSecret !== expectedSecret) {
      return corsJson({ error: "Unauthorized" }, 401);
    }

    if (payload.type === "module.installed") {
      const p = payload.payload;
      if (!p?.name || !p?.version) {
        return corsJson({ error: "Missing module name/version in payload" }, 400);
      }

      await ctx.runMutation(internal.moduleWebhook.processModuleInstalled, {
        instanceId: payload.instanceId,
        moduleName: p.name,
        moduleVersion: p.version,
        triggers: p.triggers ?? [],
        actions: p.actions ?? [],
      });

      return corsJson({ success: true, type: "module.installed" });
    }

    return corsJson({ success: true, type: payload.type, handled: false });
  }),
});
```

- [ ] **Step 3: Verify**

Run: `bun run check`
Expected: No type errors.

- [ ] **Step 4: Commit**

```bash
git add convex/webhookAuth.ts convex/http.ts
git commit -m "feat(webhooks): validate webhook secret on engine callbacks"
```

---

## Summary: Recommended Execution Order

| Order | Task | Repo | Depends On | Can Parallelize? |
|-------|------|------|------------|------------------|
| 1 | Task 1: Orphan module merge | UI | None | Yes — with Tasks 2, 3 |
| 2 | Task 2: Retry logic for engine fetch | UI | None | Yes — with Tasks 1, 3 |
| 3 | Task 3: Schema — add status to moduleRepository | UI | None | Yes — with Tasks 1, 2 |
| 4 | Task 4: deliverZipToInstance status tracking | UI | Task 3 | No |
| 5 | Task 5: Webhook handler for module.installed | UI | Task 3 | Yes — with Task 4 |
| 6 | Task 6: Status badges and retry in Modules page | UI | Tasks 1, 3, 4 | No |
| 7 | Task 7: Webhook secret validation | UI | Task 5 | No |
| — | A1: Engine installModuleZip handler | Engine | None | Yes — parallel with all UI tasks |
| — | A2: Engine forward zip to Barkloader | Engine | A1 | No |
| — | A3: Barkloader extract triggers/actions | Engine | A2 | No |
| — | A4: Barkloader load module (IN PROGRESS) | Engine | A3 | No |
| — | A5: Engine webhook callback to Convex | Engine | A4, Task 5 | No |

**Optimal execution:** Run Tasks 1+2+3 in parallel. Then Task 4+5 in parallel. Then Task 6. Then Task 7. Engine Track A proceeds independently.
