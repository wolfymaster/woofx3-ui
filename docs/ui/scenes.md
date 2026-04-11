# Scenes and overlays

**Routes:** `/scenes`, `/scenes/:id`  
**Primary files:** `client/src/pages/scenes.tsx`, `client/src/pages/scene-editor.tsx`  
**Related:** `client/src/pages/browser-source.tsx` (not currently mounted in `App.tsx` routes), Convex `scenes`, `browserSource`, `alertDescriptors`, HTTP routes in `convex/http.ts`

## Scenes list (`/scenes`)

- Implemented with **TanStack Query** and types from **`@shared/api`**.
- As of the current tree, the **list query returns an empty paginated result** (`Promise.resolve({ data: [], ... })`) — the UI shell (search, create dialog, cards) is in place but **not yet backed by live data** in this path.

## Scene editor (`/scenes/:id`)

- Large **canvas-style editor**: widgets, layers, alignment, drag-and-drop (e.g. `@dnd-kit`), toolbars for text/image/shapes/alerts, undo/redo style actions.
- Uses **TanStack Query** + **`queryClient`** for server alignment; **no direct `convex/react` imports** in this file at the time of writing — integration is expected to converge on Convex or transport like other pages.

## Browser source runtime

- **`browser-source.tsx`** implements a **standalone overlay renderer** that talks to **Convex site URL** (`VITE_CONVEX_SITE_URL`) to pull scene config and alerts — intended for OBS/browser sources.
- It is **not** registered in the main `App.tsx` `Switch`; it may be used as a **separate entry** or future route. The **Convex HTTP surface** also serves browser-source claim flows, alert polling, and related endpoints (see [Convex & HTTP](./convex-surface.md)).

When wiring scenes end-to-end, align **authoring** (editor) persistence with **runtime** (browser source + webhooks from the engine) using the same schema expectations.
