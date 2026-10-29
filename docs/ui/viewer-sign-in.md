# Viewer sign-in for user pages

**Backend:** `convex/viewerAuthHttp.ts` (routes), `convex/viewerLogin.ts`, `convex/viewerSession.ts`, `convex/viewerRoles.ts`, `convex/lib/viewerAuth.ts` (rules and lifetimes), `convex/lib/viewerSessionAuth.ts` (helpers for page functions), `convex/lib/viewerPlatforms.ts` (platform clients), `convex/lib/viewerRoleRefresh.ts`, `convex/lib/viewerTokenCipher.ts`, `convex/lib/viewerRateLimits.ts`, `convex/lib/viewerEdgeGate.ts`

A streamer's public user page can show sections and actions only to viewers who are signed in, follow the channel, or subscribe to it (optionally at a minimum tier). Viewers sign in with their own Twitch account. This page covers how that sign-in works and how a page finds out a viewer's roles.

## Viewers are not dashboard users

Streamers and their team sign in through Convex Auth (see [Auth and onboarding](/ui/auth-onboarding)). Viewers don't. They have their own `viewers` table and their own session tokens in `viewerSessions`. No dashboard check (`getAuthUserId`, `requireInstanceRole`) reads a viewer session, and no viewer helper reads Convex Auth. So a viewer session can never open the dashboard, and a dashboard session can't stand in for a viewer.

## The sign-in flow

A page can live on a custom domain, which can't share cookies with the Convex deployment, so sign-in is a redirect round trip that ends with the page holding a token for its own origin.

1. **Start.** The page creates a random nonce (43 base64url characters), keeps it for itself, and sends the browser to
   `GET https://woofx3.tv/u/_/viewer-auth/twitch/start?return_to=<absolute page URL>&nonce=<nonce>` (the public user-pages origin, not the Convex site).
   That path belongs to the Cloudflare edge Worker, not to a page: `_` can never be a page slug. The edge limits sign-in starts per client address, which Convex can't see, and forwards the request to the Convex route `GET /api/viewer-auth/twitch/start` with the same query and the shared edge secret in `X-Woofx3-Edge-Secret`. Over the limit, the edge sends the browser back to the page with `?viewer_auth_error=rate_limited`. See [Rate limits](#rate-limits).
   The Convex route first checks the edge secret (`convex/lib/viewerEdgeGate.ts`), in constant time: a start without it gets a plain 401, so the per-address limit can't be skipped by calling Convex directly. It then checks that the `return_to` origin is on the allowlist. Today the allowlist holds only the origin of `USER_PAGES_BASE_URL`. The route mints a signed OAuth state (`convex/lib/oauthState.ts`) and stores the login in `viewerLoginStates` under the SHA-256 of that state, together with the return origin, the clamped return path and the nonce's hash. It then redirects to Twitch, asking for `user:read:follows` and `user:read:subscriptions` only.
2. **Twitch.** The viewer approves (or declines) on Twitch's consent page.
3. **Callback.** Twitch redirects to `GET /api/viewer-auth/twitch/callback`. The route:
   - forwards the callback to the deployment that minted the state, when that is another deployment (pull request previews; see [Previews](/ops/previews));
   - deletes the login state on first use, so a replayed callback finds nothing, and refuses a state older than ten minutes;
   - checks the return origin against the allowlist again, since it can shrink while the viewer is on Twitch;
   - exchanges the code, reads the viewer's Twitch profile, upserts the `viewers` row, and stores the encrypted grant in `viewerPlatformTokens`;
   - stores a one-time handoff in `viewerHandoffs` under the SHA-256 of a random code, and redirects back to the page with `?viewer_code=<code>`.

   A declined consent or a failed exchange redirects back with `?viewer_auth_error=<code>` instead (`ViewerAuthErrorCode` in `convex/lib/viewerAuth.ts`). The page maps each code to its own text. A request with no usable state gets a plain 400, because there is nowhere safe to send it.
4. **Handoff.** The page calls `viewerSession.exchangeHandoff({ code, nonce })`. The handoff row is deleted on every attempt. It turns into a session only within five minutes and only with the nonce the sign-in started with. A callback link opened in another browser therefore signs nobody in. Failures come back as `handoff_invalid`, `handoff_expired`, `nonce_mismatch` or `rate_limited`.
5. **Session.** On success the page gets a session token valid for 30 days and stores it for its own origin. Only the token's SHA-256 is stored, in `viewerSessions`. The page passes the token to every page function. `viewerSession.signOut({ sessionToken })` deletes the session, and a scheduled job deletes it at expiry. So a session row exists only while the session is live, and queries need no clock to refuse an expired one.

`viewerSession.me({ sessionToken })` returns the signed-in viewer's display name and avatar, or null.

## Roles

A viewer's follower and subscriber status on a channel is checked with the viewer's own token, using `GET /helix/channels/followed` and `GET /helix/subscriptions/user`. Helix answers 404 when the viewer isn't subscribed, and the subscription `tier` values `1000`, `2000` and `3000` map to tiers 1, 2 and 3. No streamer token and no engine are involved, so checks work while the streamer's engine is offline.

- The channel comes from the instance's platform link: `broadcasterForInstance(ctx, instanceId)` reads `platformLinks.platformUserId`.
- Results are cached in `viewerRoles`, one row per viewer, platform and channel, with `checkedAt`. Page queries read the cache with `viewerRolesFor(ctx, viewerId, broadcasterPlatformUserId)` and judge freshness with `viewerRolesFresh` (`VIEWER_ROLES_TTL_MS`, ten minutes).
- When the cache is missing or stale, the page calls `viewerRoles.refresh({ sessionToken, instanceId })`. It answers from the cache while that's fresh. Otherwise it renews the viewer's access token if it's close to expiring, asks Helix, and stores the result.
- If Twitch can't answer, the refresh records the time in `viewerRoleOutages`. For `VIEWER_ROLES_UNAVAILABLE_TTL_MS` (60 seconds) afterwards, refreshes for that viewer and channel answer `unavailable` without calling Twitch. The next successful check deletes the row.
- If Twitch refuses the refresh token (the viewer revoked the app), the grant is marked failed and refreshes answer `reauth_required` until the viewer signs in again.

Page functions build on these helpers from `convex/lib/viewerSessionAuth.ts`: `viewerFromSession` (null for an anonymous visitor), `requireViewer` (throws when not signed in), `viewerRolesFor` and `broadcasterForInstance`.

Platform calls go through `ViewerPlatformClient` (`convex/lib/viewerPlatforms.ts`), looked up by platform id. Twitch is the only platform today. Another platform needs its own implementation and entry in `VIEWER_PLATFORMS`, with no changes at call sites.

## Rate limits

Sign-in starts are limited per client address at the edge (woofx3-maintenance `worker/src/viewer-sign-in.ts`, binding `VIEWER_SIGN_IN_LIMITER` in `worker/wrangler.toml`): 20 per minute per `CF-Connecting-IP`, counted per Cloudflare location and approximately. Many viewers can share one address, so the limit is generous.

Behind it, the Convex buckets in `convex/lib/viewerRateLimits.ts` are a deployment-wide ceiling:

| Bucket | Applies to | Limit |
|--------|------------|-------|
| `viewerLoginStart` | the start route, deployment-wide | 6000 per hour, burst 600 |
| `viewerHandoffExchange` | `exchangeHandoff`, deployment-wide | 6000 per hour, burst 600 |
| `viewerRolesRefresh` | `viewerRoles.refresh`, per viewer, only when Twitch is about to be called | 120 per hour, burst 20 |

## Secrets at rest

Viewer access and refresh tokens are encrypted with AES-256-GCM under `VIEWER_TOKEN_ENCRYPTION_KEY` before they're stored (`convex/lib/viewerTokenCipher.ts`). They live in `viewerPlatformTokens`, apart from the profile, so reading a profile never loads a token. Login states, handoff codes, nonces and session tokens are stored only as SHA-256 hashes.

## Configuration

Set these Convex environment variables on production, and, except `VIEWER_SIGN_IN_EDGE_SECRET` and `VIEWER_SIGN_IN_EDGE_SECRET_NEXT`, as defaults for preview deployments. Previews have no edge in front of them, so viewer sign-in can't start on a preview.

| Variable | Value |
|----------|-------|
| `VIEWER_TOKEN_ENCRYPTION_KEY` | 32 random bytes, base64url: `openssl rand -base64 32 \| tr '+/' '-_' \| tr -d '='`. Changing it makes every stored viewer grant unreadable, so viewers have to sign in again. |
| `VIEWER_SIGN_IN_EDGE_SECRET` | The secret the edge sends with every sign-in start, at least 43 characters: `openssl rand -base64 32 \| tr '+/' '-_' \| tr -d '='`. Set the same value as the edge Worker's secret of that name (`wrangler secret put VIEWER_SIGN_IN_EDGE_SECRET`). Without it the start route answers 500 to every request, so sign-in never runs without the per-address limit. |
| `VIEWER_SIGN_IN_EDGE_SECRET_NEXT` | Optional. A second accepted secret while the secret rotates: set the new value here, then on the edge, then move it to `VIEWER_SIGN_IN_EDGE_SECRET` and clear this one. |
| `USER_PAGES_BASE_URL` | The public origin of user pages, e.g. `https://woofx3.tv`. It must be `https` (or `http://localhost` for development). The start route fails without it. |

These existing variables are reused as they are: `AUTH_TWITCH_ID` and `AUTH_TWITCH_SECRET` (the same Twitch app streamers sign in with), `OAUTH_STATE_SECRET` and `OAUTH_CALLBACK_BASE_URL` (callback forwarding for previews).

Register this OAuth redirect URL on the Twitch app (Twitch developer console → the app → OAuth Redirect URLs):

```
https://<production>.convex.site/api/viewer-auth/twitch/callback
```

Previews need no redirect URL of their own: their callbacks go to production, which forwards them.
