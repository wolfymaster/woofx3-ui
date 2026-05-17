# Marketplace Browse — Design Spec

**Date:** 2026-05-17
**Status:** Approved for implementation
**Scope:** woofx3-ui (this repo) + a coordinating API addition in the engine repo

## Problem

The modules page sidebar has two tabs, Installed and Browse. Today both read from the Convex `moduleRepository` table; Browse just filters to rows that aren't `status === "installed"`. In practice that filter is almost always empty, so Browse is a dead surface. There is no way for a user to discover or install modules other than dragging in a local zip.

We need to wire the Browse tab to a remote woofx3 marketplace API so users can:

1. List available modules (those marked `status='ready'` upstream).
2. Click a module to see its details — the same rich card layout used for installed modules.
3. Press an Install button to install it onto their woofx3 engine instance, without the presigned download URL ever touching the browser.

## Non-goals

- Searching/filtering on the marketplace server. The list is small and Convex actions return everything; client-side filtering is enough for v1.
- Multi-version selection. The marketplace surfaces one "current" version per module.
- Featured/curation UI, ratings, reviews, install counts.
- Auto-update of installed modules.
- Cross-tab reactivity on the Browse list.

## Architecture

```
Client (modules.tsx + modules-sidebar.tsx)
   │
   │  useAction(api.marketplace.listModules)         ── Browse tab opens
   │  useAction(api.marketplace.getModule)           ── Browse module clicked
   │  useAction(api.marketplace.installModule)       ── Install button clicked
   ▼
Convex action layer (convex/marketplace.ts, "use node")
   │
   │  fetch(`${MARKETPLACE_API_URL}/modules`)                ── list
   │  fetch(`${MARKETPLACE_API_URL}/modules/{id}`)            ── detail
   │  fetch(`${MARKETPLACE_API_URL}/modules/{id}/download`)   ── install (server-side only)
   │
   │  Then for install: rpc.installModuleFromUrl(url, moduleKey, ctx)
   ▼
woofx3 engine
   └─ fetches presigned URL → barkloader → emits module.installed webhook
        ↓
   Convex `transientEvents` → UI subscribes by moduleKey for progress
```

### Key decisions

- **Action-only data path.** No new Convex tables, no cron, no caching layer. Marketplace data is fetched on demand each time the user opens the Browse tab or selects a marketplace module. The list is small and stable enough that this is fine.
- **Discriminated selection.** `selectedModule` in `modules.tsx` becomes a union of `{ source: "installed", module }` and `{ source: "marketplace", marketplaceId }`. The detail panel dispatches on `source`.
- **Presigned URL stays server-side.** Convex fetches it from the marketplace and hands it to the engine RPC. It never reaches the browser. This protects R2 credentials and avoids CORS concerns.
- **Fresh presign per install.** Don't include the presigned URL in `getModule`'s response — the TTL is only 5 minutes and the user may sit on the detail screen for longer. The `installModule` action fetches a fresh one at the moment of install.
- **Reuse the transientEvents pipeline.** Install correlation works identically to the local-zip flow. `moduleKey = "${marketplaceModuleId}:${version}:marketplace"`. The engine echoes it through `module.installed`/`module.install_failed` webhooks, and the existing UI subscription picks it up.

## Marketplace API contract

The spec proposes these JSON shapes; the marketplace must conform. All endpoints are public read — Convex sends no auth header.

### `GET /modules` — list ready modules

```json
{
  "modules": [
    {
      "id": "obs-scenes",
      "name": "OBS Scenes",
      "description": "Switch OBS scenes from chat or workflows.",
      "version": "1.4.2",
      "author": "wolfymaster",
      "category": "Media",
      "tags": ["obs", "scenes"],
      "iconUrl": "https://.../obs.png",
      "counts": { "triggers": 2, "actions": 5, "functions": 1, "widgets": 0 },
      "updatedAt": "2026-05-10T14:22:00Z"
    }
  ]
}
```

Returns modules where the marketplace has `status='ready'`. The `id` is a marketplace-stable string slug, not a Convex ID.

### `GET /modules/{id}` — single module detail

```json
{
  "id": "obs-scenes",
  "name": "OBS Scenes",
  "description": "Switch OBS scenes from chat or workflows.",
  "version": "1.4.2",
  "author": "wolfymaster",
  "category": "Media",
  "tags": ["obs", "scenes"],
  "iconUrl": "https://.../obs.png",
  "readme": "## OBS Scenes\n…",
  "triggers": [
    { "slug": "obs.scene.changed", "name": "Scene Changed", "description": "…", "color": "#7c3aed", "icon": "video" }
  ],
  "actions": [
    { "slug": "obs.set_scene", "name": "Set Scene", "description": "…", "color": "#16a34a", "icon": "video" }
  ],
  "functions": [
    { "qualifiedName": "obs.list_scenes", "runtime": "js" }
  ],
  "widgets": [],
  "updatedAt": "2026-05-10T14:22:00Z"
}
```

Trigger and action shapes intentionally mirror the installed `triggerDefinitions` / `actionDefinitions` rows so the same detail-card components render in both modes. `readme` is optional.

### `GET /modules/{id}/download` — presigned R2 URL

```json
{ "url": "https://r2.example/...sig=...", "expires_at": "2026-05-17T12:05:00Z" }
```

The presigned R2 GET has a 5-minute TTL. Convex consumes it immediately by handing it to the engine RPC; the URL never leaves Convex's server runtime.

## Convex layer

New file: `convex/marketplace.ts` with `"use node"`.

```ts
"use node";

import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { action } from "./_generated/server";
import { createEngineRpcSession, type EngineApi } from "./lib/engineInstanceUrl";

const MARKETPLACE_TIMEOUT_MS = 10_000;

function getMarketplaceUrl(): string {
  const url = process.env.MARKETPLACE_API_URL;
  if (!url) { throw new Error("MARKETPLACE_API_URL not configured"); }
  return url.replace(/\/$/, "");
}

export const listModules = action({
  args: {},
  handler: async (ctx, _args): Promise<MarketplaceModuleSummary[]> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) { throw new Error("Not authenticated"); }
    // fetch ${MARKETPLACE_API_URL}/modules with AbortController timeout
    // parse + return modules[]
  },
});

export const getModule = action({
  args: { marketplaceModuleId: v.string() },
  handler: async (ctx, { marketplaceModuleId }): Promise<MarketplaceModuleDetail> => {
    // auth + fetch ${MARKETPLACE_API_URL}/modules/{id}
  },
});

export const installModule = action({
  args: { instanceId: v.id("instances"), marketplaceModuleId: v.string() },
  handler: async (ctx, args): Promise<{ moduleKey: string }> => {
    // 1. auth + load instance bundle (clientId/clientSecret)
    // 2. fetch detail for name + version
    // 3. fetch /modules/{id}/download → { url, expires_at }
    // 4. moduleKey = `${marketplaceModuleId}:${version}:marketplace`
    // 5. transientEvents.emit progress entry keyed by moduleKey
    // 6. rpc.installModuleFromUrl(url, moduleKey, {
    //      name, version, source: "marketplace", marketplaceModuleId
    //    })
    // 7. return { moduleKey }
  },
});
```

TypeScript types `MarketplaceModuleSummary` and `MarketplaceModuleDetail` live in the same file or in `convex/lib/marketplace/types.ts` if they grow. They are re-exported to the client via the generated `api.d.ts` from action return types.

### Configuration

- New Convex env var: `MARKETPLACE_API_URL` (no trailing slash needed; Convex strips it). Set with `bunx convex env set MARKETPLACE_API_URL https://marketplace.woofx3.dev`.
- Missing env var causes the action to throw with a clear "Marketplace not configured" error. UI surfaces this verbatim so an operator sees what to fix in dev.

### Engine RPC contract addition

This is a contract the UI depends on but the engine repo implements. Add to `LocalEngineApi` in `convex/moduleEngine.ts`:

```ts
installModuleFromUrl(
  downloadUrl: string,
  moduleKey: string,
  ctx: { name: string; version: string; source: "marketplace"; marketplaceModuleId: string }
): Promise<void>;
```

The engine fetches `downloadUrl` server-side, hands the bytes to barkloader, and emits the existing `module.installed` / `module.install_failed` webhook with `moduleKey` so the transient-event correlation just works.

## UI changes

### `client/src/pages/modules.tsx`

State refactor:

```ts
type SelectedModule =
  | { source: "installed"; module: ModuleListItem }
  | { source: "marketplace"; marketplaceId: string };
```

Behavior:

- Detail panel dispatches on `source`.
- For `installed`: existing Convex queries for `triggerDefinitions` / `actionDefinitions`.
- For `marketplace`: `useAction(api.marketplace.getModule)` fired in a `useEffect` when `marketplaceId` changes; loading + error states.
- Install button replaces Remove button when `source === "marketplace"`.
- On install:
  1. Call `api.marketplace.installModule`, get `moduleKey` back.
  2. Set `pendingModuleKey` to that key — the existing `installEvent` `useQuery` on `transientEvents` already covers progress, success, and error display.
  3. On `module.installed`: switch `selectedModule` to the new `{ source: "installed", module: <newRow> }` once the row appears in `moduleRepository` so the panel stays on the same module without jumping to empty state.
- The 60-second install timeout already in this file applies unchanged.

### `client/src/components/modules/module-detail-panel.tsx` (NEW)

Presentational component extracted from the ~330 lines of detail-grid JSX currently inline in `modules.tsx`. Props:

```ts
{
  module: {
    name: string;
    description: string;
    version: string;
    author: string;
    category: string;
    tags: string[];
    isInstalled: boolean;
    iconUrl?: string;
    readme?: string;
  };
  triggers: Array<{ _id?: string; slug?: string; name: string; description: string; color: string }>;
  actions: Array<{ _id?: string; slug?: string; name: string; description: string; color: string }>;
  functions: Array<{ qualifiedName: string; runtime?: string }>;
  widgets: Array<{ slug: string; name: string }>;
  loading?: boolean;
  onInstall?: () => void;
  onRemove?: () => void;
  isInstalling?: boolean;
}
```

Both the installed and marketplace branches in `modules.tsx` shape themselves into these props. This pulls the long JSX out of `modules.tsx` and gives us one place to evolve the detail card layout.

### `client/src/components/modules/modules-sidebar.tsx`

- Installed tab: unchanged — driven by `api.moduleRepository.list`.
- Browse tab:
  - On mount (or first activation), call `api.marketplace.listModules` via `useAction`, store in local component state.
  - Show a spinner during load, an error block with a Retry button on failure, and a small refresh icon button in the tab header so the user can refetch.
  - Search applies client-side to the marketplace list (`name`, `description`, `category`).
  - Clicking an item invokes `onSelectModule({ source: "marketplace", marketplaceId })`.
  - The Browse count badge reflects `marketplaceList.length`.
- "Already installed" detection: compute a `Set<string>` of installed `moduleKey` prefixes (`${marketplaceModuleId}:${version}`) from the installed list and disable Install + show an "Installed" badge on matching Browse items.
- `onSelectModule` signature changes to accept the new union.

### File-level summary

| File | Change |
|------|--------|
| `convex/marketplace.ts` | **NEW** — `listModules`, `getModule`, `installModule` actions |
| `convex/moduleEngine.ts` | extend `LocalEngineApi` with `installModuleFromUrl` |
| `client/src/components/modules/modules-sidebar.tsx` | Browse tab fetches via `useAction`; refresh + error UI; "already installed" badging |
| `client/src/components/modules/module-detail-panel.tsx` | **NEW** — presentational detail cards extracted from `modules.tsx` |
| `client/src/pages/modules.tsx` | `selectedModule` union; marketplace install path; swap detail JSX for the new component |
| (engine repo, separate PR) | implement `installModuleFromUrl` RPC method |

## Error handling

| Failure point | Behavior |
|---------------|----------|
| `MARKETPLACE_API_URL` env var missing | Action throws "Marketplace not configured"; UI surfaces verbatim so operators see what to set. |
| Marketplace list/detail returns non-2xx or times out (>10s) | Action throws with status info; UI shows a retry block in the affected pane. Browse keeps previously loaded list if any. |
| Presigned download fetch fails (5xx, expired) | Action throws before calling the engine; `transientEvents` emits `error` for `moduleKey`; UI shows "Install failed" with details. |
| Engine RPC fails (network, auth, install error) | Caught in `installModule`; emits `transientEvents` error; reuses existing install-error UI. |
| `module.install_failed` webhook arrives | Existing `transientEvents` pipeline — no new code. |
| Install times out (no webhook in 60s) | Existing 60-second timer in `modules.tsx`. |
| Double Install clicks | Button disables while `isInstalling`; `moduleKey` provides server-side idempotency. |

## Edge cases

- **Already installed**: Browse list cross-references installed `moduleKey` prefixes; matching entries show an "Installed" badge and the Install button is disabled.
- **Offline**: action throws a network error; UI retry block. Installed tab unaffected.
- **Repeated Browse tab opens**: action re-runs on each mount. Cheap and acceptable; no client-side memoization in v1.
- **Extra fields from marketplace**: loose parsing — destructure what the spec defines, ignore the rest.
- **`moduleKey` collision with prior local-zip install**: local-zip keys end with a content hash (`name:version:abc1234`); marketplace keys end with `:marketplace`. No collision possible.

## Testing

- **Convex actions**: targeted unit tests for URL composition, missing env var branch, non-2xx handling, and the install path's progression of side effects (presign fetch → transient event → engine RPC). No real network calls; mock `fetch` and the RPC session.
- **UI smoke (manual)**: per `CLAUDE.md` verification rule —
  1. `bun run check` and `bunx biome check .` clean.
  2. Dev server: Browse tab loads list, error path triggers retry block, click loads detail with triggers/actions populated, Install shows progress and lands as Installed.
- **Engine contract**: out of scope here; engine repo tests `installModuleFromUrl` echoes `moduleKey` and context through to the `module.installed` webhook payload.

## Future work (not in this spec)

- Marketplace list caching (Convex table with TTL refresh) if perceived latency on tab open becomes an issue.
- Server-side search/filter once the catalogue grows.
- Auto-update of installed modules when a newer version is available upstream.
- Featured/curation UI; ratings; install counts.
