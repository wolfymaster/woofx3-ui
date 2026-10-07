# Companion app

**Routes:** `/companion/pair` (approval page), the Companion card on `/admin/engine`
**Primary files:** `companion/` (the app; `companion/core/` holds the relay client, bridge and discovery), `client/src/pages/companion-pair.tsx`, `client/src/components/engine/companion-card.tsx`, `convex/companionPairing.ts`, `convex/companions.ts`, `convex/lib/companionCodes.ts`, `convex/lib/companionRecords.ts`

## What it is

The woofx3 companion is a small tray app (Tauri 2) for the streamer's PC. It holds outbound connections from that PC to woofx3, so that later it can carry work a cloud service cannot do on its own, such as reaching OBS on the streamer's own machine or an engine running on that PC.

It is **not** a desktop UI for woofx3. The browser is the only place woofx3 is managed. The companion's own window shows its state and little else: a Status tab and an [Integrations](#integrations) tab, with Engine and Configuration tabs laid out but disabled until they have something to show.

It pairs with one instance, shows that it is paired and connected, survives restarts, and [updates itself](#updates). Once paired and confirmed, it serves the [local endpoints](#integrations) of modules installed on its instance, such as OBS's WebSocket server, to a cloud engine through the relay. It does not carry a local engine's traffic yet.

## Layout

```
companion/
  package.json        window app (Vite + React), plus the Tauri CLI
  ui/                 the window: renders CompanionState, calls Rust commands
  src-tauri/          the Rust process: Convex client, credential store, tray,
                      integrations (integrations.rs, integration_store.rs)
  core/               woofx3-companion-core: relay frames, the relay client,
                      the bridge, address rules and OBS discovery. No Tauri.
```

The Rust process owns the Convex connection (the `convex` crate), so it lasts as long as the tray icon rather than the window. Closing the window hides it; **Quit** in the tray menu is the only way out. A second launch focuses the running one (`tauri-plugin-single-instance`).

The Convex deployment URL is compiled in from `WOOFX3_CONVEX_URL` by `companion/src-tauri/build.rs`. A release build without it fails; a debug build falls back to a local Convex backend so `cargo check` and tests need no deployment.

```bash
WOOFX3_CONVEX_URL=https://<deployment>.convex.cloud bun run companion:dev
WOOFX3_CONVEX_URL=https://<deployment>.convex.cloud bun run companion:build
```

The companion builds on Windows only: its Tauri crate needs GTK and WebKit on Linux. CI's **Companion** job (`.github/workflows/ci.yml`) typechecks and builds the window and runs `cargo fmt`, `clippy` and the tests on `windows-latest`. On Linux, `cargo clippy --all-targets --target x86_64-pc-windows-gnu` checks the crate (it needs `rustup target add x86_64-pc-windows-gnu`, but no MinGW linker).

Everything that carries traffic lives in `companion/core`, which has no Tauri dependency, so its tests run on any OS. They run a fake relay and a fake OBS on loopback and drive the real relay client and bridge against them. CI's **Companion core** job runs `cargo fmt --check`, `clippy` and the tests on Linux.

```bash
bun run companion:test    # cargo test --manifest-path companion/core/Cargo.toml
```

## Integrations

A module that controls something on the streamer's network declares it in `local[]` (an endpoint with a protocol, the settings holding its host, port and password, and optionally how to discover it). The Integrations tab is generated from those entries for the modules installed on the companion's instance; nothing in it is written per integration. The Rust side (`companion/src-tauri/src/integrations.rs`) runs while the pairing is paired and confirmed, and stops with it.

It subscribes to `companionIntegrations.forCompanion` with the companion's token, and subscribes again with backoff if that fails or ends. The query lists each installed module's endpoints with their setting keys (never values), the copy Convex keeps of what the companion recorded, `manualKeys` (settings the streamer saved by hand), and `relayAvailable`. A deployment without these functions answers "Could not find public function", and the tab says "Integrations need a newer woofx3". Any other error text from Convex is replaced with a fixed message before it is logged or shown, since Convex's own messages can quote a function's arguments, the token among them.

### Discoverers

A discoverer is built into the companion and named by `discover.known`. Each one serves only the modules listed for it in the `DISCOVERERS` table in `integrations.rs`; today that is `obs-websocket` for `woofx3_obs`. A discoverer can read secrets on the PC, so a module that merely declares `known: "obs-websocket"` gets "Discovery not available for this module" and manual entry only, and can never receive the OBS password. Convex enforces the same table (`convex/lib/knownDiscoverers.ts`) when the companion reports values. The table also lists the subprotocols the Test button offers, and the window keys discoverer-specific hints (such as where to switch OBS's WebSocket server on) by the discoverer's id, so nothing else in the tab names a particular integration.

For each endpoint the tab shows:

- **Discovery.** For an endpoint the `obs-websocket` discoverer serves, the companion reads obs-websocket's own config file (`%APPDATA%\obs-studio\plugin_config\obs-websocket\config.json`, OBS 30 and later, at most 64 KiB) every minute and whenever the window gains focus: found on this PC with its port, switched off, or not found. Endpoints with `mdns` discovery, or none, take a typed address.
- **The address it dials,** as `host:port`, marked "found on this PC" or "you entered it". **Use a different address** asks for `host:port` and saves it only on **Confirm address**. An enabled endpoint dialling a discovered address follows OBS when its port changes.
- **The enable switch,** disabled until there is an address.
- **The password opt-in,** off by default, naming the endpoint and the module (display name and id) the password would go to. Only with it on does the password read from OBS's file leave the PC.
- **The connection state** from the relay, and **Test**, which makes one WebSocket handshake with the stored address (offering `obswebsocket.json` and `obswebsocket.msgpack` to an OBS endpoint) and reports whether it answered within 3 seconds.

### What the companion dials

The companion's own store, `integrations.json` in its app data directory, is the only source of addresses the bridge dials:

```json
{ "companionId": "…", "instanceId": "…", "endpoints": { "woofx3_obs/obs": { "enabled": true, "address": { "host": "127.0.0.1", "port": 4455, "origin": "discovered" }, "sharePassword": false, "sentPasswordSha256": null } } }
```

An address gets there only from discovery on this PC or from the streamer confirming it in the window. The relay names a module and an endpoint, never an address, and the bridge answers only for an endpoint that is enabled in the store, belongs to a module `forCompanion` lists as installed, and uses the `websocket` protocol. Anything else is refused with 4403 and nothing is dialled. Convex receives a copy of each address through `companionIntegrations.setEndpoint` to show in the browser, and the companion never reads one back.

A stream already open is checked again whenever the store or the installed modules change. Turning the endpoint off, confirming another address, using the discovered one instead, or uninstalling its module closes every stream whose endpoint no longer resolves to the address it dialled, with 4403.

The file is written atomically. It is stamped with the companion id and instance id from `companions.self`, and a session for any other pairing ignores it and starts empty. Pairing the same installation to the same instance again keeps it, since approval updates that installation's companion row in place and its id does not change; the confirmed addresses exist only on this PC. It is deleted when the companion unpairs or is revoked.

### Filling in module settings

For an enabled endpoint that dials the discovered address, the companion calls `companionIntegrationsActions.reportDiscovered` with host `127.0.0.1` and the discovered port, leaving out any key in `manualKeys`. It sends the password only with the opt-in on, and only when its SHA-256 differs from the digest it stored after the last successful send. The digest is dropped when the password setting becomes manual or stops being manual, so "Use the companion's value" in the browser sends it again. Convex writes only the settings `local[]` names, on modules installed on the companion's instance, and records them as provided by the companion. The companion sends a report only when its values or `manualKeys` changed, and waits 10 minutes before retrying a failed one, since reports are rate limited and every settings write makes the engine reconnect to OBS. An address the streamer typed may be another PC, so nothing is reported for it.

## The relay connection

The companion holds one outbound WebSocket to the relay (`companion/core/src/relay.rs`) while integrations are running, this woofx3 offers the relay, and at least one enabled endpoint resolves. It mints a credential with `companionRelayActions.companionCredential`, connects with it as a Bearer token, renews it at two thirds of its lifetime, and reconnects with jittered backoff from 1 to 60 seconds. Bridged traffic passes through unchanged, text or binary: the engine's obs-websocket client under Bun speaks `obswebsocket.msgpack`, so OBS traffic is binary frames. The bridge offers the local server exactly the subprotocols the engine offered; if the engine offered some and the server picks none, the stream closes with 1002. Each direction of each stream may queue at most 4 MiB, and a stream that would exceed it closes with 1009.

How the relay ends a connection decides what the companion does next:

| From the relay | The companion |
|---|---|
| Close 4001, or HTTP 409 `{"error":"displaced"}` at the upgrade | Stops: another companion for the instance took over |
| Close 4000 | This companion connected again; reconnects with backoff |
| HTTP 409 `{"error":"stale_credential"}` at the upgrade | Mints a fresh credential and retries with backoff |
| Close 4401 | Mints again and reconnects |

| Relay state | Shown on the Status tab |
|---|---|
| Not needed | No enabled endpoint, or integrations are not running |
| Connecting, Connected | |
| Retrying | "Retrying in N s" and the last error |
| Displaced | Another companion connection for the instance took over. The companion does not take it back on its own; **Reconnect** does |
| Refused | woofx3 would not issue a credential. The companion asks again when `forCompanion` changes, after 5 minutes, or on **Reconnect**. A revoked companion hears it from `companions.self` and unpairs |

## Updates

The companion updates itself with `tauri-plugin-updater` (`companion/src-tauri/src/update.rs`). How releases are cut and signed is in [Companion releases](/ops/companion-releases).

- It checks `latest.json` on the `companion-latest` release 30 seconds after starting and then every 6 hours, only while connected to Convex. Debug builds never check.
- A newer release downloads in the background. The plugin verifies its signature, including the version it was signed for (`requireSignedVersion`), before the companion offers it.
- Once downloaded, `WindowState.update` carries its version. The window shows "woofx3 companion {version} is ready" with **Restart to update**, and the tray menu gains **Restart to update to {version}**. Both call `install_update`, which runs the installer in passive mode and restarts into the new version. The companion never restarts on its own.
- A failed check, download or signature is logged and tried again at the next interval. It never becomes the `error` state, which is about pairing.
- The installer is per user, so installs and updates need no administrator prompt.

## Pairing

Pairing follows the OAuth device authorization shape (RFC 8628): the companion shows a short code, and a signed-in person approves it in the browser.

1. The companion generates its own token: 32 bytes from the OS RNG, base64url, prefixed `wfxc_`. It stores it in the OS credential store (Credential Manager on Windows) marked unconfirmed.
2. It calls the action `companionPairing.start` with its device name, version, installation id and the token's SHA-256 hash. Convex draws a device code and an 8-character user code (`XXXX-XXXX`, from an alphabet with no vowels or look-alike characters), and returns them with the verification URL `<SITE_URL>/companion/pair?code=…` and how long the code is good for (10 minutes).
3. The companion opens that URL and shows the code. It subscribes to `companions.self` with its token, and to `companionPairing.status` with the device code to hear about a decline.
4. On the approval page the person checks that the code matches, picks an instance where they are an admin or owner, and approves. `companionPairing.approve` writes the `companions` row with the stored token hash and marks the pairing approved, in one transaction. If the instance already has a companion from another installation, the same transaction deletes it (see [One companion per instance](#one-companion-per-instance)).
5. `companions.self` turns non-null for the token, returning the instance name and the approver's name. The companion asks the person at the PC to **Confirm** or **Reject** "Approved for {instance} by {person}". A code shown on stream could be approved by anyone who saw it, so the token counts only once confirmed. Confirm calls `companions.confirm`, which sets `confirmedAt` on the row; Reject calls `companions.unpair`. `self` reports `confirmed`, and the server's value wins after a restart. Re-pairing the same installation clears `confirmedAt`.

Whenever the companion gives up a token before it is paired (Cancel, the code expiring, a failure, or a restart that finds an unconfirmed token Convex no longer answers for), it forgets the token locally and then, in the background, calls `companionPairing.cancel` with the device code and `companions.unpair` with the token. `cancel` moves a pending pairing to `cancelled`, and `unpair` also cancels any pending pairing started with that token, since a restart loses the device code. Both are idempotent. Without this, an approval arriving after the companion gave up would write a `companions` row nobody holds.

Because the companion makes its own token and sends only its hash, no secret ever travels back to it, and a lost response cannot strand a pairing.

The **installation id** is a UUID the companion generates once and keeps in its app data directory. Approving a pairing from an installation that already has a row on that instance replaces that row's token, keeping its id, so pairing the same PC again does not leave a duplicate.

### One companion per instance

An instance has at most one companion. Approving a pairing from a different installation **replaces** the current companion: `approve` deletes its row and presence row in the same transaction, and the old companion's `companions.self` subscription turns null, so it drops to Unpaired at once. Pairing the same installation again updates the row in place and keeps its id, with no warning.

Before Approve is enabled, the approval page asks `companionPairing.replacementForApproval` with the user code and the chosen instance. It answers with the device name and last-seen time of the companion that approving would replace, or null. It compares installation ids on the server, so they never reach the browser, and it answers only an admin of the instance, with no token data. When it names a companion, the page shows "This replaces the companion on {device}, last seen {time}" and requires a second checkbox. The confirmation is tied to that companion, so choosing another instance asks again.

Because there is only one companion, holding a confirmed companion row is the privilege. A phished approval can only replace the streamer's own companion, and that is visible: the real companion drops to Unpaired, and the Companion card shows the new device. The rule that picks which rows an approval replaces is `companionsReplacedBy` in `convex/lib/companionCodes.ts`, which is unit tested.

### The approval page

`/companion/pair` sits under `AuthGuard` but outside `BroadcastShell` and `OnboardingGuard`, like `/setup`. A streamer whose engine will run on their own PC has no registered instance until the companion exists, so the onboarding guard must not catch them. A signed-out visitor goes to `/auth/login?next=…`; the `next` path is carried through to registration too, so a new account lands back on the page.

The device name is shown as "Reported by the device", since the companion chooses it. Approve stays disabled until the person ticks "This matches the code shown in the companion on my computer", even when the code came in the link. The page calls `companionPairing.timeLeft` once when a code loads and counts down from that with `performance.now()`, so the browser's own clock never decides that a code has expired.

### Who may approve

The user code is a short-lived capability: whoever holds it may see the pairing's device details (`getForApproval`) and decline it (`deny`), so those need only a sign-in. Approving binds a device that will act on the instance, which is an admin concern, so `approve` requires the admin role on the chosen instance.

### Expiry and rate limits

Expiry is stored as `expiresAt`, never as a status. Mutations compare it with the clock; queries never read it, since a query does not re-run as time passes. The companion waits for the duration `start` returned (`expiresInMs`), and the action `companionPairing.timeLeft` answers how long a code has left by the server's clock, so neither a skewed PC clock nor a skewed browser clock shows a live code as expired. The server still enforces expiry on approve and decline. An hourly cron (`companionPairing.cleanupExpired`) deletes pairings an hour after they expire.

`start` is public and unauthenticated, so it is rate limited per installation and then globally (`@convex-dev/rate-limiter`). The caller chooses its own installation id, so the global bucket (3000 an hour, bursts of 300) is the real ceiling; checking the per-installation bucket first means refused calls do not spend it. `deny` is rate limited per user, and answers a wrong or used-up code with a result rather than an error so that failed attempts count against the limit too.

## Tokens and revocation

Only the token's hash is stored. The `companions` row is the credential: a token whose hash has no row is not paired, and every function that takes a token fails closed.

- `companions.self` — what the companion subscribes to. Null means unpaired; the companion forgets its token. A query error is not a revocation.
- `companions.heartbeat` — every 60 seconds once confirmed. It writes `companionPresence`, a separate table, so the heartbeat does not re-run subscriptions that read the companion itself.
- `companions.confirm` — the person at the PC confirmed the pairing; sets `confirmedAt`.
- `companions.unpair` — the companion removing itself. It clears its local token first, so an offline Convex never keeps it.
- `companions.revoke` — an admin removing the companion from the Companion card. Deleting the row is the revocation.
- `companions.forInstance` — the instance's companion for its members (null when there is none), with device, version, pairing date, last heartbeat and whether the device confirmed it.

A companion acts with its approver's authority, so it stays paired only while the person who approved it is still an admin or owner of the instance. Removing them, or lowering them to member, unpairs it, the same rule as remote macro triggers. Deleting the instance deletes its companion, its presence row and the instance's pairings.

## The Companion card

On `/admin/engine`, for managed and self-hosted engines alike: a cloud engine uses a companion for local integrations too. It shows the instance's companion from `companions.forInstance` (null when there is none) with device, version and pairing date. It reads **Online** when the last heartbeat is under three minutes old, otherwise "Last seen …". A companion the device has not confirmed yet reads "Awaiting confirmation on the device". The card re-renders once a minute so the badge ages without new data. Admins and owners get **Revoke**.

## Bridging local endpoints

A cloud engine cannot reach `127.0.0.1` on the streamer's PC. For each `local[]` endpoint of an installed module (see [Modules](./modules.md#local-endpoints-local)), the companion can carry the engine's connection instead: the engine dials a bridge on the edge relay, the relay carries it over the companion's outbound connection, and the companion connects it to the address on the PC.

```
OBS <-ws 127.0.0.1:4455- Companion ==(outbound WSS)== Relay DO <==wss /bridge/<module>/<endpoint>== Engine
```

### The flow

1. The companion subscribes to `companionIntegrations.forCompanion({ token })`: each installed module's endpoints, the setting keys they name (never values), what the companion last recorded, which keys the streamer set by hand (`manualKeys`), and `relayAvailable`. Null unless the token is a confirmed companion's.
2. It discovers what it can (OBS's port from obs-websocket's own config file) or the streamer confirms an address in the companion window, and records it with `companionIntegrations.setEndpoint`. The companion keeps the address it dials in its own store; the copy in `companionEndpoints` is for display. Enabling needs an address.
3. It fills in the module's settings with `companionIntegrationsActions.reportDiscovered`: only keys `local[]` names, only on modules installed on its instance, never a `manual` key, and nothing when the report is unchanged, since every setting write makes the engine reconnect. Provenance is read again right before each key is written, so a key the streamer saves by hand meanwhile is skipped. Convex never stores the password, and refuses one unless all of these hold:
   - the streamer opted in on the Integrations tab (`sharesPassword`);
   - the endpoint is turned on;
   - the endpoint's discoverer may hand this module a secret. The allowlist is in `convex/lib/knownDiscoverers.ts`; `obs-websocket` serves only `woofx3_obs`. Another module that declares the same discoverer still gets the host and port, never the password. The companion enforces the same table.
4. Turning an endpoint on or off schedules `companionRelayActions.syncEngine`, which tells the engine with `setRelayConfig({ bridgeOrigin, endpoints })`, or `setRelayConfig(null)` when nothing is bridged. At most 50 endpoints are bridged (`MAX_BRIDGED_ENDPOINTS`, the engine's limit), and `setEndpoint` refuses to turn on a 51st.
5. The companion holds its relay connection with a credential from `companionRelayActions.companionCredential`. The engine gets its own by the `relay.credential.requested` callback.

### Relay hostnames and credentials

- **Hostnames.** Each instance's bridge is served on a hostname the maintenance API allocates (`PUT /v1/companion-routes/{instanceId}`, derived from the instance id, so idempotent), stored as `instances.companionHostname`. Convex checks only its shape (`c-` and twelve base32 characters, under any domain) and otherwise takes it as the API returns it. The companion itself connects to the fixed `RELAY_URL`.
- **Changing the relay's domain.** The domain comes from the maintenance API's `PUBLIC_BASE_DOMAIN`. Convex caches the hostname and never asks again, so changing that domain requires clearing `companionHostname` on every instance. Each instance then allocates its hostname again on its next sync or credential request.
- **Credentials** are `wfxr1.<kid>.<claims>.<HMAC-SHA256>` (`convex/lib/relayCredential.ts`), lasting five minutes, minted only by Convex with `RELAY_SIGNING_KEY` / `RELAY_SIGNING_KEY_ID`; the relay holds the same key and checks them without a lookup. A companion credential is issued only to a confirmed companion with an endpoint to bridge, and is rate limited.
- **The callback.** `relay.credential.requested` answers `{ relay: { bridgeOrigin, endpoints, credential, expiresAt } }`, or `{ relay: null }` when the instance bridges nothing, which makes the engine clear its relay configuration. The answer is never cached. A successful request is not logged at all, since an engine asks about every four minutes. A failure is logged and recorded in `engineEventLog` with the error, never a credential.

### Revocation

Revoking, unpairing or replacing the companion deletes its row and its `companionEndpoints` rows, and schedules `syncEngine`, which clears the engine's relay configuration within seconds. A companion can also stop bridging without its row being deleted. Re-pairing the same installation leaves it unconfirmed until the person at the PC confirms. Removing its approver from the account, or lowering them below admin, voids its approval. Both schedule `syncEngine` as well. Independently of Convex reaching anything: a deleted companion cannot mint again, the relay closes its socket when its five-minute credential expires without a refresh, and a newer companion's credential displaces it. So a revoked companion is cut off within five minutes at most.

### When the bridge is offered

All four must hold, or the module settings page is unchanged and nothing is bridged:

- Convex env has `RELAY_URL`, `RELAY_SIGNING_KEY` and `RELAY_SIGNING_KEY_ID`.
- The maintenance API is configured (`MAINTENANCE_API_URL`, `MAINTENANCE_API_KEY`). A self-hosted dashboard without it offers no bridge.
- The engine lists the capability `modules.localEndpoints`.
- The instance has a confirmed companion.

### Data

- `companionEndpoints`: per companion and endpoint, `enabled`, the display `address`, `discovered`, `sharesPassword`. Deleted with the companion, and with the module when it is uninstalled. Re-pairing the same installation to the same instance keeps them; the companion wipes its own store when it pairs to a different instance.
- `moduleSettingProvenance`: per instance, module and setting key, `companion` (with `companionValue` for non-secrets) or `manual`. No row means never touched. Deleted when the module is uninstalled (`cascadeDeleteModuleRecord` in `convex/moduleWebhook.ts`) or the instance is deleted.

### Keeping the engine in step

Every change goes through `scheduleRelaySync` (`convex/lib/companionEndpoints.ts`). The cases:

- an endpoint turned on or off;
- the companion confirmed with endpoints already on;
- the companion revoked, re-paired or replaced;
- its approver's role changing;
- a module with enabled endpoints uninstalled;
- the engine registering again. Every handshake, re-registration included, goes through `instances.applyRegistration`.

Each call bumps `instances.relaySyncVersion`. A `syncEngine` run checks that version before and after asking the engine for its capabilities, and does nothing once a newer one exists, so an endpoint turned on and then off cannot reach the engine in reverse order. A failed run retries after 10 s, 60 s and 5 min.

Every 15 minutes the `companion relay resync` cron (`companionRelay.resyncBridgedInstances`) sends the configuration again to each instance with an endpoint turned on. It pages through the enabled rows of `companionEndpoints` only, so an idle deployment costs one empty index read. This repairs an engine that restarted, or one whose session cleared its configuration with `setRelayConfig(null)`. The engine's own credential requests also heal it, since a `{ relay: null }` answer clears a configuration it should not hold.

## Companion states

The window renders `WindowState` (`companion/src-tauri/src/state.rs`, mirrored in `companion/ui/src/state.ts`): the pairing state, `CompanionState`, with its fields at the top level, plus `update`, which is `null` or the [ready update](#updates)'s `{ version }`. Integrations and the relay arrive separately as `IntegrationsView` on the `companion://integrations` event (and from `get_integrations`), since they change far more often.

| State | Shown when |
|---|---|
| `starting` | Before the stored token has been read |
| `offline` | A token is stored but Convex has not answered within a few seconds, so whether it is still paired cannot be told |
| `unpaired` | No token. The window opens with a **Pair** button |
| `pairing` | A code is showing; a countdown runs to its expiry on this PC's clock |
| `confirmPairing` | Approved in the browser; waiting for Confirm or Reject |
| `paired` | Confirmed. Shows the instance and whether Convex is connected |
| `error` | Pairing was declined or expired, or the credential store failed; **Try again** starts over |

On start, a confirmed token resumes the paired session without opening the window. An unconfirmed token returns to the confirm screen if `companions.self` still answers for it unconfirmed, goes straight to `paired` if the server says it was confirmed, and to `unpaired` (releasing the token on the server) if `self` is null.

**Pair** is honoured only from `unpaired` or `error`, and a second click while a code is being requested is ignored. A token left from an earlier pairing is released on the server before the new one replaces it.

Every window command is async, and credential store and integration file calls run on Tokio's blocking pool in the order they were asked for. Convex calls are bounded by a timeout. Tray updates wait for the main thread, so nothing that holds a lock may run there.
