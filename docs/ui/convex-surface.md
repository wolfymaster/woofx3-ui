# Convex backend and HTTP surface (high level)

Convex is the **multi-tenant control plane**: auth, accounts, instances, assets, workflows UI state, module repository, scenes, alerts, browser source keys, and **server-side proxy actions** to the engine.

## Function modules (indicative)

| Area | Typical Convex files |
|------|----------------------|
| Identity & tenants | `auth.ts`, `users.ts`, `accounts.ts`, `instances.ts` |
| Workflows (UI + sync) | `workflows.ts`, `workflowCatalog.ts`, `workflowCatalogContext.ts`, `workflowTemplates.ts`, `seeds/triggerActions.ts` |
| Modules | `moduleRepository.ts`, `moduleEngine.ts`, `moduleWebhook.ts`, `moduleWidgets.ts`, `triggerDefinitions.ts`, `actionDefinitions.ts` |
| Async realtime bus | `transientEvents.ts` — ephemeral per-instance `{correlationKey → progress/success/error}` entries used by the UI to observe async engine round-trips; TTL-cleaned by a scheduled mutation |
| Media | `assets.ts`, `folders.ts`, `lib/storage/*` |
| Scenes & overlays | `scenes.ts`, `sceneSlots.ts`, `browserSource.ts`, `alertDescriptors.ts`, `obsCommands.ts` |
| Platform | `twitchAuth.ts`, `chatCommands.ts`, `dashboardLayouts.ts` |
| Engine connectivity | `engineHealth.ts`, `lib/engineInstanceUrl.ts`, `registration.ts` |

Generated API types live in `convex/_generated/`. Follow **`convex/_generated/ai/guidelines.md`** when adding functions.

Shared engine types are imported from the `@woofx3/api` package (resolved via a `tsconfig`/`vite` path alias to a sibling `woofx3` checkout — see `tsconfig.json`, `convex/tsconfig.json`, `vite.config.ts`). `lib/engineInstanceUrl.ts` declares `EngineApi extends RpcTarget & Woofx3EngineApi` so per-file capnweb interfaces can inherit the shared method surface as it grows.

## HTTP router (`convex/http.ts`)

Besides auth and Twitch OAuth, the HTTP router wires **public or special-purpose endpoints** (CORS optional via env):

- `POST /api/webhooks/woofx3/alerts` — alert webhooks from the engine.
- `POST /api/webhooks/woofx3` — the single shared **engine callback endpoint**. Authenticates via `Authorization: Bearer <callbackToken>` (resolved to an instance through the `by_webhook_secret` index), then dispatches on `payload.type`:
  - `module.installed` → `moduleWebhook.processModuleInstalled` (upserts the repository row, emits a `module.install` success transient event).
  - `module.install_failed` → emits a `module.install` error transient event.
  - `module.deleted` → cascade-deletes the repository row + storage blob + trigger/action definitions, emits a `module.uninstall` success transient event.
  - `module.delete_failed` → emits a `module.uninstall` error transient event carrying the engine's conflict list.
  - `module.trigger.registered`, `module.action.registered` → `moduleWebhook.processRegisteredDefinitions` (upsert trigger / action definitions without requiring a `moduleKey`).
  - Every branch correlates to the originating UI operation via `data.moduleKey` (echoed back by the engine). Unknown event types return `{ success: true, handled: false }`.
- Browser source `claim` / poll paths, OBS command polling, and widget asset serving.

Paths evolve — read `http.ts` and the imported route modules when integrating.

## Engine vs Convex (reminder)

- **UI → engine (sensitive / server):** Convex **actions** `fetch` the instance’s engine URL with `applicationId` as required — not the browser.
- **Engine → UI:** engine **webhooks** hit Convex with `instanceId` + `applicationId` for routing and upserts.
- **Browser ↔ engine (realtime):** **`WoofxTransport`** only — not used for Convex proxy calls.

This file is only a map; precise contracts belong next to the functions and in `CLAUDE.md`.
