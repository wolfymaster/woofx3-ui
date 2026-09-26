# Auth and onboarding

**Routes:** `/auth/login`, `/auth/register`, `/auth/onboarding`  
**Primary files:** `client/src/pages/auth/login.tsx`, `register.tsx`, `onboarding.tsx`, `client/src/components/onboarding/managed-engine-step.tsx`, `provisioning-progress.tsx`  
**Backend:** `convex/auth.ts`, `convex/auth.config.ts`, `convex/http.ts` (Twitch OAuth, maintenance webhook), `convex/twitchAuth.ts`, `convex/accounts.ts`, `convex/instances.ts`, `convex/registration.ts`, `convex/provisioning.ts`, `convex/provisioningInternal.ts`, `convex/lib/maintenanceClient.ts`

## Login and registration

- **Convex Auth** provides session handling; Twitch OAuth is initiated through **Convex HTTP routes** (e.g. `/api/auth/twitch/start` → Twitch → callback) that validate state and complete sign-in.
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
3. **Progress.** `ProvisioningProgress` renders the `engineProvisioning` row: a headline per status plus the run's steps. It polls nothing. The maintenance API posts every step transition to `/api/webhooks/maintenance`, which is signed with `MAINTENANCE_WEBHOOK_SECRET`, deduplicated by event id, and applied by `provisioningInternal.applyCallbackEvent`.
4. **Registration.** On `engine.ready`, Convex stores the engine's public URL on the instance, sets the row to `registering`, and schedules `runRegistration`. That runs the same handshake as the external path (see `CLAUDE.md`), plus the registration token. A managed engine refuses to register anyone who cannot present it. Failed handshakes are retried after 10 s, 30 s and 2 min before the row is marked `failed`.
5. **Done.** When the row reaches `registered`, the page sets **`$currentInstanceId`** and navigates home.

Row statuses: `requested` → `provisioning` → `registering` → `registered`, with `failed`, `deprovisioning` and `deleted` off the main line. `engine.ready` moves a row straight to `registering`. `ready` is in the schema, but nothing currently writes it.

**Reloading mid-provision** comes back to the progress screen, not an empty form. The page looks for a managed instance with no `clientId` yet and shows its progress. The exception is a row that is missing or `deleted`: that instance has nothing behind it, so the form is offered again.

**Failure and retry.** A `failed` row shows the error and "Try again", which calls `provisioning.retry`. If the engine already published a URL, only registration is re-run. Otherwise the maintenance run is resumed.

"Already have an engine? Connect it" switches to the external form.

### External engine

The form takes an instance name and the engine's API URL. It creates the instance with `instances.create`, then runs the handshake with `registration.registerInstance`. On success it sets **`$currentInstanceId`** and navigates home. When the managed path is available, "Don't have one? Let woofx3 run it for you" switches back to it.

> **Note:** The full **registration handshake** (engine stores the callback URL and token; Convex receives the client credentials) is described in `CLAUDE.md`.

## After onboarding

`OnboardingGuard` requires both an account and at least one instance before showing `BroadcastShell`. A managed engine's later lifecycle (its flag, retry and deletion) lives on the admin engine page, backed by `provisioning.engineFlag`, `retry` and `deleteManagedEngine`. Deleting the engine keeps the Convex instance row, since that row still owns the account's scenes, workflows and members.
