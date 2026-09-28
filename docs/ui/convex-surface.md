# Convex backend and HTTP surface (high level)

Convex is the **multi-tenant control plane**: auth, accounts, instances, assets, workflows UI state, module repository, scenes, alerts, browser source keys, and **server-side proxy actions** to the engine.

## Function modules (indicative)

| Area | Typical Convex files |
|------|----------------------|
| Identity & tenants | `auth.ts`, `users.ts`, `accounts.ts`, `instances.ts` |
| Workflows (UI + sync) | `workflows.ts`, `workflowCatalog.ts`, `workflowCatalogContext.ts`, `workflowTemplates.ts`, `seeds/triggerActions.ts` |
| Modules | `moduleRepository.ts`, `moduleEngine.ts`, `moduleWebhook.ts`, `moduleWidgets.ts`, `triggerDefinitions.ts`, `actionDefinitions.ts`, `inboundWebhooks.ts` (third-party webhook endpoints) |
| Async realtime bus | `transientEvents.ts` — ephemeral per-instance `{correlationKey → progress/success/error}` entries used by the UI to observe async engine round-trips; TTL-cleaned by a scheduled mutation |
| Media | `assets.ts`, `folders.ts`, `lib/storage/*` |
| Scenes & overlays | `scenes.ts`, `sceneActions.ts`, `browserSource.ts` |
| Alert log | `engineAlerts.ts` (mirror of the engine's dispatch log, plus the Alerts dashboard's `overview` counters), `alertActions.ts` (`replayAlert`, `skipCurrentAlert` and `clearAlertQueue` proxies) |
| Platform | `twitchAuth.ts`, `chatCommands.ts`, `dashboardLayouts.ts` |
| Engine connectivity | `engineHealth.ts`, `lib/engineInstanceUrl.ts`, `registration.ts` |

## Instance access

An instance id is not a secret, so every public query, mutation and action that takes one (or a row id that resolves to one: a module, scene or resource) must check the caller's `instanceMembers` row. Being signed in is not enough. Use `requireInstanceRole` / `requireInstanceRoleInAction` (`lib/instanceAccess.ts`) where a refusal should throw, and `isInstanceMember` (`lib/teamAccess.ts`) in live queries that should answer a non-member with nothing. Roles are ordered in `lib/instanceRoles.ts`:

- **member:** read everything on the instance and change its content (modules, module settings, resources, scenes, workflows, dashboards).
- **admin or owner:** also change what the instance is bound to (engine registration, deletion, the linked Twitch channel).

Secret values stay off the client. Module `secret` settings and storage credentials are masked by the engine before they reach Convex. Platform tokens and the instance's `webhookSecret` are stripped from public queries. The instance `clientSecret` is the one exception: the browser's live engine WebSocket authenticates with it.

Generated API types live in `convex/_generated/`. Follow **`convex/_generated/ai/guidelines.md`** when adding functions.

Shared engine types are imported from the `@woofx3/api` package (resolved via a `tsconfig`/`vite` path alias to a sibling `woofx3` checkout — see `tsconfig.json`, `convex/tsconfig.json`, `vite.config.ts`). `lib/engineInstanceUrl.ts` declares `EngineApi extends RpcTarget & Woofx3EngineApi` so per-file capnweb interfaces can inherit the shared method surface as it grows.

## HTTP router (`convex/http.ts`)

Besides auth and Twitch OAuth, the HTTP router wires **public or special-purpose endpoints** (CORS optional via env):

- `POST /api/webhooks/woofx3` — the single shared **engine callback endpoint**. Authenticates via `Authorization: Bearer <callbackToken>` (resolved to an instance through the `by_webhook_secret` index), then dispatches on `payload.type`:
  - `module.installed` → `moduleWebhook.processModuleInstalled` (upserts the repository row, emits a `module.install` success transient event).
  - `module.install_failed` → emits a `module.install` error transient event.
  - `module.deleted` → cascade-deletes the repository row + storage blob + trigger/action definitions, emits a `module.uninstall` success transient event.
  - `module.delete_failed` → emits a `module.uninstall` error transient event carrying the engine's conflict list.
  - `module.trigger.registered`, `module.action.registered` → `moduleWebhook.processRegisteredDefinitions` (upsert trigger / action definitions without requiring a `moduleKey`).
  - Every branch correlates to the originating UI operation via `data.moduleKey` (echoed back by the engine). Unknown event types return `{ success: true, handled: false }`.
- `POST` or `GET /api/webhooks/<endpointId>` — **third-party ingress** for module webhook triggers, distinct from the engine callback above. It carries no credential: the endpoint id is the capability. Convex looks the endpoint up (`inboundWebhooks.getByEndpointId`; 404 when unknown or disabled), caps the body at 256 KiB (413), and forwards the request to the engine's `handleInboundWebhook` RPC, waiting up to 10 s. The engine runs the module's handler, publishes the events it returns, and answers; Convex relays that answer as-is (502 when malformed, 503 when the engine is unreachable, 504 when it is too slow). Endpoints are provisioned from `module.trigger.registered`, disabled (never deleted) on `module.trigger.deregistered` so an upgrade, reinstall or rollback keeps the URL, and deleted only with the module.
- The `/browser-source/{key}` redirect to the engine-rendered overlay, and widget asset serving.

Paths evolve — read `http.ts` and the imported route modules when integrating.

## Engine vs Convex (reminder)

- **UI → engine (sensitive / server):** Convex **actions** call the instance’s engine URL with its client credentials — not the browser.
- **Engine → UI:** engine **webhooks** hit Convex with the instance’s callback token, which routes them to the instance for upserts.
- **Browser ↔ engine (realtime):** **`WoofxTransport`** only — not used for Convex proxy calls.

This file is only a map; precise contracts belong next to the functions and in `CLAUDE.md`.
