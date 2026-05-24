# Scenes and overlays

**Routes:** `/scenes`, `/scenes/:id`  
**Primary files:** `client/src/pages/scenes.tsx`, `client/src/pages/scene-editor.tsx`  
**Convex:** `convex/scenes.ts`, `convex/sceneActions.ts`, `convex/moduleWidgets.ts`, `convex/browserSource.ts`  
**HTTP:** `convex/http.ts` — `/browser-source/{key}` (HTML renderer), `/api/browser-source/{key}/claim` (JSON)

## Architecture

**Engine-authoritative.** The woofx3 engine is the source of truth for scene data.

```
UI → Convex action (sceneActions.ts) → Engine RPC → Engine webhook → Convex cache → UI query
```

Convex stores a read-optimized cache of scenes. All mutations go through `convex/sceneActions.ts` which calls the engine via `createEngineRpcSession`. The engine publishes `scene.created/updated/deleted` webhooks that update the Convex cache via `convex/scenes.ts:upsertFromWebhook`.

## Widget System

Widgets are **engine-registered module widgets only** — no arbitrary/custom widget types.

- **Widget type:** `{ id, widgetCanonicalId, name, position, size, rotation, opacity, zIndex, locked, visible, settings }`
- **Canonical ID format:** `{moduleId}:widget:{manifestId}` (e.g. `builtin:widget:media_alert`)
- **Widget catalog:** `convex/moduleWidgets.ts` — populated via `MODULE_WIDGET_REGISTERED` webhook
- **MediaAlert:** Built-in widget registered at streamware startup, always available

## Scenes list (`/scenes`)

- Uses `useQuery(api.scenes.list)` from `convex/react` — live Convex subscription
- Create: `useMutation(api.scenes.create)` — writes to Convex, engine sync via webhook
- Delete: `useMutation(api.scenes.remove)`
- Duplicate: `useMutation(api.scenes.duplicate)`

## Scene editor (`/scenes/:id`)

- Loads scene via `useQuery(api.scenes.get, { sceneId })`
- Saves via `useMutation(api.scenes.update)` — persists widgets array and layout
- Widget palette: `useQuery(api.moduleWidgets.list)` — dynamic from engine catalog
- Canvas: absolute-positioned widget placeholders (real widget iframes deferred)
- Layers panel: drag-to-reorder z-index via `@dnd-kit`
- Properties panel: transform (position/size/rotation), appearance (opacity/visibility/lock), widget canonical ID

## Browser source

### Generating a URL

Click the **link icon** in the scene editor header → copies `/browser-source/{key}` to clipboard.

The key is created via `api.browserSource.getOrCreateBrowserSourceKey` (idempotent — one key per scene).

### HTML renderer (`GET /browser-source/{key}`)

Returns a complete HTML page with:
- Transparent background, no scrollbars
- Container sized by scene `width × height`
- One `<iframe>` per widget, absolutely positioned by `widget.position`
- Iframes sandboxed: `allow-scripts allow-same-origin`
- Widget assets served from `/api/widgets/{canonicalId}/index.html`

### JSON endpoint (`POST /api/browser-source/{key}/claim`)

Returns `{ scene, slots, alertDescriptors, sourceKeyId }` — used by the legacy browser-source runtime.

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
  position: { x: number; y: number; width: number; height: number };
  size: { width: number; height: number };
  rotation: number;
  opacity: number;               // 0-100
  zIndex: number;
  locked: boolean;
  visible: boolean;
  settings: Record<string, unknown>;  // per-instance widget configuration
}
```
