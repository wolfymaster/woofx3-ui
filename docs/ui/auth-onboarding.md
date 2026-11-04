# Auth and onboarding

**Routes:** `/auth/login`, `/auth/register`, `/auth/onboarding`  
**Primary files:** `client/src/pages/auth/login.tsx`, `register.tsx`, `onboarding.tsx`, `client/src/components/setup/connect-step.tsx`, `client/src/components/onboarding/managed-engine-step.tsx`  
**Backend:** `convex/auth.ts`, `convex/auth.config.ts`, `convex/http.ts` (Twitch OAuth, maintenance webhook), `convex/twitchAuth.ts`, `convex/accounts.ts`, `convex/instances.ts`, `convex/registration.ts`, `convex/provisioning.ts`, `convex/provisioningInternal.ts`, `convex/lib/maintenanceClient.ts`

## Login and registration

- **Convex Auth** provides session handling. Twitch sign-in goes through **Convex HTTP routes** (`/api/auth/twitch/start` → Twitch → `/api/auth/twitch/callback`). The SPA starts it with `startTwitchSignIn` (`client/src/lib/twitch-sign-in.ts`), which keeps a random nonce in the tab's `sessionStorage` and sends it to the start route; Convex stores only its hash. The callback stores a one-time pending sign-in and redirects to `/auth/twitch/callback?token=…`, and the page signs in with that token plus the nonce. `twitchAuth.lookupPendingAuth` deletes the pending row on the first attempt and releases it only when the nonce hash matches, so a callback link completed in another browser signs nobody in. The desktop app starts the same route with `client=desktop` and only the nonce's hash, and claims the outcome from Convex with the nonce instead of reading a token from a URL (see [Twitch sign-in in the desktop app](/ui/companion#twitch-sign-in-in-the-desktop-app)).
- Connecting Twitch to an instance (as opposed to signing in) starts from the authenticated action `twitchIntegration.startConnect`, which only an instance owner or admin may call: it mints the one-time OAuth state, records who started it, and returns Twitch's authorize URL (with `force_verify=true`, so Twitch always shows its consent screen). The callback never writes the link: it runs in whichever browser Twitch redirected. It exchanges the code, stores the result in `oauthConnectHandoffs` under the SHA-256 of a one-time code (single use, deleted after five minutes; `convex/lib/oauthHandoff.ts`), and redirects to `/auth/twitch/callback?mode=connect&code=…`. The page then calls `twitchIntegration.finishConnect({ code })`, which in one transaction requires the signed-in caller to be the user who started the connect, re-checks their role, refuses a relink to a different Twitch account than the one already linked (`convex/lib/twitchLinkPolicy.ts`), and writes the link with `connectedByUserId`. The callback seals the access and refresh tokens before the handoff is stored, so neither table ever holds them in the clear (see [Platform token encryption](../ops/deploy.md#platform-token-encryption)). The link's token reaches the engine through `twitchIntegration.syncToEngine` with the Twitch app's `clientId` and never with the refresh token. The engine asks for a current access token with the `twitch.token.requested` callback, answered by `twitchIntegration.grantTokenToEngine`, which refreshes the link first when it is close to expiring.
- Failures travel as error codes only (`?error=<code>`); the pages map each code to fixed text (`convex/lib/oauthErrors.ts`) and never render the query value. Every `redirect_to` is clamped to a same-site path (`convex/lib/safeRedirect.ts`, which re-checks its own output so dot segments cannot collapse to `//host`) when stored and again on the page before it navigates.
- Every OAuth callback URL is `OAUTH_CALLBACK_BASE_URL` (or the deployment's own `CONVEX_SITE_URL`) plus the route's path (`convex/lib/oauthCallback.ts`), and every OAuth state names the deployment that minted it (`convex/lib/oauthState.ts`). Preview deployments point their callbacks at production, which forwards a signed state's callback to the deployment it names; see `docs/ops/previews.md`.
- A module's OAuth connect (a manifest setting with an `integration` action naming one of its `oauth[]` integrations) follows the same shape: `moduleOAuth.start` requires instance membership, mints the PKCE state recording who started it and which app it used, and returns the provider's authorize URL; `/api/integrations/oauth/callback` re-checks membership, stores the authorization code as a handoff, and redirects to the clamped return path with `?integration=<id>&oauth_code=…`, where the modules page calls `moduleOAuth.finish({ code })` to hand the code to the engine, which exchanges it and keeps the tokens. The app a connect authorizes against is the module's own client id setting when it has one. Otherwise a managed instance uses the app woofx3 provides for that provider, stored in the `integrationCredentials` table (set with `bunx convex run integrationCredentials:set`), but only when the module's declaration names exactly the endpoints that app is registered for, with no client secret of its own (`PLATFORM_OAUTH_PROVIDERS` in `convex/lib/integrationClientId.ts`): the engine exchanges the code at the manifest's `tokenUrl` and sends tokens to its `hosts`, so any other endpoint would hand woofx3's authorizations to whoever wrote the module. A module's client id setting that holds one of woofx3's app ids (a manifest `defaultValue` can put it there) is held to the same rule rather than treated as the module's own app. `finish` chooses the app again before the exchange and refuses when it changed, and passes the engine the `tokenUrl` it checked, which the engine requires to match the installed integration's. An external instance must enter its own app.
- Password provider routes are registered via `auth.addHttpRoutes` in `http.ts`.
- The register page (`register.tsx`) leads with Continue with Twitch, then email and password only. It has no name field: the `Password` provider stores just the email, so a name would be discarded. Inputs carry `autoComplete` values (`email`, `new-password`) and the 8-character minimum is stated. `registerError` (`client/src/lib/register-error.ts`) turns a failed sign-up into friendly copy; a rejected password gets its own message, and every other failure offers a Sign in link, because production Convex redacts server errors, so an existing account cannot be told from other failures.

## Onboarding

A new user asks nothing here. `/auth/onboarding` (`client/src/pages/auth/onboarding.tsx`, routing in `client/src/lib/onboarding-route.ts`) makes the rows setup works on and hands over:

- **Managed engines available** (`provisioning.isAvailable`, which needs `MAINTENANCE_API_URL` and `MAINTENANCE_API_KEY`): `setup.ensureFirstRun` creates the account and a managed instance row, both named "My woofx3", then goes to `/setup/connect`. Twitch can link at once because `twitchIntegration.startConnect` needs only the instance row.
- **A preview with a paired engine:** the engine is connected without asking, and the form appears only if that fails. See [Previews](/ops/previews#setup-without-twitch).
- **No managed engines, or the connect screen's "Running your own server? Connect it" link** (`?external=1`): the form below.
- **An instance already registered or being built:** straight on to `/setup`, so a user who refreshes or comes back mid-build resumes where setup is.

### External engine

The form takes the engine's address. It makes the account if needed (`accounts.ensureMyAccount`), creates the instance with `instances.create` (which takes over a managed row that has no provisioning row yet), runs the handshake with `registration.registerInstance`, and goes to `/setup`, where Twitch still has to connect.

> **Note:** The full **registration handshake** (engine stores the callback URL and token; Convex receives the client credentials) is described in `CLAUDE.md`.

### Managed engine

The engine starts when Twitch links, under a username derived from the login. Nothing asks for it unless every candidate fails.

1. **Username.** `slugCandidates` (`convex/lib/firstRun.ts`) turns the Twitch login, never an email, into `<base>`, `<base>-tv`, `<base>-live`, `<base>-2` to `-5`, then `tv-<base>` for reserved prefixes, all within the 30-character limit. `provisioning.startFirstEngine` tries them in order through the maintenance API's availability check, and the create call has the last word, so a candidate lost to a race moves to the next. If none is left, or the login has nothing usable, `instanceSetup.usernameNeededAt` makes the connect screen show one inline field (`ManagedEngineStep`), which calls `provisioning.startManagedEngine`. The username is permanent and public: `woofx3.tv/<username>` and `<username>.woofx3.tv`.
2. **Create.** Each attempt:
   - writes the instance (`hosting: "managed"`) and its `engineProvisioning` row first (`reserveManagedInstance`);
   - generates a **registration token**, hands it to the maintenance API once, and never returns it from any query;
   - asks the maintenance API to create the engine under a new idempotency key, passing the instance id as `externalRef`, the account as owner, the Twitch login as the channel, and `<CONVEX_SITE_URL>/api/webhooks/maintenance` as the callback URL. The key is per attempt because the maintenance API stores refusals under a key and refuses a key reused with a different request, so a new slug or token under an old key could never succeed. A `requested` row refuses a second attempt for 15 minutes, so two cannot race.
3. **Progress.** `ProvisioningBar` above the connect page, and the overlay page and the wait for a build (through `useEngineBuild`), show the `engineProvisioning` row in plain language: a headline per status and a progress bar. The run's steps and raw errors stay on the admin engine page. It polls nothing. The maintenance API posts every step transition to `/api/webhooks/maintenance`, which is signed with `MAINTENANCE_WEBHOOK_SECRET`, deduplicated by event id, and applied by `provisioningInternal.applyCallbackEvent`.
4. **Registration.** On `engine.ready`, Convex stores the engine's public URL on the instance, sets the row to `registering`, and schedules `runRegistration`. That runs the same handshake as the external path (see `CLAUDE.md`), plus the registration token. A managed engine refuses to register anyone who cannot present it. Failed handshakes are retried after 10 s, 30 s and 2 min before the row is marked `failed`.
5. **Done.** Once the row reaches `registered` and the overlay page has been passed, setup sets **`$currentInstanceId`** and opens the dashboard.

Row statuses: `requested` → `provisioning` → `registering` → `registered`, with `upgrading`, `failed`, `deprovisioning` and `deleted` off the main line. A registered row goes to `upgrading` and back when its engine changes release (see [Admin and team](admin-team.md)). `engine.ready` moves a row straight to `registering`. `ready` is in the schema, but nothing currently writes it.

**Failure and retry.** A `failed` row shows "Try again" on whichever screen is waiting, which calls `provisioning.retry`. So does a build that stopped without saying so (`engineBuildStalled`): a row stuck on `requested` past the in-flight limit, a finished setup with no row after a grace period, or an unregistered engine the user runs. Retry can make the request again, under the same idempotency key and registration token while the last one's outcome is unknown, so a lost response returns the same engine. An apply run that dies is rescheduled when its claim expires, and settles as failed when its tries run out. If the engine already published a URL, only registration is re-run. If the maintenance API accepted the engine, the run is resumed. If it never did, the username candidates are tried again. An instance whose engine was deleted before registering gets the inline username field again.

## Setup

`/setup/:step` (`client/src/pages/setup.tsx`) has one route per page, so a reload, the back button and the Twitch OAuth round trip all return to the right place. It runs while a managed engine is being built. Its state is the instance's `instanceSetup` row, read through `setup.status`. Any other step's URL lands where the user belongs (`client/src/lib/setup-steps.ts`).

**Connect Your Streaming Platform** (`/setup/connect`, `ConnectStep`) is one Twitch card with the module's permissions in plain language, from `setupPlatformsActions.listForSetup`. Signing in with Twitch and this connection stay two separate authorizations, and the second is requested every time because it carries the channel scopes.

- **Consent.** Pressing Connect holds the Twitch module and exactly the permissions on the card (`setup.prepareConnect`), then starts the Twitch connection. Linking records them as consent (`recordLinkConsent`, in `completeConnect`), so a denial records nothing. That record is what the later install is checked against ("Connecting means you approve what's listed"). A reconnect, on any setup already chosen, only restores the link.
- **On return,** `twitchIntegration.completeConnect` does everything in one transaction: writes the link, renames what is still "My woofx3" (the account to the Twitch display name, the instance to `{display}'s Instance`) and fills `users.name` when empty (`linkedNames`), then runs `setup.finishFirstRun`. That marks setup finished, seeds the dashboard, schedules the apply if the engine is registered and otherwise leaves it to registration, and schedules the engine build. Setup's routing then moves on to `/setup/overlay` with no click, so abandoning any time after Connect leaves nothing half done.
- **Linked some other way** before setup finished, such as from the integrations page, the screen shows "Connected as @name" with Continue, which records the same consent, unless a choice already stands, through `setup.complete`.
- **Errors.** OAuth errors show on the callback page with the fixed text from `convex/lib/oauthErrors.ts`, and its Back link returns here.

After it come the [overlay page](#the-overlay-page) and [the wait for a build](#the-wait-for-a-build). Setup asks nothing else. Importing from Firebot or Streamer.bot, ready-made commands, optional platforms such as OBS and Spotify, and publishing a page are offered afterwards by the dashboard's [Todo panel](/ui/dashboard#getting-started-checklist). The old platform, import, interests and dashboard pages are gone, and `setup.chooseImport` and `setup.chooseInterests` with them. The stored `importChosenAt` and `interestsChosenAt` fields stay optional in the schema so existing rows still validate.

### The overlay page

`/setup/overlay` (`client/src/components/setup/overlay-page.tsx`) is a state machine in `client/src/lib/overlay-onboarding.ts` with the UI over it. It uses gateway hooks only, and `local-routes.test.ts` holds it to that, so local mode can adopt it. The two things it needs from the hosted app are props: `engine` (the build, from `useEngineBuild`) and `onExit`.

| Phase | Shown when | Next |
|---|---|---|
| `building`, `build-failed` | The engine has not registered, or its build failed | Registering moves on; **Try again** runs `provisioning.retry` |
| `preparing` | The seed is still running, or the first presence answer has not come | After a seed item has held a recorded error for a minute (`seedIsSlow`), says this is taking longer than usual and offers **Try again** |
| `seed-failed` | The seed gave up on the scene | **Try again** (`defaultSeed.useApplyRequest`) puts failed items back to pending and runs the apply now; the ledger and the scene search keep it from creating anything twice |
| `no-scene` | The seeded scene is gone, or the setup was never seeded | **Make a new overlay** creates the seed's scene, then goes to `waiting` for its link even on a finished account |
| `waiting` | There is a scene and nothing is connected | Link, per-app steps and a test tab. A hint at 60 s, a troubleshooting list at 3 min |
| `connected` | An overlay is open | **Send a test alert**. The link and test tab stay up, since a just-closed overlay can read as open for a few seconds |
| `sending`, `playing` | A test is on its way | |
| `unconfirmed` | 60 s with no answer | **Yes, it played** or **Send again** |
| `test-failed` | The alert failed or the send was refused | Plain copy: the overlay isn't ready when no running scene has the widget, a generic line otherwise (`testFailureMessage`), **Try again**. It outranks a closed overlay, so the reason stays up |
| `finished` | The alert completed, the streamer saw it play, or a page load finds `overlayDone` recorded as `finished` | **Open Dashboard**, **Send another test** and the link |

An overlay closing during a test goes back to `waiting`, keeping the test's `triggerId`: the engine holds the alert for an overlay it has not noticed closing, so it can play when the overlay comes back, and its completion still finishes. `finished` stays through a closing overlay, because a test in a plain browser tab counts and that tab may well be closed next.

**What the state comes from.** Everything but a test in flight comes from the server, so a refresh lands in the right place; a refresh during a test returns to `connected`, or to `finished` once one has finished. The scene is the seed's `engineSceneId`, or any scene with the default alert widget (`overlaySceneOf`). A deleted scene or follow alert keeps its stored `installed` status, so its existence is read from the scenes and workflows reads. Since those reads fill by webhook, something absent counts as deleted only after 20 seconds. With the follow alert gone the link still works, and the page points to the Alerts screen instead of offering a test.

**The URL is a credential.** It is masked until **Show**, and the page says to treat it like a password. It always comes from `overlays.useBrowserSourceUrlRequest` for the scene above.

**Presence** is `alertQueue.useOverlayOpen`, which asks the engine's `getAlertQueue` every 3 seconds while the page has a scene. `overlayPresenceOf` reads the answer: only the reason "no overlay is open" means closed. Any other `ok: false`, such as a scene manager that did not answer, or a failed call, is `unknown`, which neither connects nor disconnects. The signal is any open connection to any scene, so these also count as open: the scene editor's preview (it holds the same event stream as a browser source), and a scene with no alert widget. A test played then simply fails with the reason.

**Correlating a test.** `useFireTestEvent` returns a `triggerId`, and `alertOfTestEvent` finds the alert carrying it. Do not match on the seeded workflow id: an alert's `workflowId` is its run's id.

### Passing the overlay page

`instanceSetup.overlayDone` records it, per instance, through `defaultSeed.useMarkOverlayDoneRequest`: `finished` when an alert played or was seen to, `skipped` from **Skip for now**. `finished` is never overwritten. `defaultSeed.useStatus` returns it as `overlayDone`.

`setup.status` gives `overlayPending`: setup finished, seeded, and nothing recorded. While it is true, `OnboardingGuard` sends an owner or admin from the app to the overlay page, and `/setup` opens there. Once recorded nobody is sent back. A setup from before the seed existed never owes the page. The page stays open to anyone able to manage setup, from any later link; there the exit reads **Back to dashboard**.

### The wait for a build

`/setup/finish` is where the overlay page leaves to (`EngineSplash`). With a registered engine it opens the dashboard at once. Otherwise it stays full screen with silly messages (`client/src/lib/loading-messages.ts`, picked with an injected random source and never repeating immediately) and opens the dashboard by itself on registration. The messages are hidden from assistive technology behind one steady status line, and reduced motion stops the animation. A failed build stops the messages and shows plain copy with **Try again**.

A refresh stays on the route. Opening the app from anywhere else also returns here while the build runs: `OnboardingGuard` requires a registered instance, onboarding hands an unregistered managed instance to `/setup`, and `/setup` opens the overlay page or, once it has been passed, this one.

### Applying the choices

`setupApply.run` installs what setup chose once there is an engine. It is scheduled when setup finishes on a registered engine, and by `instances.applyRegistration` when the engine registers after setup finished. It is safe to run any time after platforms are chosen on a registered engine: nothing in it needs a linked Twitch account.

- **Modules first.** Each chosen platform is installed with `marketplace.installApprovedModule` and the permissions approved on the platforms page. A build asking for more is recorded as `needs_approval` and is not installed.
- **Then the default seed** (`shared/default-seed.ts`, `convex/defaultSeed.ts`): the "Default Browser Overlay" scene with an alert widget in the top right corner, then one alert workflow each for follows, subs, resubs, gifted subs and bits. The scene's engine id is recorded on `instanceSetup.defaultSeed`; a scene that already has the default alert widget stands in for it. The workflows go through the `starterPackItems` ledger under the pack id `default-alerts`, with `seedOnce`: an installed row stays installed after its workflow is deleted, so what the streamer deleted never comes back. An alert whose event already starts a workflow on the engine is left out and recorded as installed: the engine merges workflows on one event into one list of steps, so a default added there would play alongside the streamer's own alert. An alert's image comes from the engine's bundled woofx3 module; below module 0.45.0 the alerts are text only, and `alertImages` records it. `defaultSeed.useStatus` (a gateway namespace) reads all of this. Only an instance the first-run path made is seeded (`instanceSetup.firstRunAt`, written by `setup.ensureFirstRun` and by `instances.create` for an account's first engine, a preview's paired one included). Any other instance may hold a streamer's own alerts, so it is never seeded and never owes the overlay page, and reconnecting Twitch on it only restores the link.
- **Then starter packs.** The packs for the chosen interests whose modules installed, with default wording, through the same `starterPackItems` ledger as the Starter packs page. A module's triggers reach Convex by webhook shortly after it installs, so an item can be unavailable at first. Such a pack is retried after 15 s, 30 s, 1 min, 2 min and 5 min, then marked failed with the reason, and so is anything pending in the default seed.
- **Results** are stored on `instanceSetup` (`moduleInstalls`, `packInstalls`, `defaultSeed`) and read by the overlay page and the install banner.
- **Required platform problems.** A required platform that failed or needs approval shows `SetupInstallBanner` under the shell header, with **Retry** (`setup.retryApply`) or **Allow and install** (`setup.approveModulePermissions`). Nothing else is blocked.
- **Safe to run again.** Installed modules and packs are skipped, and a claim on the row keeps two runs from overlapping.
- **Then a queued import.** `setup.complete` schedules `setupImports.resumeQueued`, which starts any import queued during setup. It waits while modules install or starter packs are pending, as described in [Applying an import](/ui/setup-imports#applying-an-import).

Only an owner or admin can choose platforms or connect Twitch. Any other member sees "Ask an owner or admin to connect Twitch".

Setup records that it opened for the signed-in user (`setup.markSeen`, per user in `userSetupSeen`).

## After onboarding

`OnboardingGuard` requires at least one registered instance the user can reach and a Twitch link on the current instance before showing a page inside `BroadcastShell`. The instance may be one they were invited to: a user who only uses another account's instance, such as a moderator who does not stream, owns no account or instance and never goes through onboarding.

- **No registered instance:** the user goes to onboarding, which passes them on to setup, even mid-build. The dashboard never loads without a registered engine.
- **No Twitch link:** an owner or admin is sent to the connect screen. Anyone else sees "Ask an owner or admin to connect Twitch" in the content area, not a redirect.
- **Link health:** the guard checks only that a link exists. A revoked or under-scoped link is left to the reconnect banner, so an established user is never sent back into setup.
- **Unfinished setup:** while the instance's setup is unfinished, the guard also opens setup once for an owner or admin who has not seen it.
- **Overlay page not passed:** see [Passing the overlay page](#passing-the-overlay-page).

A managed engine's later lifecycle (its flag, upgrades, retry and deletion) lives on the admin engine page, backed by `provisioning.engineFlag`, `upgradeInfo`, `upgradeManagedEngine`, `retry` and `deleteManagedEngine`. Deleting the engine keeps the Convex instance row, since that row still owns the account's scenes, workflows and members. Deleting the instance from the Danger Zone (`instances.deleteInstance`) deprovisions its managed engine first, which removes the edge route and releases the slug, and refuses to delete the instance if the maintenance API can't start that teardown.
