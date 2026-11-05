# Convex backend and HTTP surface (high level)

Convex is the **multi-tenant control plane**: auth, accounts, instances, assets, workflows UI state, module repository, scenes, alerts, browser source keys, and **server-side proxy actions** to the engine.

## Function modules (indicative)

| Area | Typical Convex files |
|------|----------------------|
| Identity & tenants | `auth.ts`, `users.ts`, `accounts.ts`, `instances.ts` |
| Workflows (UI + sync) | `workflows.ts`, `workflowCatalog.ts`, `workflowCatalogContext.ts`, `starterPacks.ts`, `seeds/triggerActions.ts` |
| Modules | `moduleRepository.ts`, `moduleEngine.ts`, `moduleWebhook.ts`, `moduleWidgets.ts`, `triggerDefinitions.ts`, `actionDefinitions.ts`, `inboundWebhooks.ts` (third-party webhook endpoints) |
| Async realtime bus | `transientEvents.ts` — ephemeral per-instance `{correlationKey → progress/success/error}` entries used by the UI to observe async engine round-trips; TTL-cleaned by a scheduled mutation |
| Media | `assets.ts`, `folders.ts`, `lib/storage/*` |
| Scenes & overlays | `scenes.ts`, `sceneActions.ts`, `browserSource.ts`, `compositionPreview.ts` |
| Alert log | `engineAlerts.ts` (mirror of the engine's dispatch log, plus the Alerts dashboard's `overview` counters; rows older than seven days are deleted by a daily cron, `cleanupOld`), `alertActions.ts` (`replayAlert`, `skipCurrentAlert` and `clearAlertQueue` proxies) |
| Platform | `twitchAuth.ts`, `chatCommands.ts`, `dashboardLayouts.ts` |
| Engine connectivity | `engineHealth.ts`, `lib/engineInstanceUrl.ts`, `registration.ts` |
| Companion app | `companionPairing.ts` (device-authorization pairing, approval page), `companions.ts` (token-authenticated companion functions, the instance's one companion for the admin card, revoke), `lib/companionCodes.ts`, `lib/companionRecords.ts` — see [Companion app](/ui/companion) |

## Instance access

An instance id is not a secret, so every public query, mutation and action that takes one (or a row id that resolves to one: a module, scene or resource) must check the caller's `instanceMembers` row. Being signed in is not enough. Use `requireInstanceRole` / `requireInstanceRoleInAction` (`lib/instanceAccess.ts`) where a refusal should throw, and `isInstanceMember` (`lib/teamAccess.ts`) in live queries that should answer a non-member with nothing. Roles are ordered in `lib/instanceRoles.ts`:

- **member:** read everything on the instance and change its content (modules, module settings, resources, scenes, workflows, dashboards).
- **admin or owner:** also change what the instance is bound to (engine registration, deletion, the linked Twitch channel, pairing a companion app).

Functions the companion app calls (`companions.self`, `heartbeat`, `unpair`) have no user session. They authenticate with the companion's device token instead of instance membership: only the token's SHA-256 hash is stored, the `companions` row is the credential, and a token with no row, or whose approver is no longer an admin, fails closed. See [Companion app](/ui/companion#tokens-and-revocation).

Secret values stay off the client. Module `secret` settings and storage credentials are masked by the engine before they reach Convex. Platform tokens and the instance's `webhookSecret` are stripped from public queries. The instance `clientSecret` is the one exception: the browser's live engine WebSocket authenticates with it.

Generated API types live in `convex/_generated/`. Follow **`convex/_generated/ai/guidelines.md`** when adding functions.

Shared engine types are imported from the `@woofx3/api` package (resolved via a `tsconfig`/`vite` path alias to a sibling `woofx3` checkout — see `tsconfig.json`, `convex/tsconfig.json`, `vite.config.ts`). `lib/engineInstanceUrl.ts` declares `EngineApi extends RpcTarget & Woofx3EngineApi` so per-file capnweb interfaces can inherit the shared method surface as it grows.

## HTTP router (`convex/http.ts`)

Besides auth and Twitch OAuth, the HTTP router wires **public or special-purpose endpoints** (CORS optional via env):

- `POST /api/webhooks/woofx3` — the engine's **request endpoint**, for the callbacks it waits on an answer to: `twitch.token.requested`, `relay.credential.requested` and `shoutout.enqueue.requested`. Authenticates via `Authorization: Bearer <callbackToken>` (resolved to an instance through the `by_webhook_secret` index). Any other type is an event and answers `410 events_moved`.
- `POST /api/engine-events/batch` — **engine events**, in batches from the woofx3 maintenance event queue. Engines post their events to the queue (their events target, set by `engineEventQueue.moveToQueue`), and its relay delivers them here signed with `MAINTENANCE_WEBHOOK_SECRET`. One `engineEvents.applyBatch` mutation applies the whole batch in queue order through `lib/engineEvents/dispatch.ts`, deduplicating on the envelope id (`engineEventReceipts`), and answers one outcome per event (`applied`, `duplicate`, `ignored`, `rejected`). A throwing event fails the batch with 500 `batch_failed` and nothing of it applies. Module install and delete events correlate to the originating UI operation via `data.moduleKey` (echoed back by the engine).
- `POST` or `GET /api/webhooks/<endpointId>` — **third-party ingress** for module webhook triggers, distinct from the engine callback above. It carries no credential: the endpoint id is the capability. Convex looks the endpoint up (`inboundWebhooks.getByEndpointId`; 404 when unknown or disabled), caps the body at 256 KiB (413), and forwards the request to the engine's `handleInboundWebhook` RPC, waiting up to 10 s. The engine runs the module's handler, publishes the events it returns, and answers; Convex relays that answer as-is (502 when malformed, 503 when the engine is unreachable, 504 when it is too slow). Endpoints are provisioned from `module.trigger.registered`, disabled (never deleted) on `module.trigger.deregistered` so an upgrade, reinstall or rollback keeps the URL, and deleted only with the module.
- The `/browser-source/{key}` redirect to the engine-rendered overlay, and widget asset serving.

Paths evolve — read `http.ts` and the imported route modules when integrating.

## Engine vs Convex (reminder)

- **UI → engine (sensitive / server):** Convex **actions** call the instance’s engine URL with its client credentials — not the browser.
- **Engine → UI:** engine **events** reach Convex in batches through the maintenance event queue; the engine's **requests** hit `/api/webhooks/woofx3` with the instance’s callback token.
- **Browser ↔ engine (realtime):** **`WoofxTransport`** only — not used for Convex proxy calls.

This file is only a map; precise contracts belong next to the functions and in `CLAUDE.md`.
