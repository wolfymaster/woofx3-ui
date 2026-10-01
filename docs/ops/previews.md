# Pull request previews

Every pull request from a branch in this repository gets its own running copy of the UI, built from the branch, with its own Convex backend and optionally its own engine. `.github/workflows/preview.yml` runs it; nothing needs to be run by hand.

| What | Where |
|------|-------|
| UI | `https://pr-<n>-woofx3-ui.woofx3.com` |
| Convex | a Convex preview deployment named `pr-<n>` |
| Engine (optional) | `https://<release>.woofx3.com`, with dots made dashes: `v0.3.1` → `v0-3-1.woofx3.com` |

## What happens

On every push (and when the description changes):

1. **Convex**: `bunx convex deploy --preview-create pr-<n>` pushes the branch's functions and schema to the pull request's preview deployment, creating it on the first push. `SITE_URL` on that deployment is set to the preview's address, and `AUTH_TWITCH_REDIRECT_URI` to `<deployment site URL>/api/auth/twitch/callback`.
2. **Image**: the `Dockerfile` is built against that deployment's URLs and pushed as `ghcr.io/wolfymaster/woofx3-ui:pr-<n>-<sha7>`. The production deploy uses the bare commit SHA, so the two never share a tag.
3. **Maintenance API**: `scripts/preview-ui.sh up` asks the woofx3 maintenance API to create the preview, or to redeploy it to the new tag. The maintenance API places it as a service in the woofx3 project's **staging** environment on Railway, attaches `pr-<n>-woofx3-ui.woofx3.com` as a Railway custom domain, writes the CNAME and ownership TXT record Railway asks for into the `woofx3.com` zone on Cloudflare, and waits for Railway's certificate.
4. **Engine**: if the preview names an engine release, the maintenance API pairs it with the preview engine running that release, creating the engine in the same staging environment when there is none. The workflow then sets `PREVIEW_ENGINE_URL`, `PREVIEW_ENGINE_VERSION` and `PREVIEW_ENGINE_REGISTRATION_TOKEN` on the Convex preview deployment.
5. A sticky comment on the pull request says where the preview is, or where it failed.

When the pull request closes, merged or not, `scripts/preview-ui.sh down` removes the UI preview and its DNS records. The Convex preview deployment is left for Convex to clean up, which it does for preview deployments on its own.

## Choosing an engine

The engine release comes from, in order:

1. A line in the pull request description: `engine-version: v0.3.1` (backticks around the value are fine).
2. The `ENGINE_VERSION` variable of the `preview` GitHub environment.
3. Neither: the preview has no engine, and onboarding in it asks for an engine URL as usual.

`latest` means the release the maintenance API pins for customers. Any image tag the engine repository publishes works, including its own pull request builds (`pr-<n>-<sha7>`).

Engines are **shared by release**: every preview naming `v0.3.1` uses the one engine at `v0-3-1.woofx3.com`, which registers each preview as its own client. Changing the release in the description moves the preview to the other engine on the next run, and removing the line unpairs it.

An engine whose provisioning failed is retried the next time a preview asks for its release, so pushing again is how a failed engine is repaired.

An engine is removed when the last preview using it goes: when its pull request closes, or when it moves to another release. Label the pull request `keep-preview-engine` before closing it to keep the engine for later previews. Every preview and engine also expires 72 hours after its last push, so one whose pull request stalls does not run forever.

In a paired preview, onboarding fills in the engine's URL. Registering it presents the engine's registration token from the Convex deployment; the browser never sees the token.

## Secrets and variables

These live in the `preview` GitHub Environment (**Settings → Environments → preview**).

| Name | Kind | Purpose |
|------|------|---------|
| `CONVEX_PREVIEW_DEPLOY_KEY` | secret | Preview deploy key from the Convex dashboard (**Project settings → Preview deploy keys**) |
| `MAINTENANCE_API_KEY` | secret | Maintenance API key with `engines:read,previews:write` for owner type `github` (`bun run keys:create` in woofx3-maintenance) |
| `MAINTENANCE_API_URL` | variable | The production maintenance API |
| `PREVIEW_BASE_DOMAIN` | variable | `woofx3.com`; must match the maintenance API's `PREVIEW_BASE_DOMAIN` |
| `ENGINE_VERSION` | variable | Optional. The engine release previews get when their description names none |

Other Convex environment variables a preview needs (`AUTH_TWITCH_*`, JWT keys, storage configuration) come from the Convex project's default environment variables for preview deployments, set in the Convex dashboard.

The maintenance API needs its own configuration for previews, described in its `CLAUDE.md`: a Railway project token for the woofx3 project's staging environment (`RAILWAY_PREVIEW_TOKEN`), that environment registered as its preview pool, the Cloudflare zone of `woofx3.com` (`CLOUDFLARE_PREVIEW_ZONE_ID`, with DNS edit on the API token), and `UI_IMAGE_REPOSITORY`.

Railway and the maintenance API pull the image anonymously from GHCR, so the `woofx3-ui` package must be public.

## Limits

- Twitch redirects only to callback URLs registered on the Twitch application, and each preview's Convex deployment has its own (`https://<deployment>.convex.site/api/auth/twitch/callback`). Twitch sign-in and linking work in a preview only once that URL is added to the application; until then, sign in with a password.
- Pull requests from forks get no preview: GitHub gives their workflows no secrets.
