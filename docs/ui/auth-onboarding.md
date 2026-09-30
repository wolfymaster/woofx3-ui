# Auth and onboarding

**Routes:** `/auth/login`, `/auth/register`, `/auth/onboarding`  
**Primary files:** `client/src/pages/auth/login.tsx`, `register.tsx`, `onboarding.tsx`, `client/src/components/onboarding/managed-engine-step.tsx`, `provisioning-progress.tsx`  
**Backend:** `convex/auth.ts`, `convex/auth.config.ts`, `convex/http.ts` (Twitch OAuth, maintenance webhook), `convex/twitchAuth.ts`, `convex/accounts.ts`, `convex/instances.ts`, `convex/registration.ts`, `convex/provisioning.ts`, `convex/provisioningInternal.ts`, `convex/lib/maintenanceClient.ts`

## Login and registration

- **Convex Auth** provides session handling. Twitch sign-in goes through **Convex HTTP routes** (`/api/auth/twitch/start` → Twitch → `/api/auth/twitch/callback`). The SPA starts it with `startTwitchSignIn` (`client/src/lib/twitch-sign-in.ts`), which keeps a random nonce in the tab's `sessionStorage` and sends it to the start route; Convex stores only its hash. The callback stores a one-time pending sign-in and redirects to `/auth/twitch/callback?token=…`, and the page signs in with that token plus the nonce. `twitchAuth.lookupPendingAuth` deletes the pending row on the first attempt and releases it only when the nonce hash matches, so a callback link completed in another browser signs nobody in.
- Connecting Twitch to an instance (as opposed to signing in) starts from the authenticated action `twitchIntegration.startConnect`, which only an instance owner or admin may call: it mints the one-time OAuth state, records who started it, and returns Twitch's authorize URL (with `force_verify=true`, so Twitch always shows its consent screen). The callback never writes the link: it runs in whichever browser Twitch redirected. It exchanges the code, stores the result in `oauthConnectHandoffs` under the SHA-256 of a one-time code (single use, deleted after five minutes; `convex/lib/oauthHandoff.ts`), and redirects to `/auth/twitch/callback?mode=connect&code=…`. The page then calls `twitchIntegration.finishConnect({ code })`, which in one transaction requires the signed-in caller to be the user who started the connect, re-checks their role, refuses a relink to a different Twitch account than the one already linked (`convex/lib/twitchLinkPolicy.ts`), and writes the link with `connectedByUserId`.
- Failures travel as error codes only (`?error=<code>`); the pages map each code to fixed text (`convex/lib/oauthErrors.ts`) and never render the query value. Every `redirect_to` is clamped to a same-site path (`convex/lib/safeRedirect.ts`, which re-checks its own output so dot segments cannot collapse to `//host`) when stored and again on the page before it navigates.
- A module's Spotify connect (a manifest setting with an `integration` action) follows the same shape: `spotifyConnect.start` requires instance membership, mints the PKCE state recording who started it, and returns Spotify's authorize URL (with `show_dialog=true`); `/api/integrations/spotify/callback` re-checks membership, stores the tokens as a handoff, and redirects to the clamped return path with `?integration=spotify&connect_code=…`, where the modules page calls `spotifyConnect.finish({ code })` to write the module settings.
- Password provider routes are registered via `auth.addHttpRoutes` in `http.ts`.

## Onboarding

- **Guard:** only authenticated users reach `/auth/onboarding` (wrapped in `AuthGuard` in `App.tsx`).
- **Step 1 — Workspace:** creates an **account** via `accounts.createAccount` if the user does not already have one (`getMyAccount`). The name is prefilled from the user's display name.
- **Step 2 — Engine:** one of two paths. woofx3 creating the engine (**managed**) is the default. Connecting an engine the user already runs (**external**) is the fallback.

Which path step 2 opens on depends on `provisioning.isAvailable`. It is true only when the deployment has both `MAINTENANCE_API_URL` and `MAINTENANCE_API_KEY` set. Without them, the managed path is hidden entirely and step 2 shows only the engine URL form.

### Managed engine (default)

`ManagedEngineStep` asks for one thing: a **slug**, which becomes the engine's public address `<slug>.on.woofx3.tv`. It is prefilled from the Twitch login (or the workspace name) and cannot be changed later.

1. **Slug check.** While the user types, the slug is format-checked locally (`client/src/lib/engine-slug.ts`) and then, debounced, against the maintenance API through `provisioning.checkSlug`. A check that fails to run does not block the user: the server decides on create.
2. **Create.** "Create my engine" calls `provisioning.startManagedEngine`, which:
   - writes the instance (`hosting: "managed"`) and its `engineProvisioning` row first (`reserveManagedInstance`), so the row id can serve as the maintenance API's idempotency key;
   - generates a **registration token**, hands it to the maintenance API once, and never returns it from any query;
   - asks the maintenance API to create the engine, passing the instance id as `externalRef`, the account as owner, the user's Twitch channel when known, and `<CONVEX_SITE_URL>/api/webhooks/maintenance` as the callback URL.
3. **Progress.** Once the engine is requested, onboarding hands over to [setup](#setup), which shows the `engineProvisioning` row in `ProvisioningBar` above its pages: a headline per status, a progress bar, and the run's steps under **Details**. It polls nothing. The maintenance API posts every step transition to `/api/webhooks/maintenance`, which is signed with `MAINTENANCE_WEBHOOK_SECRET`, deduplicated by event id, and applied by `provisioningInternal.applyCallbackEvent`.
4. **Registration.** On `engine.ready`, Convex stores the engine's public URL on the instance, sets the row to `registering`, and schedules `runRegistration`. That runs the same handshake as the external path (see `CLAUDE.md`), plus the registration token. A managed engine refuses to register anyone who cannot present it. Failed handshakes are retried after 10 s, 30 s and 2 min before the row is marked `failed`.
5. **Done.** When the row reaches `registered` and setup is finished, setup's last page sets **`$currentInstanceId`** and navigates home.

Row statuses: `requested` → `provisioning` → `registering` → `registered`, with `upgrading`, `failed`, `deprovisioning` and `deleted` off the main line. A registered row goes to `upgrading` and back when its engine changes release (see [Admin and team](admin-team.md)). `engine.ready` moves a row straight to `registering`. `ready` is in the schema, but nothing currently writes it.

**Reloading mid-provision** comes back to setup, not an empty form. Onboarding looks for a managed instance with no `clientId` yet and sends the user to `/setup`. The exception is a row that is missing or `deleted`: that instance has nothing behind it, so the form is offered again.

**Failure and retry.** A `failed` row shows the error and "Try again" in the provisioning bar, which calls `provisioning.retry`. If the engine already published a URL, only registration is re-run. Otherwise the maintenance run is resumed.

"Already have an engine? Connect it" switches to the external form.

### External engine

The form takes an instance name and the engine's API URL. It creates the instance with `instances.create`, then runs the handshake with `registration.registerInstance`. On success it sets **`$currentInstanceId`** and navigates to `/setup`. When the managed path is available, "Don't have one? Let woofx3 run it for you" switches back to it.

> **Note:** The full **registration handshake** (engine stores the callback URL and token; Convex receives the client credentials) is described in `CLAUDE.md`.

## Setup

`/setup/:step` (`client/src/pages/setup.tsx`) is a wizard with one route per page, so a reload, the back button and the Twitch OAuth round trip all return to the page the user was on. It runs while a managed engine is being built. Its state is the instance's `instanceSetup` row, read through `setup.status`. The heading above the steps is the workspace (account) name from `setup.status`; the product name stands in while it loads.

1. **Choose your platforms** (`PlatformsStep`): the curated list from `setupPlatformsActions.listForSetup` (see [Modules → Setup platforms](/ui/modules#setup-platforms)), with each platform's permissions in plain language. Twitch is required, so it is checked and locked. Continue saves the chosen platforms and the permissions shown for each with `setup.choosePlatforms`. That is the consent a later install is checked against. If a required platform cannot be resolved, the page shows an error with "Try again" and cannot continue.
2. **Connect Twitch** (`TwitchStep`): `useTwitchConnect` with `/setup/twitch` as the return path. The link needs only the instance row, so it works before the engine exists. `instances.applyRegistration` sends an existing link to the engine when it registers. OAuth errors show on the callback page with the fixed text from `convex/lib/oauthErrors.ts`, and its Back link returns here.
3. **What do you want woofx3 to do?** (`InterestsStep`): the interests the chosen platforms can deliver (`SETUP_INTERESTS` in `convex/lib/setupInterests.ts`). Each installs starter packs with their default wording, and shapes the dashboard. Saved with `setup.chooseInterests`; **Skip** saves none.
4. **Your dashboard** (`DashboardStep`): a preview of the first panel `buildDashboardPreset` makes from the interests. Every zone gets a widget even with no interests, so a skipped question still gives a usable dashboard. "Use this dashboard" calls `setup.complete`. That marks setup finished and gives the caller that panel, unless they already have panels, which are never replaced. It is refused until platforms are chosen and Twitch is linked.
5. **Your overlay** (`OverlayStep`, skippable): the browser-source URL for OBS, with a copy button and the steps to add it.
   - It uses the instance's oldest scene. With no scene, **Create my overlay** makes "Main overlay" (1920×1080) with the catalog's alert widget over the whole canvas, named `default`, so alerts play in OBS right away (`client/src/lib/setup-overlay.ts`).
   - Scenes live on the engine, so before the engine is ready the page only says the URL will appear in the Getting started list.
6. **All set** (`FinishStep`): what will be installed and set up, with each item's progress. The dashboard opens when the engine registers, or from "Open your dashboard" when it already has.

The first two pages cannot be skipped. Opening a later page's URL early lands on the first page still to do (`client/src/lib/setup-steps.ts`).

### Applying the choices

`setupApply.run` installs what setup chose once there is an engine. It is scheduled when setup finishes on a registered engine, and by `instances.applyRegistration` when the engine registers after setup finished.

- **Modules first.** Each chosen platform is installed with `marketplace.installApprovedModule` and the permissions approved on the platforms page. A build asking for more is recorded as `needs_approval` and is not installed.
- **Then starter packs.** The packs for the chosen interests whose modules installed, with default wording, through the same `starterPackItems` ledger as the Starter packs page. A module's triggers reach Convex by webhook shortly after it installs, so an item can be unavailable at first. Such a pack is retried after 15 s, 30 s, 1 min, 2 min and 5 min, then marked failed with the reason.
- **Results** are stored on `instanceSetup` (`moduleInstalls`, `packInstalls`) and shown on the All set page.
- **Required platform problems.** A required platform that failed or needs approval shows `SetupInstallBanner` under the shell header, with **Retry** (`setup.retryApply`) or **Allow and install** (`setup.approveModulePermissions`). Nothing else is blocked.
- **Safe to run again.** Installed modules and packs are skipped, and a claim on the row keeps two runs from overlapping.

Only an owner or admin can choose platforms or connect Twitch. Any other member sees "Ask an owner or admin to connect Twitch".

The wizard records that it opened for the signed-in user (`setup.markSeen`, per user in `userSetupSeen`).

## After onboarding

`OnboardingGuard` requires an account, at least one registered instance and a Twitch link on the current instance before showing a page inside `BroadcastShell`.

- **No Twitch link:** an owner or admin is sent to setup's first unfinished page. Anyone else sees "Ask an owner or admin to connect Twitch" in the content area, not a redirect.
- **Link health:** the guard checks only that a link exists. A revoked or under-scoped link is left to the reconnect banner, so an established user is never sent back into setup.
- **Unfinished setup:** while the instance's setup is unfinished, the guard also opens setup once for an owner or admin who has not seen it.

A managed engine's later lifecycle (its flag, upgrades, retry and deletion) lives on the admin engine page, backed by `provisioning.engineFlag`, `upgradeInfo`, `upgradeManagedEngine`, `retry` and `deleteManagedEngine`. Deleting the engine keeps the Convex instance row, since that row still owns the account's scenes, workflows and members.
