# Application shell and routing

The SPA is built with **React 18**, **Vite**, and **Wouter** for client-side routes. Global providers wrap the tree in this order (see `client/src/App.tsx`):

1. **Convex** — `ConvexProvider` + `ConvexReactClient` (`VITE_CONVEX_URL`)
2. **Auth** — `ConvexAuthProvider` (`@convex-dev/auth`)
3. **TanStack Query** — shared `queryClient` for non-Convex or legacy-style fetches
4. **UI** — tooltips, theme (`useTheme`), toasts

## Route layout

| Path | Guard | Purpose |
|------|--------|---------|
| `/auth/login`, `/auth/register` | None | Sign in / sign up |
| `/auth/onboarding` | `AuthGuard` | Create account + first instance |
| Everything under the main shell | `AuthGuard` → `OnboardingGuard` | Product UI inside `BroadcastShell` |

**AuthGuard** redirects unauthenticated users to `/auth/login`. **OnboardingGuard** loads `accounts.getMyAccount` and `instances.listForCurrentUser`; if there is no account or no instances, it sends the user to `/auth/onboarding`.

Protected routes render inside **`BroadcastShell`** (`client/src/components/layout/broadcast-shell.tsx`): primary nav, utility links (Team, Admin), instance switcher, command palette hook, and stream status UI (currently a placeholder that does not yet call the real transport).

## Navigation structure

The menu is declared in one place — `client/src/components/layout/nav-config.ts`. Sections with `children` own a URL prefix and render a left sidebar (`section-sidebar.tsx`) beside the page; sections without children are a single route. Every rail — the subnav and the per-page list sidebars (modules, widget catalog) — shares one width and surface through `SIDEBAR_RAIL` in `sidebar-rail.ts`, so the rail does not change size or color between pages. The subnav collapses to icons only via the button at its foot — the state lives in the `$sidebarCollapsed` Nanostore, so it persists per browser and is shared by every section.

| Section | Route prefix | Sub-items |
|---------|--------------|-----------|
| Dashboard | `/` | — |
| Stream | `/stream` | Alerts, Commands, Counters, Scenes, Timers, Queues, Assets, Workflows |
| Modules | `/modules` | — (the page renders its own category sidebar) |
| Help | `/help` | Learning, Debug, Logs, Submit Feedback |
| Admin | `/admin` | Engine, Integrations, Storage, Appearance |

Admin and Team are not in the primary nav — they are the icon buttons in the header's utility cluster (`UTILITY_SECTIONS`), but Admin renders the same section sidebar as Stream and Help.

`/stream`, `/help`, and `/admin` redirect to their first sub-item. Counters, Timers, Queues, Learning, and Submit Feedback are placeholder screens — no engine surface backs them yet. The pre-restructure top-level paths (`/alerts`, `/commands`, `/assets`, `/scenes`, `/scenes/:id`, `/workflows`, `/workflows/:id`, `/debug`, `/settings/:tab`) redirect to their new homes.

**Error boundaries** reset on `location` change so a bad screen does not brick the whole app.

## Instance scope

Most Convex-backed screens use **`useInstance()`** (`client/src/hooks/use-instance.ts`): it reads `instances.listForCurrentUser`, picks the Nanostore-selected `currentInstanceId` or falls back to the first instance, and exposes `instance`, `setInstance`, and loading state. Queries and mutations should pass `instanceId` (and often engine `applicationId` from the instance record) when talking to Convex functions that proxy to the engine.

## Where data comes from (today)

The codebase is intentionally **hybrid**:

- **Convex** (`useQuery` / `useMutation` / `useAction`) — multi-tenant control-plane data: accounts, instances, workflows metadata, assets, module catalog, dashboard layout, engine health checks, etc. Engine-proxied reads (e.g. `moduleEngine.listEngineModules`, `workflowCatalog.fetchMerged`) are Convex **actions** that talk to the engine over capnweb on the server side.
- **`WoofxTransport`** (`client/src/lib/transport/`) — direct **browser ↔ engine** WebSocket (or future Tauri IPC) for **realtime** channels only (chat, stream status, workflow runs). Documented in-repo as *not* for Convex-proxied calls. Browsing / installing / uninstalling modules does **not** use the transport — those flows go browser → Convex mutation/action → engine.
- **`transientEvents`** (Convex realtime subscription) — the bridge the UI uses to observe async engine operations correlated via an operation-specific key. Any flow that RPCs the engine and later receives a webhook callback (module install, uninstall, future async operations) emits progress/success/error events to this table; components subscribe by `correlationKey` and get realtime pushes the moment the webhook handler writes.
- **TanStack Query** — used where code still follows older “API client” patterns: some dashboard modules, **Team**, **Scenes** list, **Scene editor**, and parts of **workflow creation** (`BasicWorkflowEditor` + `apiRequest`). Some of these `queryFn`s are **stubs** (empty arrays) until wired to Convex or the transport.

When you touch a screen, check imports: `from "convex/react"` vs `@/lib/transport` vs `@/lib/queryClient` tells you which path it uses.

## Related docs

- [Dashboard](./dashboard.md)
- [Modules](./modules.md)
- [Workflows](./workflows.md)
- [Assets](./assets.md)
- [Scenes](./scenes.md)
- [Admin & team](./admin-team.md)
- [Auth & onboarding](./auth-onboarding.md)
- [Convex & HTTP surface](./convex-surface.md)
