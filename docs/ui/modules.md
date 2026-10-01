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
- For an installed module with webhook triggers, the **Settings** tab lists each trigger's public URL with its last delivery (`api.inboundWebhooks.listForInstanceModule`, rendered by `client/src/components/modules/module-webhook-endpoints.tsx`). The handler's answer is relayed from this deployment's site origin, which also serves sign-in and OAuth callbacks, so it is sent inert (`Content-Security-Policy: sandbox; default-src 'none'`, `nosniff`) and an HTML, SVG or XML answer becomes a 502 (`convex/lib/inboundWebhookRelay.ts`).
- Settings declared `type: "secret"` render as write-only password fields: the engine never returns a secret's value, only whether one is set.
- A setting button with `action: { kind: "integration", integration: "<id>" }` connects an account. When the manifest declares that id under `oauth[]`, it is the module's own integration, connected through the engine (`convex/moduleOAuth.ts`, engine capability `modules.oauth`): `moduleOAuth.start` sends the member to the provider with the module's client id and PKCE; the callback (`/api/integrations/oauth/callback`, signed state forwarded like every OAuth callback) stores the authorization as a one-time handoff and returns to the module page with `?integration=<id>&oauth_code=…`; `moduleOAuth.finish` lets only the member who started it hand the code to the engine (`completeModuleOAuth`), which exchanges it and keeps the tokens where neither the dashboard nor module code can read them. A `spotify` integration the manifest does not declare uses the dashboard's own Spotify flow (`spotifyConnect.ts`) instead.
- Settings declared `type: "url"` render as URL inputs. The engine lets the module's code reach the origin of the URL entered there, and only the streamer can set it.

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

## Module permissions (install review)

A manifest may declare a top-level `permissions` array (`twitch.moderation`, `twitch.channel`, ..., and `net:<host>` for each host its code sends requests to, shown as "Send data to <host>"). The **engine enforces** it: a module can only call a privileged capability it declares, and install refuses an id the engine does not know. What the UI adds is **consent**: the streamer sees what a module asks for and approves it before the engine is told to install it. The UI never grants or withholds a capability, and approving a permission here does not change what the engine allows.

- **Where they come from.** For an installed module, the `permissions` field of the manifest stored on its `moduleRepository` row (the manifest parsed at upload, or the engine's manifest fetched after a marketplace install). The marketplace API does not expose permissions, so for a marketplace listing Convex downloads the archive the engine would install, checks it against the listing's `sha256`, and reads the shallowest `manifest.json` (`convex/lib/modulePermissions.ts`, `fetchMarketplaceArchivePermissions` in `convex/marketplace.ts`). No schema change: the stored manifest is `v.any()` and already carries the field.
- **What is shown.** `moduleDetail.getModuleDetail` returns `permissions` (the shown version) and, for an installed module whose marketplace version differs, `latestPermissions`. The detail panel's Details tab and the upload page render a **This module can:** section from `client/src/lib/module-permissions.ts`, which maps each id to plain language; an id missing from that table renders as `Unknown permission: <id>` with a warning, so a permission the engine learns before the UI does is never hidden. Permissions that could not be read render as a warning, not as "nothing".
- **Confirmation.** Installing a module that declares any permission, or updating to a version that declares one the installed version lacked, opens `ApproveModulePermissionsDialog` (**Install and allow** / **Update and allow**). An update that keeps or drops permissions installs without the extra step.
- **Server-side check.** `api.marketplace.installModule` takes `approvedPermissions` and re-reads the archive it installs; it refuses when the archive declares a permission outside that list. This catches a listing republished with new permissions after the streamer reviewed it, and an unreadable listing (approved as "none new") can never install a permission the streamer did not see. ZIP uploads are not re-checked on the server: the browser supplies both the manifest and the archive there.
- **Installing later, without a session.** `internal.marketplace.installApprovedModule` runs the same install for an instance rather than a signed-in user, using permissions approved earlier (for example, the platforms chosen at setup, installed once the engine is ready). A build that declares more than was approved comes back as `{ status: "needs_approval", unapproved }` without reaching the engine, so the caller can ask again instead of installing silently.

## OBS connection status

On the OBS module's Settings tab (`woofx3_obs`), `ObsConnectionStatus` shows whether the engine is connected to OBS, above the address, port and password.

- **Where it comes from:** `obsStatus.get` calls the engine's `getObsStatus()` (capability `obs.status`). The engine answers from its connection's own state, so it's cheap to poll. `useObsStatus` asks every 5 s while the tab is visible.
- **What it says:** "Connected to OBS at host:port", "OBS refused the password", or "Can't reach OBS at host:port". An engine whose scene manager did not answer shows "Can't check OBS right now", which is not a verdict on OBS.
- **Older engines:** those without the capability show nothing.
- **Local types:** the response shape is declared in `convex/lib/engineObsStatus.ts` and must match `ObsStatus` in the engine's shared API types.

## Setup platforms

The platform modules offered while an account is set up (Twitch, OBS, Spotify, Throne) are curated in the `setupPlatforms` table: `marketplaceModuleId`, `required`, `defaultSelected`, `sortOrder` and a one-line `summary`. Name, version and permissions are not stored; `setupPlatformsActions.listForSetup` reads them from the marketplace listing and each module's archive at request time (`convex/lib/setupPlatforms.ts`).

- An entry the marketplace does not list, or whose archive permissions cannot be read, is left out. A **required** entry that is left out is returned in `unavailableRequired`, because setup cannot finish without it.
- A required platform is always selected. Only Twitch is required, and nothing else is preselected.
- The list is internal data, changed with `bunx convex run`: `setupPlatforms:seedDefaults` inserts the default four (idempotent; existing rows are left alone), and `setupPlatforms:upsert` / `setupPlatforms:remove` edit one entry. Offering another platform needs no release.
- A deployment starts with the table empty, so `seedDefaults` must be run once on each. Until then `listForSetup` and `setup.choosePlatforms` throw rather than offer an empty list: with no required platform to enforce, setup could otherwise finish without Twitch.

## Uninstall (`UninstallModuleDialog`)

Same correlated-async pattern as install:

1. The dialog calls `api.moduleEngine.requestModuleUninstall({ instanceId, moduleId })`, which returns the `moduleKey` to watch.
2. `requestModuleUninstall` emits an immediate `progress` transient event, then RPCs `rpc.uninstallModule(module.name, { moduleKey })` on the engine.
3. The engine uninstalls in the background and POSTs `module.deleted` or `module.delete_failed`. The webhook processor cascade-deletes the repository row, storage blob, and trigger/action definitions (on success), or emits an `error` transient carrying the engine's conflict list (on failure).
4. The dialog watches the transient event and closes on success / displays the conflict list on failure. A 60 s engine-response timeout guards against the engine never responding.

A conflict entry with `resourceType: "module"` means other installed modules declare this one in their `requires` (theme packs, for example). Its `usedBy` entries name each dependent with the range it requires, and the dialog lists them under **Required by** rather than **Used by** (`client/src/lib/uninstall-conflicts.ts`).

If the engine returns a delete webhook without a `moduleKey` (older engine build), `emitDeleteErrorForMissingKey` locates the record by name and emits the error under its stored `moduleKey` so the dialog unsticks.

## Mental model

- **Engine truth** (what is actually installed on the engine) is the source of truth. The `moduleRepository` table in Convex is a projection that only writes after the engine confirms.
- **`moduleKey`** is a per-operation correlation token. It flows UI → Convex → engine RPC → engine webhook callback → Convex webhook handler → `transientEvents` → UI subscription. Everything hangs off it; **keep it stable for the lifetime of one install/uninstall operation**.
- **`transientEvents`** is a generic realtime bus for any operation that spans an async engine round-trip. Entries are TTL-cleaned (default 60 s). New async flows — not just modules — should reuse the same table + correlation pattern.
- **`moduleKey` is not a tenant-unique key.** It is `{marketplaceId}:{version}:{sha7}`, derived from the archive hash, so two instances that install the same module produce the *same* key — as they do for `name` + `version`. Every `moduleRepository` lookup must therefore be scoped by `instanceId`, via `by_instance_name_version` or `by_instance_module_key`; those are the only two indexes the table offers for resolution, and an unscoped one would resolve another tenant's row. A webhook handler always has the instance to hand — `http.ts` resolves it from the callback's Bearer token before dispatching.
