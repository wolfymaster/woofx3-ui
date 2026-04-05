# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

woofx3-ui is a multi-tenant SaaS control plane for managing live stream automation via woofx3 instances. It is NOT the woofx3 engine itself — that lives at `~/code/wolfymaster/woofx3/api`. This repo provides auth, instance registry, asset management, module catalog, workflow builder, scene editor, and browser source overlay rendering. Only Twitch is supported currently, but the data model is platform-abstracted.

### Two-Layer Architecture

- **Convex** (this repo's backend): multi-tenant data — users, accounts, instances, assets, module repository, workflow UI state, scenes, alert queue, browser source keys. All backend functions live in `convex/` at the project root.
- **woofx3 instances** (external): per-deployment workflow engine, module runtime, chat commands, stream event processing. The browser connects directly to the instance URL — Convex does NOT proxy woofx3 API calls.

### Multi-Tenant Model

Account (tenant) → Instance(s) (each = 1 woofx3 deployment at a URL) → Platform Link(s) (Twitch OAuth tokens). Almost everything in the UI is scoped to the currently selected Instance.

## Commands

```bash
bun run dev          # Start Vite dev server
bun run build        # Production build
bun run check        # TypeScript type checking
bunx convex dev      # Run Convex backend in dev mode (needed alongside `bun run dev`)
bunx convex deploy   # Deploy Convex backend to production
bunx biome check .   # Lint and format check
bunx biome check --write .  # Auto-fix lint/format issues
```

Always use `bun`/`bunx`, never `npm`/`npx`/`node`.

## Convex Guidelines

**Always read `convex/_generated/ai/guidelines.md` first** when working on Convex code. Key rules:
- Use `internalQuery`/`internalMutation`/`internalAction` for private functions. Public `query`/`mutation`/`action` are exposed to the internet.
- Always include argument validators on all Convex functions.
- Do NOT use `.filter()` on queries — use `.withIndex()` instead.
- Prefer `.take(n)` over `.collect()` to avoid unbounded reads.
- Actions cannot access `ctx.db`. Use `ctx.runQuery`/`ctx.runMutation` from actions.
- Never put `"use node";` in files that export queries or mutations.
- `fetch()` works in the default Convex runtime — no `"use node";` needed for it.
- File-based routing: `convex/foo.ts` export `bar` → `api.foo.bar` (public) or `internal.foo.bar` (internal).

## Path Aliases

```
@/       → client/src/
@shared/ → shared/
@convex/ → convex/
@assets/ → attached_assets/
```

Configured in both `tsconfig.json` and `vite.config.ts`. Always use these — never use relative paths that cross directory boundaries.

## Code Conventions

- **Formatting**: Biome — 2-space indent, double quotes, semicolons, trailing commas (ES5), 120 char line width.
- **Conditionals always use braces**: `if (!x) { return null; }` — never `if (!x) return null;`. No exceptions.
- **Routing**: Wouter v3 — no `<Redirect>` component exists; use `useEffect(() => navigate('/path'), [])` for redirects.
- **State**: Nanostores (`$`-prefixed atoms) for UI-only state (theme, sidebar, engine URL, current instance ID). Convex for all server-persisted data.
- **Transport**: Use `client/src/lib/transport/` for woofx3 API calls. `WoofxTransport` interface abstracts browser WebSocket vs future Tauri IPC. Do NOT use `client/src/lib/rpc-client.ts` (deprecated).
- **Shadcn/ui**: Components in `client/src/components/ui/` — extend via composition, never modify directly.
- **Instance-scoped queries**: Always use `"skip"` when instanceId may be null:
  ```typescript
  const data = useQuery(api.xxx.list, instance ? { instanceId: instance._id } : "skip");
  ```

## Key Architecture Layers

### Frontend (`client/src/`)
- React 18 + TypeScript, Vite build
- Auth: `@convex-dev/auth` with Twitch OAuth (custom HTTP endpoints in `convex/http.ts`) and Password provider
- Auth flow: Login → AuthGuard → OnboardingGuard (must have account + instance) → BroadcastShell (main layout)
- Visual workflow builder uses ReactFlow (`pages/workflow-builder.tsx`)
- Scene editor for browser source overlays (`pages/scene-editor.tsx`)

### Backend (`convex/`)
- Auth via `convex/auth.ts` + `convex/auth.config.ts` (self-issued JWTs from CONVEX_SITE_URL)
- HTTP API surface in `convex/http.ts`: Twitch OAuth flow, alert webhook ingestion, browser source claim/alerts, OBS command polling, widget asset serving
- Alert system: woofx3 POSTs to `/api/webhooks/woofx3/alerts` → alerts table → browser source polls pending alerts → renders overlays
- Storage adapters in `convex/lib/storage/` — Convex native, R2, or local file storage per instance config

### Shared (`shared/api.ts`)
- Type definitions for the legacy RPC API contract (pagination, stream status, workflows, assets, scenes, modules, etc.)

### Desktop (`src-tauri/`)
- Tauri shell planned — `TauriTransport` in `client/src/lib/transport/tauri-transport.ts` will use IPC → Rust → WebSocket
