# Scenes and overlays

**Routes:** `/scenes`, `/scenes/:id` (both render the same master-detail page)  
**Primary files:** `client/src/pages/scenes.tsx` (shell), `client/src/components/scenes/scenes-sidebar.tsx` (list), `client/src/components/scenes/scene-canvas-editor.tsx` (canvas)  
**Convex:** `convex/scenes.ts`, `convex/sceneActions.ts`, `convex/moduleWidgets.ts`, `convex/browserSource.ts`  
**HTTP:** `convex/http.ts` — `/browser-source/{key}` (HTML renderer), `/api/browser-source/{key}/claim` (JSON)

## Architecture

**Engine-authoritative.** The woofx3 engine is the source of truth for scene data.

```
UI → Convex action (sceneActions.ts) → Engine RPC → Engine webhook → Convex cache → UI query
```

Convex stores a read-optimized cache of scenes. **All UI writes go through `convex/sceneActions.ts`** (engine RPC) — `convex/scenes.ts` exposes **queries only**; it has no public create/update/delete mutations (a second write path would fight the webhook writer). The engine publishes `SCENE_CREATED/UPDATED/DELETED` webhooks that update the cache via `convex/scenes.ts:upsertFromWebhook` / `deleteFromWebhook`.

Because writes round-trip through the engine, the UI is **eventually consistent**: after `createScene` the editor shows a "waiting for sync" state until the webhook lands; after a save the editor guards local edits against the webhook re-push with a dirty flag.

**Identity & keying:** the cache is keyed on `engineSceneId` (the engine's stable id) via the `by_engine_scene_id` index — never on `name` or a positional `.first()`. Routes use `engineSceneId` as the `:id` param (`getByEngineSceneId`). Webhook upserts/deletes are idempotent on redelivery.

**Authorization:** scene actions and cache queries gate on instance membership (any role) — consistent with the engine having no user/role concept.

## Layout (master-detail, like Workflows / Modules)

`scenes.tsx` is a two-pane shell — `flex h-[calc(100vh-4rem)]` with a `w-72` left sidebar and a `flex-1` detail pane. Selection is **URL-driven**: `/scenes/:id` where `:id` is the `engineSceneId`. There is **no separate list page and no layers/properties side panels**.

- **`ScenesSidebar`** (`components/scenes/scenes-sidebar.tsx`): "New Scene" button + search + a `ScrollArea` list of scenes by name (`{w}x{h} · N widgets` subtitle, `bg-accent` selected). Lists only engine-synced scenes (those with an `engineSceneId`). Create goes through `useAction(api.sceneActions.createScene)` then selects the new scene.
- **`SceneCanvasEditor`** (`components/scenes/scene-canvas-editor.tsx`): the detail pane for the selected scene. Mounted with `key={engineSceneId}` so switching scenes resets local edit state. Shows a "waiting for sync" state until the cache row for a just-created scene arrives.

The detail pane has three regions and **no persistent side panels**:

1. **Header** — editable name, dimensions badge, a **scene-settings popover** (gear: description, width/height, background), the **browser-source dropdown** (Copy / Rotate), Save (dirty-gated), and a `⋮` menu (Duplicate / Delete scene, via `sceneActions`).
2. **Widget bar** — a horizontal `Widgets` bar listing **installed widgets** from `useQuery(api.moduleWidgets.list)`; clicking one adds it to the canvas. When a widget is selected it also shows that widget's name, a **settings popover** (gear → form rendered from the widget's `settings` schema), and a delete button.
3. **Canvas** — `flex-1` zoomable surface with absolute-positioned placeholder boxes (the engine renders real widgets in the overlay; this is a layout surface). Drag to move, corner handle to resize; clicking the background deselects.

Saves go through `useAction(api.sceneActions.updateScene)` (`widgetsJson` + `layoutJson`); a dirty flag drives the Save button and protects in-flight edits from the post-save webhook re-push.

## Widget System

Widgets are **engine-registered module widgets only** — no arbitrary/custom widget types.

- **Widget type:** `{ id, widgetCanonicalId, name, position, size, rotation, opacity, zIndex, locked, visible, settings }`
- **Canonical ID format:** `{moduleId}:widget:{manifestId}` (e.g. `builtin:widget:media_alert`)
- **Widget catalog:** `convex/moduleWidgets.ts` `list` — populated via the `MODULE_WIDGET_REGISTERED` webhook (`convex/http.ts` → `moduleWidgets.registerFromWebhook`). Note: this query is currently global (not instance-scoped).
- **MediaAlert (how it's "installed"):** It is a **built-in** engine widget defined in `woofx3/streamware/src/builtin-widgets.ts` (`canonical_id: builtin:widget:media_alert`, `surface: "scene"`). On engine startup the streamware publishes a `module.widget.registered` event (module_key `builtin`); the API service forwards it as a `MODULE_WIDGET_REGISTERED` webhook, and Convex upserts it into `moduleWidgets` (with `moduleId: undefined`). So it appears in the widget bar **automatically** once the engine has emitted that webhook — there is no per-scene install step. It does **not** arrive via the periodic `getAvailableWidgets` sync, which skips widgets with no resolvable module.

## Browser source

### Generating a URL

The **link icon** dropdown in the editor header offers **Copy URL** and **Rotate URL (revoke old)**.

- The copied URL targets **`{CONVEX_SITE_URL}/browser-source/{key}`** — the route is served by Convex, not the SPA origin, so OBS loads it directly.
- `api.browserSource.getOrCreateBrowserSourceKey` is idempotent (one key per scene) and membership-checked.
- `api.browserSource.rotateBrowserSourceKey` revokes all existing keys for the scene and issues a fresh one; `revokeBrowserSourceKeys` revokes without reissuing. A leaked OBS URL stops resolving the moment its key is revoked.

### HTML renderer (`GET /browser-source/{key}`)

Engine-authoritative: the **engine renders the overlay**, so this page is a thin wrapper.

1. Resolve `key` → scene (cache) → `engineSceneId` + `instanceId`; bumps `lastUsedAt`.
2. Resolve the instance's `engineSceneOverlayBaseUrl` via `internal.engineInfo.getEngineOverlayInfo` (cached on the instance with a TTL; one engine RPC on refresh).
3. Return HTML that iframes **`{engineSceneOverlayBaseUrl}/{engineSceneId}`**.

Security: the iframe is cross-origin (engine domain) and sandboxed **`allow-scripts` only — never `allow-same-origin`** (the previous combination defeated the sandbox). All interpolated values (`scene.name`, overlay URL) are HTML-escaped — see `convex/lib/browserSourceHtml.ts` (unit-tested in `browserSourceHtml.test.ts`). An un-synced scene or an engine with no overlay base configured renders a transparent placeholder.

> Note: the old `/api/widgets/{...}/index.html` stub in `convex/http.ts` is **no longer used** by the scene overlay (it predates this work and is still referenced only by the unrouted legacy alert renderer `client/src/pages/browser-source.tsx`).

### JSON endpoint (`POST /api/browser-source/{key}/claim`)

Returns `{ scene, slots, alertDescriptors, sourceKeyId }` — used by the legacy alert browser-source runtime (separate from scene overlays).

## Convex actions (`convex/sceneActions.ts`)

| Action | Engine RPC | Description |
|--------|-----------|-------------|
| `createScene` | `rpc.createScene()` | Create scene in engine, returns `engineSceneId` |
| `updateScene` | `rpc.updateScene()` | Patch scene (name, description, widgetsJson, layoutJson) |
| `deleteScene` | `rpc.deleteScene()` | Delete scene from engine |
| `getAvailableWidgets` | `rpc.getAvailableWidgets()` | Fetch scene-surface widgets from engine |

All actions use `requireInstanceContext` (same pattern as `workflowActions.ts`) and fresh `createEngineRpcSession` per call.

## Widget data model

Widgets stored in `scene.widgets` (Convex `any[]`) match the engine's `widgets_json` shape:

```typescript
interface Widget {
  id: string;                    // stable per-placement UUID
  widgetCanonicalId: string;     // {moduleId}:widget:{manifestId}
  name: string;                  // display name
  position: { x: number; y: number };
  size: { width: number; height: number };
  rotation: number;
  opacity: number;               // 0-100
  zIndex: number;
  locked: boolean;
  visible: boolean;
  settings: Record<string, unknown>;  // per-instance widget configuration
}
```
