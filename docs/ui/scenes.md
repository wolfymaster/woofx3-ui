# Scenes and overlays

**Routes:** `/stream/scenes` (table listing), `/stream/scenes/:id` (editor)
**Primary files:** `client/src/pages/scenes.tsx` (listing + route split), `client/src/components/scenes/scene-canvas-editor.tsx` (editor), `client/src/components/scenes/widget-catalog-sidebar.tsx` (widget rail)
**Convex:** `convex/scenes.ts`, `convex/sceneActions.ts`, `convex/moduleWidgets.ts`, `convex/browserSource.ts`  
**HTTP:** `convex/http.ts` — `/browser-source/{key}` (redirect to the engine overlay)

## Architecture

**Engine-authoritative.** The woofx3 engine is the source of truth for scene data.

```
UI → Convex action (sceneActions.ts) → Engine RPC → Engine webhook → Convex cache → UI query
```

Convex stores a read-optimized cache of scenes. **All UI writes go through `convex/sceneActions.ts`** (engine RPC) — `convex/scenes.ts` exposes **queries only**; it has no public create/update/delete mutations (a second write path would fight the webhook writer). The engine publishes `SCENE_CREATED/UPDATED/DELETED` webhooks that update the cache via `convex/scenes.ts:upsertFromWebhook` / `deleteFromWebhook`.

Because writes round-trip through the engine, the UI is **eventually consistent**: after `createScene` the editor shows a "waiting for sync" state until the webhook lands; after a save the editor guards local edits against the webhook re-push with a dirty flag.

**Identity & keying:** the cache is keyed on `engineSceneId` (the engine's stable id) via the `by_engine_scene_id` index — never on `name` or a positional `.first()`. Routes use `engineSceneId` as the `:id` param (`getByEngineSceneId`). Webhook upserts/deletes are idempotent on redelivery.

**Authorization:** scene actions and cache queries gate on instance membership (any role) — consistent with the engine having no user/role concept.

## Layout

`scenes.tsx` picks one of two screens from the route — there is no master-detail shell and no scene-list rail.

- **`/stream/scenes` — the listing.** A Commands-style table (`PageHeader`, search, **New Scene**, one `Card` table) with columns scene (name + description), canvas size, widget count, and actions. Row click or the pencil opens the editor; the trash deletes through `sceneActions.deleteScene` behind a confirm. A scene the engine has not acknowledged yet (no `engineSceneId`) still gets a row, marked **Syncing** with its actions disabled, rather than being hidden.
- **`/stream/scenes/:id` — the editor.** `SceneCanvasEditor`, mounted with `key={engineSceneId}` so switching scenes resets local edit state. It shows a "waiting for sync" state until the cache row for a just-created scene arrives.

The rail only appears once a scene is selected, and it belongs to the editor: `WidgetCatalogSidebar` lists every widget that can be added, grouped by module, and clicking one drops it on the canvas. It uses the shared `SIDEBAR_RAIL` style, so it is the same width and surface as the section subnav on other pages.

The editor has three regions:

1. **Header** — back to the listing, editable name, a **scene-settings popover** (gear: description, width/height, background), the **browser-source dropdown** (Copy / Rotate), Save (dirty-gated) or, on an engine with editor sessions, the sync status with **Discard** and **Publish** (see [Editor sessions](#editor-sessions)), and a `⋮` menu (Duplicate / Delete scene, via `sceneActions`).
2. **Widget catalog rail** — installed widgets from `useQuery(api.sceneWidgets.listForInstance)`; clicking one adds it to the canvas.
3. **Canvas** — `flex-1` zoomable surface with absolute-positioned placeholder boxes (the engine renders real widgets in the overlay; this is a layout surface). Drag to move, corner handle to resize; clicking the background deselects. Zoom in/out and fit sit in the bottom-left corner (the canvas has no grid overlay — the width and height live in the scene-settings popover). Selecting a widget opens its settings panel on the right; each row of the layers list carries the widget's delete button.
4. **Right rail** — **Layers** on top (each with a show/hide eye: a hidden widget keeps running on stream, out of sight, and is struck through here and hatched on the canvas so it can still be placed), then the selected widget's settings (or a canvas summary when nothing is selected). Layers are listed topmost first; clicking one selects it, and dragging one by its grip (or arrow keys on a focused grip) moves it up or down the stack. A move renumbers every widget's `zIndex` from 1 at the bottom and stores the widgets bottom first, because the editor stacks by `zIndex` while the engine's Scene Manager stacks by array order (`moveLayer` in `client/src/lib/layer-order.ts`). The scene saves straight away after a move, as it does after adding a widget: the draft layout posted to the preview carries position and size but not order, so only a save restacks the real widgets. The Alert action's layout editor shares this rail (`OverlayEditorShell`, `LayersList`), with the same reordering.

### Preview vs. browser source

Both surfaces render the **same engine overlay**, from the same `scene.publicUrl` setting (Admin → Storage → "Scene Manager Public URL"): the engine mints `{publicUrl}/scene/{engineSceneId}?token={token}` and that is what actually draws the widgets. They differ only in how they reach it.

- **Canvas preview** — `browserSource.getOrCreatePreviewUrl` returns that engine URL and `LiveScenePreview` embeds it **directly**. The editor is an authenticated view of the instance, so it has no reason to hide the engine URL from itself, and going direct keeps the frame's ancestor chain to two sites. That matters: a third site in the chain makes every request from inside the overlay cross-site, which drops Scene Manager's `SameSite=Strict` session cookie — the cookie authorizing the widget frames (`/scene/{id}/widget/{instanceId}`) and the SSE stream (`/events`). A UI and an engine sharing a registrable domain (`ui.x.tv` / `scenes.x.tv`) stay same-site, and the overlay renders.
- **Browser source** — `/browser-source/{key}` gives OBS a stable Convex URL and **redirects** it to the same engine URL. The opaque key is what you rotate or revoke; the token behind it can be re-minted without re-pasting anything into OBS. It redirects rather than wrapping the engine in its own page for the reason above: framed under `convex.site`, the overlay is cross-site to its top-level document, the `SameSite=Strict` cookie is withheld, and the widget frames and `/events` answer 401.

Each has its own overlay token, so rotating the public browser-source URL never disturbs the preview.

### Live updates

The overlay bakes the scene config into its page when it loads, so two things keep it current:

- **While editing** — `LiveScenePreview` posts the editor's draft into the preview frame on every change and every frame load, as a `woofx3.scene-preview.layout` message (`client/src/lib/scene-preview-layout.ts`). Its `widgets` (each widget's id, position and size) move widget elements at once, and any widget the layout leaves out is hidden. Its `placements` (the widgets as the scene stores them, settings included) make an added or reconfigured widget show before a save: once the widgets or their settings change and typing has paused, the overlay posts them to `POST /scene/{sceneId}/draft-config`, which parses them as it would a saved scene and frames each by a draft-frame URL rendering its draft settings. Only widgets whose frame would differ reload. A placement whose settings are too long to carry in that URL keeps its saved frame until a save. Nothing is saved, and only a page that frames the overlay can send the message, so OBS, which loads the overlay top-level, never acts on it.
- **After a save** — the engine's db publishes `db.scene.updated`, and Scene Manager pushes a `scene-updated` frame down the event stream of every overlay open on that scene. Each one fetches the saved config (`GET /scene/{sceneId}/config`, authorized by the overlay's own session cookie) and applies only what changed, so OBS browser sources pick up the saved scene without a manual refresh and without restarting widgets the save didn't touch. A moved or resized widget is re-placed; a widget whose frame would differ — its settings, its widget, its module — is mounted again on its own; removed and added widgets are unmounted and mounted. Stacking follows the saved array order, bottom first. In the editor's preview the draft wins: once the editor has posted placements, an update applies the draft rather than the saved scene, so a save never undoes an edit made after it, and a save that matches the draft on screen reloads nothing. If the fetch fails, the overlay falls back to reloading.

A cached URL that is not the current `{publicUrl}/scene/{engineSceneId}?token=…` shape — anything minted before Scene Manager replaced streamware's overlay path — is treated as a cache miss and re-minted (`convex/lib/sceneOverlayUrl.ts`), and `/browser-source/{key}` shows its placeholder rather than redirecting to a dead URL.

**Local Network Access.** The preview iframe carries `allow="local-network-access"`. When an engine hostname resolves to a LAN address (split-horizon DNS in dev — `streamware.dev.woofx3.tv` → `192.168.0.x`), Chrome treats the load as a public page reaching the local network and gates it behind a permission whose default allowlist is `self`; without the attribute it is auto-denied with no prompt and the overlay silently renders nothing. The attribute is inert once the engine resolves to a public address. The browser source is a top-level redirect, so it has no frame to delegate to — and OBS does not enforce Local Network Access in any case.

On an engine without editor sessions, saves go through `useAction(api.sceneActions.updateScene)` (`widgetsJson` + `layoutJson`); a dirty flag drives the Save button and protects in-flight edits from the post-save webhook re-push.

### Editor sessions

An engine with the `scenes.editorSessions` capability edits the scene live through its Scene Manager, and there is no Save button: every change is sent as it is made and saved for you, into a **draft** that OBS does not show until it is **published**. **Discard** throws the draft away. (Engine side: woofx3 docs/services/scene-documents.md.)

- **Connecting.** `useSceneEditorSession` asks `sceneActions.getSceneEditorSession` for a short-lived token and opens Scene Manager's editor socket at the origin the preview overlay is served from (`/scene/{id}/edit`). A dropped socket reconnects with a fresh token.
- **Sending edits.** The editor keeps its React state as before. `mutateScene`, which every edit passes through, hands the new canvas to the session (`documentOfCanvas` in `client/src/lib/scene-document-widgets.ts`), and `SceneEditorClient` (`client/src/lib/scene-editor-client.ts`) sends the difference from what it last saw as json0 ops at most every 200 ms: one op in flight, later edits composed into one, text as splices. Edits go to the session from `mutateScene` and never from an effect on the scene state, so a render after another editor's change cannot send back the canvas it replaced.
- **Other editors.** Their ops arrive on the socket, are transformed against the pending local ones (as the server transforms the local ones against them), and become the canvas (`canvasOfDocument`); two people typing in one field both keep their typing. Unconfirmed edits survive a reconnect: they are resent against the number they were made at, and the server knows one it already applied.
- **Preview.** The preview overlay loads with `?view=draft` and follows the draft as Scene Manager sequences it. The editor still posts widget positions while dragging, for instant feedback, but no longer posts placements.
- **Name and description** are not part of the scene document; they save through `updateScene` a moment after typing stops.
- **Live.** The header's **Live** switch sends this editor's changes to the published scene instead of the draft, so they reach OBS as they are made (a red **LIVE** badge says so). The engine copies each live change into the draft too, so a later publish cannot undo it, and the draft keeps its other edits. Each open editor chooses for itself and starts on the draft; in live mode the preview shows what is published.
- **Who else is editing.** Each editor tells the others its name and the widget it has selected (`setPresence`, from the canvas's `onSelectionChange`). Widgets another editor has selected get an outline and a name tag in that editor's colour (`remoteSelections` on `WidgetLayoutCanvas`). Nothing about presence is stored.

## Widget System

Widgets are **engine-registered module widgets only** — no arbitrary/custom widget types.

- **Widget type:** `{ id, widgetCanonicalId, name, position, size, rotation, opacity, zIndex, locked, visible, settings }`
- **Canonical ID format:** `{moduleId}:widget:{manifestId}` (e.g. `woofx3:widget:text`)
- **Widget catalog:** `convex/moduleWidgets.ts` `list` — populated via the `MODULE_WIDGET_REGISTERED` webhook (`convex/http.ts` → `moduleWidgets.registerFromWebhook`). Note: this query is currently global (not instance-scoped).
- **Surfaces:** each catalog row carries `surfaces` (`scene`, `alert`). The scene editor offers only widgets placeable on a scene; the Alert action's layout editor offers only widgets placeable in an alert. Rows without `surfaces` are scene widgets.
- **Alert widgets:** the bundled `woofx3:widget:alert` (its catalog row has `hostsSurface: "alert"`) is a named area where alerts play. The scene manager draws it, so it has no frame of its own and the editor shows only its placeholder. The editor names a scene's first alert widget `default` and later ones `alert-2`, `alert-3`…; an Alert action plays on every alert widget with its target name. `convex/lib/alertWidgets.ts` holds the naming rules, which must match the scene manager's.
- **Bundled widgets** (Alert, Text, Image, Video, Audio, Lottie) arrive through the bundled `woofx3` module's install, as a `MODULE_WIDGET_REGISTERED` webhook like any module widget, and are grouped as "Built-in".

- **Themes:** a widget that declares a theme contract gets a `theme` settings field from the engine (manifests cannot declare it). The settings panel renders it as a picker (`components/scenes/theme-field.tsx`) offering **Default** plus the installed themes that fit the widget's contract, fetched with `sceneActions.listWidgetThemes` → engine `listWidgetThemes(widgetCanonicalId)`. The stored value is the theme's canonical id (`{moduleId}:theme:{id}`) in `settings.theme`; Default leaves it unset. A stored theme that is no longer installed or no longer compatible gets a notice, because the overlay renders the widget's defaults for it. Themes come and go only with module installs, so the picker refetches when `moduleRepository.installedRevision` changes (the `module.installed` and `module.deleted` webhooks move it).

The canvas itself — palette, drag/resize handles, placeholders and the settings panel — is `WidgetLayoutCanvas`, shared by the scene editor and the Alert action's layout editor (`alert-layout-field.tsx`). It edits whatever widgets it is handed and saves nothing.

## Browser source

### Generating a URL

The **link icon** dropdown in the editor header offers **Copy URL** and **Rotate URL (revoke old)**.

- The copied URL targets **`{CONVEX_SITE_URL}/browser-source/{key}`** — the route is served by Convex, not the SPA origin, so OBS loads it directly.
- `api.browserSource.getOrCreateBrowserSourceKey` is idempotent (one key per scene) and membership-checked.
- `api.browserSource.rotateBrowserSourceKey` revokes all existing keys for the scene and issues a fresh one; `revokeBrowserSourceKeys` revokes without reissuing. A leaked OBS URL stops resolving the moment its key is revoked.

### Redirect (`GET /browser-source/{key}`)

Engine-authoritative: the **engine renders the overlay**, so this route only resolves the key and hands off.

1. Resolve `key` → source key → scene (cache); bumps `lastUsedAt`.
2. If the scene hasn't synced (no `engineSceneId`) or the cached `overlayUrl` isn't the current `/scene/{engineSceneId}?token=…` shape, render a transparent placeholder.
3. Otherwise **`302`** to the cached `overlayUrl`, with `Cache-Control: no-store` so every OBS load re-resolves the key and picks up a rotated token.

**Why a redirect, not an iframe.** Scene Manager's shell (`GET /scene/{id}?token=…`) is the only engine route that accepts the token. It trades it for an `sm_session` cookie marked `SameSite=Strict`, and the widget frames, the `/events` SSE stream, and delivery acks authenticate with that cookie alone. Framed under `convex.site`, all of those are cross-site to the top-level document, so the browser withholds the cookie and they 401 — the shell loads, but no widget or event ever arrives. After the redirect the overlay is the top-level document and the cookie flows. See `buildBrowserSourceRedirect` in `convex/lib/browserSourceHtml.ts` (unit-tested in `browserSourceHtml.test.ts`); placeholder values are HTML-escaped there too.

The engine URL, token included, is visible once the redirect lands — as it already was in the old wrapper page's iframe `src`. A leaked engine URL stays valid until its token is revoked.

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
  opacity: number;               // 0 (transparent) to 1 (opaque)
  zIndex: number;
  locked: boolean;
  visible: boolean;
  settings: Record<string, unknown>;  // per-instance widget configuration
}
```

### Showing and hiding from a workflow

The engine's `scene.widget.visibility` action (capability `workflow.widgetVisibility`) shows or hides a widget, and the change is saved with the scene like an edit, so the layers list shows it. Its form uses two field sources the action editor resolves (`client/src/components/workflows/scene-field-renderers.tsx`): `scenes`, the instance's scenes by engine id, and `scenePlacements`, the widgets on the scene chosen in the field named by `sceneField`, topmost first (`client/src/lib/scene-field-options.ts`). A custom renderer is handed every field's value for this. A step pointing at a deleted scene or widget shows it as no longer there.
