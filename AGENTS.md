# Agent guidance (woofx3-ui)

Orientation for automated coding agents working in this repository. **Authoritative contracts and tables:** read **`CLAUDE.md`** (engine↔UI handshake, `instanceId` / `applicationId`, webhook rules, task management).

## What this is

Multi-tenant **control plane** (React + Vite + Convex): auth, instances, assets, module catalog, workflows UI, scenes, browser overlays. **Not** the woofx3 engine — engine code lives in the sibling mono-repo (`~/code/wolfymaster/woofx3`). Twitch-only today; model is platform-abstracted.

- **Convex** — multi-tenant backend; proxies to each customer’s engine by `instanceId`.
- **Engine instances** — separate deployments; speak to the UI via Convex actions (server `fetch`) and **webhooks** back to Convex.

## Documentation (architecture and design)

Narrative docs live under **`docs/`** (VitePress, `docs/package.json`). They describe routes, shells, and how screens use Convex vs `WoofxTransport` vs legacy TanStack Query paths.

- Entry: `docs/index.md` — product tour: `docs/ui/overview.md` — patterns/ADRs: `docs/patterns/`

```bash
bun run docs
bun run docs:build
```

## Engine ↔ UI — rules agents must follow

- **`instanceId`** = Convex `instances` document `_id`. **`applicationId`** = engine-internal; Convex stores the value returned after registration. Neither side invents the other's ID.
- **UI → engine (mutations that should be trusted):** browser → **Convex action** → engine HTTP API. **Do not** call the engine from the browser for these paths.
- **All engine API calls from Convex use capnweb HTTP batch RPC** via `createEngineRpcSession(url, clientId, clientSecret)` in `convex/lib/engineInstanceUrl.ts`. This creates a gateway, calls `gateway.authenticate()`, and returns the Api stub — all pipelined in one batch.
- **capnweb HTTP batch is single-use**: the batch fires on the first `await` and the session is consumed. Never `await` authenticate separately — chain the API call: `await createEngineRpcSession(...).someMethod()`. Multiple independent calls need separate sessions. Convex does not support WebSocket, so `newWebSocketRpcSession` cannot be used in Convex actions.
- **`WoofxTransport`** (`client/src/lib/transport/`) — **only** for realtime browser↔engine WebSocket. Uses `newWebSocketRpcSession` + `gateway.authenticate()`. **Not** for Convex-proxied calls.
- **Engine → UI:** POST to `/api/webhooks/woofx3` on Convex; `Authorization: Bearer <callbackToken>` header; must be **idempotent**.

Account sharing is **Convex-only**; the engine has no user/account model.

## Commands

Use **`bun`** / **`bunx`** (not npm/npx/node for project scripts).

```bash
bun run dev
bun run build
bun run check
bunx convex dev
bunx convex deploy
bunx biome check .
bunx biome check --write .
```

## Convex

<!-- convex-ai-start -->
This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read `convex/_generated/ai/guidelines.md` first** for important guidelines on how to correctly use Convex APIs and patterns. The file contains rules that override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running `npx convex ai-files install`.
<!-- convex-ai-end -->

Summary (see `CLAUDE.md` for the full list): `internal*` for private APIs; validators on all functions; **indexes** instead of `.filter()` on queries; prefer `.take(n)`; actions use `ctx.runQuery` / `ctx.runMutation`; no `"use node"` in query/mutation files; `fetch()` is fine in default runtime.

## Path aliases

`@/` → `client/src/`, `@shared/` → `shared/`, `@convex/` → `convex/`, `@assets/` → `attached_assets/` (see `tsconfig.json` / `vite.config.ts`).

## Code conventions (short)

**Programming principles** (expanded in **`CLAUDE.md`**):

- **Tiger Style**: fail fast; assert and validate; do not stay in undesirable states.
- **Explicit** over implicit; **sparse** comments (complex / non-obvious only); **optimize for the reader**.
- **Braces** on all `if` / `else` / `for` / `while` bodies.
- **Composition** and TypeScript **interfaces** over inheritance; **established patterns**; **design for change** (less code you regret later).
- **Git**: second-guess bad fits—commit or branch and try another approach.
- **Verification**: run `bun run check`, `bunx biome check .`, and relevant tests; keep **green** before stacking new features.
- **Have fun**: creative, expressive work and solid engineering reinforce each other.

- **Biome** — 2 spaces, double quotes, semicolons, ES5 trailing commas, 120 cols.
- **Wouter v3** — use `navigate` in `useEffect`, not `<Redirect>`.
- **State:** Nanostores for UI-only; Convex for persisted data.
- **Transport:** `client/src/lib/transport/`; do not use deprecated `rpc-client.ts`.
- **Shadcn** in `client/src/components/ui/` — compose, don’t edit primitives.
- **Instance-scoped queries:** `useQuery(api.foo.bar, instance ? { instanceId: instance._id } : "skip")`.

## Layers

- **Frontend:** `client/src/` — AuthGuard → OnboardingGuard → BroadcastShell; ReactFlow workflow builder; scene editor.
- **Backend:** `convex/` — `http.ts` (Twitch OAuth, webhooks, browser source, OBS); `lib/storage/` adapters.
- **Shared types:** `shared/api.ts` (legacy RPC-shaped types).
- **Desktop (planned):** `src-tauri/` + `TauriTransport`.

## Task management

Notion backlog database `272a5cd7-e93c-80ee-8420-e30b81942b08`. New work in **this** repo → tag **Project: UI** unless clearly engine-side. Task descriptions should be self-contained for implementers.
