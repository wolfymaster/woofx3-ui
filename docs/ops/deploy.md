# Deploying to production

Every commit that lands on `master` and passes CI is deployed to production by `.github/workflows/deploy.yml`. Nothing needs to be run by hand.

## What happens

1. **CI** (`ci.yml`) runs on the push to `master`.
2. When CI succeeds, **Deploy (production)** starts for the same commit. It runs two jobs in order:
   - **Deploy Convex**: `bunx convex deploy` pushes functions and schema to the production Convex deployment.
   - **Build image and deploy UI**: builds the `Dockerfile`, pushes it to `ghcr.io/wolfymaster/woofx3-ui` tagged with the commit SHA and `latest`, points the Railway UI service (woofx3 project, production environment) at the SHA tag, and waits for Railway to report the deployment as `SUCCESS`.

The UI job runs only if the Convex deploy succeeded, so a client never goes live calling functions that are not deployed yet. If the Railway deployment fails or crashes, the job fails and the run is red.

Deploys queue behind each other and are never cancelled partway. A manual run (**Actions → Deploy (production) → Run workflow**) deploys the head of `master` without waiting for CI.

## The image

The UI is a static Vite build served by Caddy (`deploy/Caddyfile`):

- Any path that is not a file serves `index.html`, because Wouter routes on the client. Deep links and refreshes work.
- `/u/<slug>` is the public user page, a separate build in `dist/u` (see [User pages](/ui/user-pages)). Every `/u/` path that is not under `/u/assets/` serves `/u/index.html`, so the dashboard never answers one; bare `/u` and `/u/` redirect to `/`.
- Files under `/assets/` and `/u/assets/` are content-hashed and cached for a year. A missing asset is a 404, not `index.html`.
- Everything else, including `index.html`, is served `no-cache`, so a new deploy is picked up on the next load.
- Caddy listens on `$PORT`, which Railway sets (8080 when unset).

`VITE_CONVEX_URL` and `VITE_CONVEX_SITE_URL` are inlined at build time, so an image is tied to one Convex deployment. The build fails if either is missing.

To build and run it locally, from the `woofx3-ui` checkout with the engine checked out next to it:

```bash
docker build \
  --build-context engine=../woofx3 \
  --build-arg VITE_CONVEX_URL=https://<deployment>.convex.cloud \
  --build-arg VITE_CONVEX_SITE_URL=https://<deployment>.convex.site \
  -t woofx3-ui .
docker run --rm -p 8080:8080 woofx3-ui
```

The `engine` build context is the engine checkout. It supplies the engine's shared type package (`@woofx3/api`) and its composition package (`@woofx3/scene`, the scene editor's model and headless editor), which live outside this repository. Their dependencies are installed from the engine's workspace lockfile (`bun.lock` at its root), filtered to those two packages, so the context needs the root `package.json`, `bun.lock` and every workspace member's `package.json` as well as the two packages' sources. The deploy workflows check out exactly that subset of the engine.

## Secrets and variables

Everything environment-specific lives in the `production` GitHub Environment (**Settings → Environments → production**). The workflow file holds no IDs or URLs.

| Name | Kind | Purpose |
|------|------|---------|
| `CONVEX_DEPLOY_KEY` | secret | Production deploy key from the Convex dashboard |
| `RAILWAY_TOKEN` | secret | Railway project token for the woofx3 project, production environment |
| `VITE_CONVEX_URL` | variable | Production Convex URL (`*.convex.cloud`), baked into the bundle |
| `VITE_CONVEX_SITE_URL` | variable | Production Convex HTTP actions URL (`*.convex.site`), baked into the bundle |
| `VITE_TURNSTILE_SITE_KEY` | variable | Cloudflare Turnstile site key, baked into the user page bundle. Optional; see [Forms](../ui/user-pages.md#forms) |
| `RAILWAY_ENVIRONMENT_ID` | variable | Railway production environment |
| `RAILWAY_SERVICE_ID` | variable | Railway UI service |

The deploy does not manage Convex environment variables (`AUTH_TWITCH_*`, `SITE_URL`, JWT keys, storage configuration). They are set on the production deployment in the Convex dashboard.

Railway pulls the image from GHCR. The `woofx3-ui` package must be public, or the Railway service needs registry credentials (a GitHub token with `read:packages`). The image holds only the public client bundle.

## Platform token encryption

Convex keeps each instance's Twitch grant (`platformLinks`) so it can renew the access token and hand it to the engine. The access and refresh tokens are stored encrypted with AES-256-GCM (`convex/lib/tokenCipher.ts`), so a database export or a dashboard data view alone does not give them away. Only Convex functions running in actions open them, through `convex/lib/platformLinkTokens.ts`; no query returns them, sealed or not, to a browser or to the ops API.

Each kind of token has its own key, so one can be replaced without touching the other:

| Convex variable | Seals | Key id |
|-----------------|-------|--------|
| `PLATFORM_TOKEN_ENCRYPTION_KEY` | Streamer grants in `platformLinks` and the Twitch connect handoff | `p1` |
| `VIEWER_TOKEN_ENCRYPTION_KEY` | Viewer grants in `viewerPlatformTokens` ([Viewer sign-in](../ui/viewer-sign-in.md)) | `v1` |

Each key is 32 random bytes, base64url: `openssl rand -base64 32 | tr '+/' '-_' | tr -d '='`. Set it on the production deployment and in the preview default variables (previews get their own value; their links are thrown away with the deployment). A sealed value starts with its key id (`p1.…`), so a later rotation can tell values sealed under the old key from the new one. Changing a key without resealing makes every grant it sealed unreadable: streamers would have to reconnect Twitch.

Without `PLATFORM_TOKEN_ENCRYPTION_KEY`, connecting Twitch and every Twitch call fail rather than store or read a token in the clear.

## Rolling back

- **UI**: in Railway, open the UI service's deployments and redeploy an earlier one. Each deployment is pinned to an image SHA, so this restores that exact build. The next merge to `master` deploys over it.
- **Convex**: there is no automatic rollback. Revert the change on `master` and merge; the revert deploys like any other commit. A schema change that existing documents cannot satisfy fails `convex deploy`, which also stops the UI job, so fix the data or the schema before retrying.

A UI rollback that predates a Convex change can call functions whose arguments have since changed. Roll back both together when a change touched both.

## Data migrations

Tracked migrations use the `@convex-dev/migrations` component: each one is defined in a file under `convex/migrations/` and run by name through the runner (add `--prod` for production):

```bash
bunx convex run migrations/index:run '{"fn": "migrations/<file>:<name>"}'
```

The component records progress per migration:

- **The runner returns before the migration is done.** A table larger than one batch (100 documents by default) keeps running in the background after the command prints `Migration started.` Watch it until `state` is `success`:
  ```bash
  bunx convex run --component migrations --watch lib:getStatus '{"names": ["migrations/<file>:<name>"]}'
  ```
- **Running it again is safe.** While it is in progress the runner only reports `Migration running.`; once finished it reports `Migration already done.` and changes nothing.
- **Stopping and resuming.** `bunx convex run --component migrations lib:cancel '{"name": "migrations/<file>:<name>"}'` stops it after the current batch. Running the same `migrations/index:run` command again, without `reset`, resumes from the stored cursor. A migration that failed resumes the same way once the cause is fixed.
- **`"reset": true` starts over from the first document.** It skips the in-progress check, so only use it when `lib:getStatus` shows the migration is not `inProgress`, for example to run a finished migration again after an operator fixed data by hand. Every migration here is idempotent, so a rerun only touches what still needs it.

### Organization migrations

These bring existing data to the organization and billing model. Each one runs to `success` before the next (the chain below does that for you). The table lists them in the order they were designed; the command to run is in [Starting the chain](#starting-the-chain):

| Step | Command `fn` | Why it goes here |
|---|---|---|
| M1 | `migrations/organizations:orgOwnerRows` | Gives each org its owner row and the owner its engines. M2 relies on the owner being known so it never makes the owner an admin. |
| M2 | `migrations/organizations:orgMembershipFromEngines` | Puts every engine member in the engine's org; engine owners who do not own the org become org admins. |
| M4 | `migrations/invitations:invitationEngineTarget` | Points pending invitations at an engine. Only needs M1 and M2 to have settled who is in each org. |
| M6 | `migrations/subscriptions:exemptionsFromPlanAssignments` | Turns operator plan assignments (comps) into exemptions. Running it before M3 spares comped orgs a trial they would not keep. |
| M3 | `migrations/subscriptions:seedSubscriptions` | Starts a Starter trial, billed 30 days later, for every org with a managed engine and no subscription. |
| M5 | `migrations/organizations:checkOrgInvariantsAll` | Read-only report, run directly: `bunx convex run migrations/organizations:checkOrgInvariantsAll`. |

The end state does not depend on the order of M6 and M3: if M3 ran first, or a signup trial started in the window, M6 still moves a comped org's unpaid trial to its exemption. M1 and M2 also converge in either order. The chain below is still the one to use.

### Starting the chain

Start it as soon as the "Deploy Convex" job goes green, while the UI image is still building, and start with M6. Until a comped org has its exemption, an owner who starts a managed-engine build gets an ordinary signup trial instead of the comp. M6 now converts that trial too (any `trialing` row with no provider subscription, whatever its origin), so such an org still ends up exempt; a quick start only keeps the window short. M6 needs only the plan assignments. The other migrations do not depend on each other, so they follow it in the same chain (each starts when the previous one finishes):

```bash
bunx convex run migrations/index:run '{"fn":"migrations/subscriptions:exemptionsFromPlanAssignments","next":["migrations/organizations:orgOwnerRows","migrations/organizations:orgMembershipFromEngines","migrations/invitations:invitationEngineTarget","migrations/subscriptions:seedSubscriptions"]}'
```

M3 stays last in the chain so M6 spares comped orgs a trial they would not keep. M6 never touches an org with a provider subscription, or one that is active, past due, suspended or already exempt.

Then watch the last one (`migrations/subscriptions:seedSubscriptions`) with `lib:getStatus` until it reports `success`, and run M5 (`bunx convex run migrations/organizations:checkOrgInvariantsAll`). If one in the chain fails, the chain stops there: fix the cause and run the same command again; finished migrations are skipped.

M5 returns `total` and a list of `violations`, each with an `invariant`, the `accountId` and, where it applies, the `userId` or `instanceId`. `total` must be `0` before the old plan-assignment shapes are removed. `overSeatLimit` lists orgs with more members than their plan's seats; that is on purpose (M2 keeps everyone who already had access) and is not a violation: those orgs keep their members and only stop taking new ones. What each violation means and how to resolve it is in [Organization migration runbook](./org-migrations.md).
