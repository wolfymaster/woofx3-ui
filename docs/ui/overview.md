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

Protected routes render inside **`BroadcastShell`** (`client/src/components/layout/broadcast-shell.tsx`): primary nav (Dashboard, Modules, Workflows, Assets, Scenes), utility links (Team, Settings), instance switcher, command palette hook, and stream status UI (currently a placeholder that does not yet call the real transport).

**Error boundaries** reset on `location` change so a bad screen does not brick the whole app.

## Instance scope

Most Convex-backed screens use **`useInstance()`** (`client/src/hooks/use-instance.ts`): it reads `instances.listForCurrentUser`, picks the Nanostore-selected `currentInstanceId` or falls back to the first instance, and exposes `instance`, `setInstance`, and loading state. Queries and mutations should pass `instanceId` (and often engine `applicationId` from the instance record) when talking to Convex functions that proxy to the engine.

## Where data comes from (today)

The codebase is intentionally **hybrid**:

- **Convex** (`useQuery` / `useMutation` / `useAction`) — multi-tenant control-plane data: accounts, instances, workflows metadata, assets, module catalog, dashboard layout, engine health checks, etc.
- **`WoofxTransport`** (`client/src/lib/transport/`) — direct **browser ↔ engine** WebSocket (or future Tauri IPC) for runtime data (chat, stream status, modules on the engine). Documented in-repo as *not* for Convex-proxied calls.
- **TanStack Query** — used where code still follows older “API client” patterns: some dashboard modules, **Team**, **Scenes** list, **Scene editor**, and parts of **workflow creation** (`BasicWorkflowEditor` + `apiRequest`). Some of these `queryFn`s are **stubs** (empty arrays) until wired to Convex or the transport.

When you touch a screen, check imports: `from "convex/react"` vs `@/lib/transport` vs `@/lib/queryClient` tells you which path it uses.

## Related docs

- [Dashboard](./dashboard.md)
- [Modules](./modules.md)
- [Workflows](./workflows.md)
- [Assets](./assets.md)
- [Scenes](./scenes.md)
- [Settings & team](./settings-team.md)
- [Auth & onboarding](./auth-onboarding.md)
- [Convex & HTTP surface](./convex-surface.md)
