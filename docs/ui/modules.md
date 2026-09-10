# Modules

**Routes:** `/modules`, `/modules/installed`, `/modules/install`, `/modules/:id`
**Primary files:** `client/src/pages/modules.tsx`, `client/src/pages/module-install.tsx`, `client/src/pages/module-detail.tsx`, `client/src/components/modules/uninstall-module-dialog.tsx`

## Catalog (`/modules`, `/modules/installed`)

- **Convex** holds the repository of **engine-confirmed** modules: a `moduleRepository` row is only written after the engine sends a `module.installed` webhook. A module that is mid-install or whose delivery failed does **not** appear in the catalog — its state is communicated through transient events instead (see below).
- The page reads `api.moduleRepository.list` (local Convex rows) and merges in live engine state via the **Convex action** `api.moduleEngine.listEngineModules`. The browser does **not** call the engine directly for module browsing — `WoofxTransport` is reserved for realtime channels (chat, stream status).
- Tabs / filters support browsing by category, search, and grid vs list views.
- Each row exposes a **Details** action that navigates to `/modules/:id`, plus an **Uninstall** button that opens `UninstallModuleDialog`.

## Module detail (`/modules/:id`)

- Reads `api.moduleRepository.get` plus `api.triggerDefinitions.listByModule` and `api.actionDefinitions.listByModule` to show metadata and every trigger / action the module registered with the UI.
- Offers the same uninstall entry point as the listing page.

## Custom upload (`/modules/install`)

Installs are **asynchronous** and correlated via a `moduleKey` echoed by the engine in its webhook callback.

1. The page uploads the ZIP to Convex storage (`assets.generateUploadUrl`), then calls the mutation `api.moduleRepository.uploadAndDeliver` with a **client-generated `moduleKey`**. This mutation does **not** create a `moduleRepository` row yet — it schedules the internal action `moduleEngine.deliverZipToInstance`.
2. `deliverZipToInstance` fetches the archive from storage, base64-encodes it, and calls `rpc.installModuleZip(fileName, zipBase64, { moduleKey })` on the engine. The engine performs the install in the background and POSTs back `module.installed` or `module.install_failed` to `/api/webhooks/woofx3`, echoing the same `moduleKey` in `data.moduleKey`.
3. The UI subscribes via `useQuery(api.transientEvents.get, { instanceId, correlationKey: moduleKey })`. Convex realtime pushes the event the moment the webhook handler emits it:
   - **`progress`** — surfaced by `deliverZipToInstance` transient errors or manual emits during delivery.
   - **`success`** — written by `moduleWebhook.processModuleInstalled`, which also upserts the `moduleRepository` row and its triggers/actions.
   - **`error`** — written on failure (delivery or engine-reported install_failed) with a human-readable message.

A hash of the in-browser zip is logged against the hash computed on the Convex side and the engine side to help diagnose byte-drift across the delivery.

## Update an installed module

There is no dedicated upgrade RPC — **an update is an install of the newer version**, the same `api.marketplace.installModule` call the Store's Install button makes.

- `moduleDetail.getModuleDetail` reports `latestVersion` for an installed module by fetching `GET /modules/{id}` from the marketplace, keyed on the marketplace id in the module's `moduleKey`. When it is newer than the installed `version`, `ModuleDetailPanel` shows an **Update to vX.Y.Z** button beside Remove.
- The action needs only the marketplace id, so `modules.tsx` derives it from the selection (`bareModuleKey(moduleKey)`) rather than from how the panel was opened — the Update button is therefore reachable from the Installed list, not only from the Store.
- Both sides upgrade **in place**. The engine replaces the previous version's registrations under a unique constraint on module name, and `moduleWebhook.processModuleInstalled` patches the existing `moduleRepository` row (`findSupersededModule` matches on the version-free leading segment of the `moduleKey`) instead of inserting a second one. Keeping the `_id` stable is what keeps trigger/action definitions, functions, widgets, assets and resource instances pointed at the module across an upgrade.
- `getModuleDetail` is an action, not a reactive query, so the panel refetches once the install's transient event reports success — otherwise it would keep rendering the superseded version and its "Update available" notice.

## Uninstall (`UninstallModuleDialog`)

Same correlated-async pattern as install:

1. The dialog calls `api.moduleEngine.requestModuleUninstall({ instanceId, moduleId })`, which returns the `moduleKey` to watch.
2. `requestModuleUninstall` emits an immediate `progress` transient event, then RPCs `rpc.uninstallModule(module.name, { moduleKey })` on the engine.
3. The engine uninstalls in the background and POSTs `module.deleted` or `module.delete_failed`. The webhook processor cascade-deletes the repository row, storage blob, and trigger/action definitions (on success), or emits an `error` transient carrying the engine's conflict list (on failure).
4. The dialog watches the transient event and closes on success / displays the conflict list on failure. A 60 s engine-response timeout guards against the engine never responding.

If the engine returns a delete webhook without a `moduleKey` (older engine build), `emitDeleteErrorForMissingKey` locates the record by name and emits the error under its stored `moduleKey` so the dialog unsticks.

## Mental model

- **Engine truth** (what is actually installed on the engine) is the source of truth. The `moduleRepository` table in Convex is a projection that only writes after the engine confirms.
- **`moduleKey`** is a per-operation correlation token. It flows UI → Convex → engine RPC → engine webhook callback → Convex webhook handler → `transientEvents` → UI subscription. Everything hangs off it; **keep it stable for the lifetime of one install/uninstall operation**.
- **`transientEvents`** is a generic realtime bus for any operation that spans an async engine round-trip. Entries are TTL-cleaned (default 60 s). New async flows — not just modules — should reuse the same table + correlation pattern.
- **`moduleKey` is not a tenant-unique key.** It is `{marketplaceId}:{version}:{sha7}`, derived from the archive hash, so two instances that install the same module produce the *same* key — as they do for `name` + `version`. Every `moduleRepository` lookup must therefore be scoped by `instanceId`, via `by_instance_name_version` or `by_instance_module_key`; those are the only two indexes the table offers for resolution, and an unscoped one would resolve another tenant's row. A webhook handler always has the instance to hand — `http.ts` resolves it from the callback's Bearer token before dispatching.
