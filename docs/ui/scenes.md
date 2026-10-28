# Scenes and overlays

**Routes:** `/stream/scenes` (table listing), `/stream/scenes/:id` (editor)
**Primary files:** `client/src/pages/scenes.tsx` (listing + route split), `client/src/components/scenes/scene-canvas-editor.tsx` (editor), `client/src/components/scenes/widget-layout-canvas.tsx` (canvas, palette, layers, settings), `client/src/hooks/use-composition-editor.ts` (the headless editor)
**Convex:** `convex/scenes.ts`, `convex/sceneActions.ts`, `convex/moduleWidgets.ts`, `convex/browserSource.ts`  
**HTTP:** `convex/http.ts` — `/browser-source/{key}` (redirect to the engine overlay)

## Architecture

**Engine-authoritative.** The woofx3 engine is the source of truth for scene data.

```
UI → Convex action (sceneActions.ts) → Engine RPC → Engine webhook → Convex cache → UI query
```

Convex stores a read-optimized cache of scenes. **All UI writes go through `convex/sceneActions.ts`** (engine RPC) — `convex/scenes.ts` exposes **queries only**; it has no public create/update/delete mutations (a second write path would fight the webhook writer). The engine publishes `SCENE_CREATED/UPDATED/DELETED` webhooks that update the cache via `convex/scenes.ts:upsertFromWebhook` / `deleteFromWebhook`.

Because writes round-trip through the engine, the UI is **eventually consistent**: after `createScene` the editor shows a "waiting for sync" state until the webhook lands; after a save the editor guards local edits against the webhook re-push with a dirty flag.

**Alerts are not scenes here.** The engine stores alert compositions in the same table (`kind: "alert"`) and reports them with the same `scene.*` webhooks, which carry `kind`, `behaviorsJson` and `inputsJson`. `upsertFromWebhook` sends an alert to the separate `alertCompositions` cache (`convex/alertCompositions.ts`) and removes any scene row under its id, so no scene listing, getter, browser source or scene child table ever holds one. A delete names its kind; one without (an older engine) is looked for in both caches (`tablesForDeletedComposition`). The JSON payloads are parsed totally (`shared/scene-serialization.ts`), and an alert's `$input` keys are escaped for Convex. The alert library and its actions are described in [Chat commands: The alert library](./commands.md#the-alert-library).

**Identity & keying:** the cache is keyed on `engineSceneId` (the engine's stable id) via the `by_engine_scene_id` index — never on `name` or a positional `.first()`. Routes use `engineSceneId` as the `:id` param (`getByEngineSceneId`). Webhook upserts/deletes are idempotent on redelivery.

**Authorization:** scene actions and cache queries gate on instance membership (any role) — consistent with the engine having no user/role concept.

## Layout

`scenes.tsx` picks one of two screens from the route — there is no master-detail shell and no scene-list rail.

- **`/stream/scenes` — the listing.** A Commands-style table (`PageHeader`, search, **New Scene**, one `Card` table) with columns scene (name + description), canvas size, widget count, and actions. Row click or the pencil opens the editor; the trash deletes through `sceneActions.deleteScene` behind a confirm. A scene the engine has not acknowledged yet (no `engineSceneId`) still gets a row, marked **Syncing** with its actions disabled, rather than being hidden.
- **`/stream/scenes/:id` — the editor.** `SceneCanvasEditor`, mounted with `key={engineSceneId}` so switching scenes resets local edit state. It shows a "waiting for sync" state until the cache row for a just-created scene arrives.

The editor has four regions:

1. **Header** — on the left, back to the listing, the editable name and, on an engine with editor sync, the sync status, which sits there so its changing length never moves the controls on the right. On the right, in order: **Copy OBS URL** with a dropdown holding Rotate; Save (dirty-gated) or, on an engine with editor sync, the **Draft / Live** toggle, **Discard** and **Publish** (see [Editor sessions](#editor-sessions)); then the **scene-settings popover** (gear: description, width/height, background) and a `⋮` menu (Duplicate / Delete scene, via `sceneActions`). Nothing in the header appears or disappears with the mode, so switching never moves a control.
2. **Widget palette** (left rail) — the installed widgets a scene takes (`useQuery(api.sceneWidgets.listForInstance)`, narrowed by the editor to the `scene` surface), grouped by taxonomy; clicking one adds it to the canvas.
3. **Canvas** — zoomable surface with absolute-positioned placeholder boxes (the engine renders real widgets in the overlay; this is a layout surface). Drag to move, corner handle to resize; clicking the background deselects. While a widget is dragged or resized it snaps to the canvas's edges and centre lines and to other widgets' edges and centres, and the line it snapped to shows as a thin guide (hold Alt to place it freely; Shift while resizing flips the aspect lock, which images and video keep by default). A rotated widget is drawn rotated. Zoom out, in and Fit sit at the bottom of the stage (the canvas has no grid overlay — the width and height live in the scene-settings popover).
4. **Right rail** — **Layers** on top (each with a show/hide eye: a hidden widget keeps running on stream, out of sight, and is struck through here and hatched on the canvas so it can still be placed; and a delete button), then the selected widget's settings (or a canvas summary when nothing is selected). Layers are listed topmost first; clicking one selects it, and dragging one by its grip (or arrow keys on a focused grip) moves it up or down the stack. A move changes only the moved widget's stacking key (`z`, a fractional key: see [The editor](#the-editor)). The Alert action's layout editor shares this rail (`OverlayEditorShell`, `LayersList`).

**Keyboard.** With focus anywhere but a text field, menu, dialog or layer grip: arrows nudge the selection (Shift: by 10), Delete or Backspace deletes it, Escape deselects (or cancels a drag), Ctrl/Cmd+Z undoes and Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y redoes, Ctrl/Cmd+D duplicates, Ctrl/Cmd+C, X and V copy, cut and paste, Ctrl/Cmd+A selects every widget, `]` and `[` move the selection up and down the stack (with Ctrl/Cmd: to the top or bottom), Ctrl/Cmd+Shift+H shows or hides it, Ctrl/Cmd+Shift+L locks or unlocks it, and Ctrl/Cmd with `=`, `-` or `0` zooms in, out or to fit. Shift-click adds a widget to the selection or takes it out. The bindings are the editor's (`DEFAULT_KEYMAP` in `@woofx3/scene/editor`); `useEditorKeys` forwards key presses to it.

## The editor

The scene editor's components are views over the engine's headless composition editor, `createCompositionEditor` from `@woofx3/scene/editor` (woofx3 `shared/clients/typescript/scene/editor/`). The editor holds the selection, gestures, snapping, stacking, history, clipboard and zoom, and makes every change to the document; the components draw its state and forward input to it. Nothing in the dashboard computes geometry or edits a scene document itself.

- **Making it.** `useCompositionEditor` (`client/src/hooks/use-composition-editor.ts`) creates the editor for a document source with a profile (`PROFILES.scene` here; the alert editor passes `PROFILES.alert`) and the catalog (`catalogOfRows` in `client/src/lib/scene-composition.ts`), and reads its state with `useSyncExternalStore`. The editor is made again when the source or profile changes; its history goes with it, and the selection is carried over. A new catalog is handed to the editor it has.
- **Where the document lives.** The source is the only difference between the two ways a scene is edited. In session mode it is a `SyncDocumentSource` around the scene's `SceneSyncClient`, for the version being edited (see [Editor sessions](#editor-sessions)). Until the session has loaded the scene, and on an engine without editor sync, it is a `LocalDocumentSource` holding the cached scene (`compositionOfStoredScene`), read-only except in the Save-button editor.
- **Input.** A press on a widget begins an editor gesture (`editor.gesture.begin`), pointer moves update it once per animation frame, and the release commits the whole drag or resize as one change, so it is one undo and one item on the wire; mid-gesture boxes are the editor's transient state, and the canvas and the preview both show them. The layers list calls `editor.nodes.reorder`, the eye `editor.nodes.patch(id, { visible })`, delete `editor.nodes.remove`, the palette `editor.nodes.add` (the editor sizes and places the new widget and names alert areas), and the settings panel `editor.nodes.patch(id, { settings })`. Keys go to `editor.handleKey`. A change the editor or the source refuses changes nothing, and a toast says why.
- **Canvas settings.** The scene-settings popover changes width, height and background through `editor.canvas.patch`, an editor change like any other: one undo, and refused with the editor's reason (a size that is not a positive number, a draft that is read-only while a command runs).
- **Undo.** Undo and redo revert only this editor's own changes, transformed past what other editors changed since.

### Transitions and effects

Below the selected widget's settings, the inspector edits the widget's behaviors (`components/scenes/widget-behaviors-section.tsx`, shared by the scene editor and the alert editor). A behavior is a `transition`, `effect` or `activity` entry in the composition's `behaviors`, targeting the widget; every control calls `editor.behaviors.add`, `.patch`, `.remove` or `.reorder`, and a change the editor's type registry refuses changes nothing and shows the registry's reason as a toast, as any other edit.

- **Enter and Exit.** Each picker is a transition with `params.phase` `in` or `out`: None (no behavior), a kind, a duration in ms held to the registry's `MIN_TRANSITION_MS`..`MAX_TRANSITION_MS`, an easing (the phase's default marked), and for `slide` a direction. The kinds are the editor catalog's `offeredKinds(row, "transition")`: the host kinds every widget gets (Any widget), then the ones the widget declares and plays itself (This widget). A stored kind the widget is no longer offered stays listed as not available rather than reading as another.
- **Effects.** A list in the effects' `order`: add (a `pulse` to start), remove, move up or down, a kind from `offeredKinds(row, "effect")`, and for a host kind its params (shake and float distance and cycle, pulse scale and cycle, glow colour, radius and cycle, flash brightness and cycle, blur radius). The params' inputs and bounds are read from the registry's schema for the effect type, and an absent param shows the value the overlay plays without it (`EFFECT_DEFAULTS`). Each effect's timing is a delay from its anchor (when the widget enters; on an alert also when the alert starts) and a length or "until it leaves". A widget's own kind has no params here: they are the widget's.
- **Preview.** A small box beside a transition or effect plays it with the overlay's own keyframes (`compileAnimation`), an effect for at most 3 s. A widget's own kind can only be seen in the overlay preview.

The pure parts (picker options, the param form, timing labels, the preview animation) are `client/src/lib/behavior-editor.ts`.

### Preview vs. browser source

Both surfaces render the **same engine overlay**, from the same `scene.publicUrl` setting (Admin → Storage → "Scene Manager Public URL"): the engine mints `{publicUrl}/scene/{engineSceneId}?token={token}` and that is what actually draws the widgets. They differ only in how they reach it.

- **Canvas preview** — `browserSource.getOrCreatePreviewUrl` returns that engine URL and `LiveScenePreview` embeds it **directly**. The editor is an authenticated view of the instance, so it has no reason to hide the engine URL from itself, and going direct keeps the frame's ancestor chain to two sites. That matters: a third site in the chain makes every request from inside the overlay cross-site, which drops Scene Manager's `SameSite=Strict` session cookie — the cookie authorizing the widget frames (`/scene/{id}/widget/{instanceId}`) and the SSE stream (`/events`). A UI and an engine sharing a registrable domain (`ui.x.tv` / `scenes.x.tv`) stay same-site, and the overlay renders.
- **Browser source** — `/browser-source/{key}` gives OBS a stable Convex URL and **redirects** it to the same engine URL. The opaque key is what you rotate or revoke; the token behind it can be re-minted without re-pasting anything into OBS. It redirects rather than wrapping the engine in its own page for the reason above: framed under `convex.site`, the overlay is cross-site to its top-level document, the `SameSite=Strict` cookie is withheld, and the widget frames and `/events` answer 401.

Each has its own overlay token, so rotating the public browser-source URL never disturbs the preview.

### Live updates

The overlay bakes the scene config into its page when it loads, so two things keep it current:

- **While editing** — `LiveScenePreview` posts the editor's draft into the preview frame on every change and every frame load, as a `woofx3.scene-preview.layout` message built by the editor (`editor.preview.layoutMessage()`), mid-drag boxes included. Its `widgets` (each widget's id, position and size) move widget elements at once, and any widget the layout leaves out is hidden. Its `placements` (the widgets as the scene stores them, settings included) make an added or reconfigured widget show before a save: once the widgets or their settings change and typing has paused, the overlay posts them to `POST /scene/{sceneId}/draft-config`, which parses them as it would a saved scene and frames each by a draft-frame URL rendering its draft settings. Only widgets whose frame would differ reload. A placement whose settings are too long to carry in that URL keeps its saved frame until a save. Nothing is saved, and only a page that frames the overlay can send the message, so OBS, which loads the overlay top-level, never acts on it.
- **After a save** — the engine's db publishes `db.scene.updated`, and Scene Manager pushes a `scene-updated` frame down the event stream of every overlay open on that scene. Each one fetches the saved config (`GET /scene/{sceneId}/config`, authorized by the overlay's own session cookie) and applies only what changed, so OBS browser sources pick up the saved scene without a manual refresh and without restarting widgets the save didn't touch. A moved or resized widget is re-placed; a widget whose frame would differ — its settings, its widget, its module — is mounted again on its own; removed and added widgets are unmounted and mounted. Stacking follows the saved array order, bottom first. In the editor's preview the draft wins: once the editor has posted placements, an update applies the draft rather than the saved scene, so a save never undoes an edit made after it, and a save that matches the draft on screen reloads nothing. If the fetch fails, the overlay falls back to reloading.

A cached URL that is not the current `{publicUrl}/scene/{engineSceneId}?token=…` shape — anything minted before Scene Manager replaced streamware's overlay path — is treated as a cache miss and re-minted (`convex/lib/sceneOverlayUrl.ts`), and `/browser-source/{key}` shows its placeholder rather than redirecting to a dead URL.

**Local Network Access.** The preview iframe carries `allow="local-network-access"`. When an engine hostname resolves to a LAN address (split-horizon DNS in dev — `streamware.dev.woofx3.tv` → `192.168.0.x`), Chrome treats the load as a public page reaching the local network and gates it behind a permission whose default allowlist is `self`; without the attribute it is auto-denied with no prompt and the overlay silently renders nothing. The attribute is inert once the engine resolves to a public address. The browser source is a top-level redirect, so it has no frame to delegate to — and OBS does not enforce Local Network Access in any case.

On an engine without editor sync, the editor works on the cached scene in memory and saves go through `useAction(api.sceneActions.updateScene)` (`widgetsJson` + `layoutJson`, from `storedSceneJson`, the widgets bottom first as the engine stores them). The canvas is unsaved while the editor shows any document other than the one last taken from the cache or saved; that and an unsaved name or description drive the Save button and protect in-flight edits from the post-save webhook re-push. An engine that reports only `scenes.editorSessions` speaks the older editor socket protocol, which this dashboard no longer speaks: it gets the Save-button editor, which changes the published scene, and a notice to upgrade the engine to edit drafts live. While the engine's capabilities are still loading, or when asking for them failed (with a Retry), the editor is read-only with Save off, so a save cannot overwrite the live scene of an engine that has editor sync.

### Editor sessions

An engine with the `scenes.editorSync` capability edits the scene live through its Scene Manager, and there is no Save button: every change is sent as it is made and saved for you, into a **draft** that OBS does not show until it is **published**. **Discard** throws the draft away. The sync client, its protocol and its guarantees are described in [Scene editor sync](/patterns/scene-editor-sync); engine side: woofx3 docs/services/scene-documents.md.

- **Connecting.** `useSceneEditorSession` (`client/src/hooks/use-scene-editor-session.ts`) acquires the scene's `SceneSyncClient` (`@woofx3/api/scene-editor`). To open a session the client asks `sceneActions.getSceneEditorSession` for a short-lived token and `browserSource.getOrCreatePreviewUrl` for sceneManager's public origin, and opens `/scene/{id}/edit?token=…&protocol=2` there (`client/src/lib/scene-sync-browser.ts`). A dropped socket reconnects with a fresh token and backoff; an engine that will not give a session is asked again every 30 seconds, and edits made meanwhile wait in the queue.
- **What the canvas shows.** The dashboard keeps no copy of the scene document. The editor's source (`SyncDocumentSource`) reads the version being edited from the client, with every pending edit applied, so an edit shows at once and another editor's change shows as it arrives. Until the client has loaded the scene the canvas shows the cached scene, dimmed and read-only.
- **Sending edits.** The source applies every change the editor makes as `client.edit(version, update)`, a function of the document the client holds at that moment, never of a copy from an earlier render, so it cannot put back what another editor just changed. The client diffs the result, queues it, and sends one item at a time. A change the client refuses (not a valid scene edit) is not applied and a toast says why.
- **Live.** The header's **Draft / Live** toggle only chooses which version the canvas shows and edits: **Draft**, the draft; **Live** (red while selected), the published scene, so changes reach OBS as they are made. The engine copies each live change into the draft too, so a later publish cannot undo it. Each open editor chooses for itself and starts on the draft; in live mode the preview shows what is published.
- **Publish and Discard.** They join the same queue as edits, behind every edit made before the click, so a publish includes the last change made before it. The button shows a spinner and the header says **Publishing…** or **Discarding draft…** while the command is queued or in flight; both buttons are disabled meanwhile, so only one runs at a time. The draft takes no edits until the command's result arrives (the source is read-only meanwhile); a change tried then is refused with a toast. Live edits go on. The buttons are disabled in live mode, where there is nothing to publish, and their tooltips say why; they stay in place so switching modes never moves a control.
- **Status.** The header says **Connecting…**, **Reconnecting…**, **Can't reach the scene manager**, **Saving draft…** (or **Saving · going to stream…** when live) while items are pending, **Saving · retrying…** while the engine answers that it is unavailable, and **Draft saved · not on stream yet**, **Saved · on stream** or **Up to date** once everything is confirmed.
- **Leaving.** Closing the editor stops its client, which keeps delivering what is pending for up to ten seconds, reconnecting if it must. Opening the scene again meanwhile takes the same client back, so its edits stay in one queue. The tab keeps one client per scene (`client/src/lib/scene-editor-sessions.ts`), and its one `beforeunload` listener asks before the tab closes while any client has something pending or the editor has its name or description unsaved.
- **Reports.** Whatever the client could not deliver is reported as a typed `SyncReport` and shown as a toast naming the scene (`syncReportToast`, `client/src/lib/scene-sync-report.ts`), since another scene may be open by then: edits never sent, edits sent but not confirmed (they may have been saved), a Publish or Discard never sent or one that may have gone through. An edit the engine refused is rolled back and the toast says it couldn't be saved. If the engine lost changes it had confirmed (a crash), the editor shows the scene as the engine has it and the toast says so.
- **A deleted scene.** Deleting the scene from the editor closes its client at once, including one still draining after its editor closed, and reports nothing. A scene the engine no longer has (deleted elsewhere) ends the session: the header says **This scene no longer exists** over a read-only canvas, and a toast lists anything that was still pending.
- **Name and description** are not part of the scene document; they save through `updateScene` a moment after typing stops, or at once when the editor closes first. While the scene is being deleted they are not saved: the delete drops them if it succeeds and saves them as soon as it fails, even if the editor has closed since.
- **Preview.** The preview overlay loads with `?view=draft` and follows the draft as Scene Manager sequences it. The editor still posts widget positions while dragging, for instant feedback, but no longer posts placements.
- **Who else is editing.** Each editor tells the others its name and the widget it has selected in the version it is editing (the editor reports its selection to the source's presence channel, which calls `client.setPresence`). Widgets another editor of the same version has selected get an outline and a name tag in that editor's colour (`remoteSelectionsOf` the editor's `peers`, passed as `remoteSelections` to `WidgetLayoutCanvas`). An editor that is draining after it closed shows no selection. Nothing about presence is stored.

## Widget System

Widgets are **engine-registered module widgets only** — no arbitrary/custom widget types.

- **Widget type:** `{ id, widgetCanonicalId, name, position, size, rotation, opacity, zIndex, locked, visible, settings }`
- **Canonical ID format:** `{moduleId}:widget:{manifestId}` (e.g. `woofx3:widget:text`)
- **Widget catalog:** `convex/moduleWidgets.ts` `list` — populated via the `MODULE_WIDGET_REGISTERED` webhook (`convex/http.ts` → `moduleWidgets.registerFromWebhook`). Note: this query is currently global (not instance-scoped).
- **Declared behavior kinds:** each catalog row carries `behaviorKinds` (`{ transitions, effects }`, each a list of `{ id, label }`), the kinds the widget plays itself, from the engine's `WidgetDefinition.behaviorKinds` on the registration webhook and `getAvailableWidgets`. Both paths read it with `readWidgetBehaviorKinds` (`convex/lib/widgetBehaviorKinds.ts`), which keeps only ids the scene model accepts and reads anything else, including an engine that sends none, as no kinds. `catalogWidgetOf` hands it to the editor catalog, which offers these kinds after the host's.
- **Surfaces:** each catalog row carries `surfaces` (`scene`, `alert`). The scene editor offers only widgets placeable on a scene; the Alert action's layout editor offers only widgets placeable in an alert. Rows without `surfaces` are scene widgets.
- **Alert widgets:** the bundled `woofx3:widget:alert` (its catalog row has `hostsSurface: "alert"`) is a named area where alerts play. The scene manager draws it, so it has no frame of its own and the editor shows only its placeholder. The editor names a scene's first alert widget `default` and later ones `alert-2`, `alert-3`…; an Alert action plays on every alert widget with its target name. `shared/alert-widgets.ts` holds the naming rules, which must match the scene manager's.
- **Bundled widgets** (Alert, Text, Image, Video, Audio, Lottie) arrive through the bundled `woofx3` module's install, as a `MODULE_WIDGET_REGISTERED` webhook like any module widget, and are grouped as "Built-in".

- **Themes:** a widget that declares a theme contract gets a `theme` settings field from the engine (manifests cannot declare it). The settings panel renders it as a picker (`components/scenes/theme-field.tsx`) offering **Default** plus the installed themes that fit the widget's contract, fetched with `sceneActions.listWidgetThemes` → engine `listWidgetThemes(widgetCanonicalId)`. The stored value is the theme's canonical id (`{moduleId}:theme:{id}`) in `settings.theme`; Default leaves it unset. A stored theme that is no longer installed or no longer compatible gets a notice, because the overlay renders the widget's defaults for it. Themes come and go only with module installs, so the picker refetches when `moduleRepository.installedRevision` changes (the `module.installed` and `module.deleted` webhooks move it).

The canvas itself — palette, drag/resize handles, placeholders, snap guides, layers and the settings panel — is `WidgetLayoutCanvas`, a view over a composition editor that saves nothing itself. The Alert action's layout (the alert editor route, and the `layout` field's dialog, `alert-layout-field.tsx`) is edited by the same composition editor with `PROFILES.alert`, drawn by the alert editor's own stage and inspector; a library alert's own editor uses it too, through the scene editor's sync session. See [Chat commands: The alert editor](./commands.md#the-alert-editor).

## Browser source

### Generating a URL

The editor header's **Copy OBS URL** button copies the URL; the dropdown beside it offers **Rotate URL (revoke old)**.

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

Widgets cached in `scene.widgets` (Convex `any[]`) match the engine's `widgets_json` shape, bottom of the stack first. The editor works on the scene as a composition (`@woofx3/scene/model`: placements keyed by id, stacked by a fractional `z` key); `compositionOfStoredScene` and `storedWidgetsOf` convert between the two.

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
