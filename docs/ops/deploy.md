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
- Files under `/assets/` are content-hashed and cached for a year. A missing asset is a 404, not `index.html`.
- Everything else, including `index.html`, is served `no-cache`, so a new deploy is picked up on the next load.
- Caddy listens on `$PORT`, which Railway sets (8080 when unset).

`VITE_CONVEX_URL` and `VITE_CONVEX_SITE_URL` are inlined at build time, so an image is tied to one Convex deployment. The build fails if either is missing.

To build and run it locally, from the `woofx3-ui` checkout with the engine checked out next to it:

```bash
docker build \
  --build-context engine-api=../woofx3/shared/clients/typescript/api \
  --build-arg VITE_CONVEX_URL=https://<deployment>.convex.cloud \
  --build-arg VITE_CONVEX_SITE_URL=https://<deployment>.convex.site \
  -t woofx3-ui .
docker run --rm -p 8080:8080 woofx3-ui
```

The `engine-api` build context supplies the engine's shared type package (`@woofx3/api`). It lives outside this repository.

## Secrets and variables

Everything environment-specific lives in the `production` GitHub Environment (**Settings → Environments → production**). The workflow file holds no IDs or URLs.

| Name | Kind | Purpose |
|------|------|---------|
| `CONVEX_DEPLOY_KEY` | secret | Production deploy key from the Convex dashboard |
| `RAILWAY_TOKEN` | secret | Railway project token for the woofx3 project, production environment |
| `VITE_CONVEX_URL` | variable | Production Convex URL (`*.convex.cloud`), baked into the bundle |
| `VITE_CONVEX_SITE_URL` | variable | Production Convex HTTP actions URL (`*.convex.site`), baked into the bundle |
| `RAILWAY_ENVIRONMENT_ID` | variable | Railway production environment |
| `RAILWAY_SERVICE_ID` | variable | Railway UI service |

The deploy does not manage Convex environment variables (`AUTH_TWITCH_*`, `SITE_URL`, JWT keys, storage configuration). They are set on the production deployment in the Convex dashboard.

Railway pulls the image from GHCR. The `woofx3-ui` package must be public, or the Railway service needs registry credentials (a GitHub token with `read:packages`). The image holds only the public client bundle.

## Rolling back

- **UI**: in Railway, open the UI service's deployments and redeploy an earlier one. Each deployment is pinned to an image SHA, so this restores that exact build. The next merge to `master` deploys over it.
- **Convex**: there is no automatic rollback. Revert the change on `master` and merge; the revert deploys like any other commit. A schema change that existing documents cannot satisfy fails `convex deploy`, which also stops the UI job, so fix the data or the schema before retrying.

A UI rollback that predates a Convex change can call functions whose arguments have since changed. Roll back both together when a change touched both.
