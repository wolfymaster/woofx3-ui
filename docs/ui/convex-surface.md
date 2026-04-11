# Convex backend and HTTP surface (high level)

Convex is the **multi-tenant control plane**: auth, accounts, instances, assets, workflows UI state, module repository, scenes, alerts, browser source keys, and **server-side proxy actions** to the engine.

## Function modules (indicative)

| Area | Typical Convex files |
|------|----------------------|
| Identity & tenants | `auth.ts`, `users.ts`, `accounts.ts`, `instances.ts` |
| Workflows (UI + sync) | `workflows.ts`, `workflowCatalog.ts`, `workflowCatalogContext.ts`, `workflowTemplates.ts`, `seeds/triggerActions.ts` |
| Modules | `moduleRepository.ts`, `moduleEngine.ts`, `moduleWidgets.ts` |
| Media | `assets.ts`, `folders.ts`, `lib/storage/*` |
| Scenes & overlays | `scenes.ts`, `sceneSlots.ts`, `browserSource.ts`, `alertDescriptors.ts`, `obsCommands.ts` |
| Platform | `twitchAuth.ts`, `chatCommands.ts`, `dashboardLayouts.ts` |
| Engine connectivity | `engineHealth.ts`, `lib/engineInstanceUrl.ts` |

Generated API types live in `convex/_generated/`. Follow **`convex/_generated/ai/guidelines.md`** when adding functions.

## HTTP router (`convex/http.ts`)

Besides auth and Twitch OAuth, the HTTP router wires **public or special-purpose endpoints** (CORS optional via env): for example **alert webhooks** from the engine, **browser source** claim/poll paths, **OBS command** polling, and **widget asset** serving. Exact paths evolve — read `http.ts` and the imported route modules when integrating.

## Engine vs Convex (reminder)

- **UI → engine (sensitive / server):** Convex **actions** `fetch` the instance’s engine URL with `applicationId` as required — not the browser.
- **Engine → UI:** engine **webhooks** hit Convex with `instanceId` + `applicationId` for routing and upserts.
- **Browser ↔ engine (realtime):** **`WoofxTransport`** only — not used for Convex proxy calls.

This file is only a map; precise contracts belong next to the functions and in `CLAUDE.md`.
