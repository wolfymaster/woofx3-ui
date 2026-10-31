# User pages

A user page is a streamer's public page, opened by viewers at `https://woofx3.tv/u/<slug>`, where the slug is the engine's name. It shows the page its owner published: a layout, an accent colour, a banner and avatar, and sections of widgets (text, counters, timers, live status, links, images and forms).

## A separate app

The page is not part of the dashboard. It is its own Vite entry, `client/src/user-page/`, built by `vite.user-page.config.ts`:

- **Base `/u/`.** The marketing site owns `woofx3.tv`, and its edge forwards only `woofx3.tv/u/*` to the dashboard's origin (`stream.woofx3.tv`), keeping the path. Everything the page loads therefore sits under `/u/`: its HTML, `/u/assets/*` for scripts, styles, the font and the favicon. The page has no `publicDir`, since the dashboard's public files are served from the root.
- **Output `dist/u`.** `bun run build` builds the dashboard into `dist`, then the page into `dist/u`, so one image serves both. `deploy/Caddyfile` answers every `/u/` path with `/u/index.html` and serves `/u/assets/*` as immutable files (see [Deploying](/ops/deploy)).
- **Not in the desktop app.** The desktop shell bundles the dashboard's own build, which never lists the page's HTML as an input, so the page cannot end up in it.
- **No dashboard sign-in.** It talks to Convex with a plain `ConvexReactClient`: no auth provider, no engine gateway, nothing scoped to an instance. A viewer can sign in with Twitch, but that gives them a viewer session of their own, which the page passes to its queries as an argument (see [Sections only some viewers see](#sections-only-some-viewers-see)).

### Import boundary

The page is downloaded by anyone, so the build refuses to bundle anything it does not need. `userPageBoundary` (`client/src/user-page/build/boundary.ts`) is a Vite plugin that checks every module Rollup bundled against `USER_PAGE_LOCAL_MODULES` (the page's own code, `shared/user-pages`, `shared/resource-kinds.ts`, `client/src/lib/resource-values.ts` and the few Convex files they reach, among them `convex/lib/oauthHandoff.ts` for the sign-in nonce's format) and refuses packages that exist for signing in, the engine connection or the desktop app. A refused import fails `bun run build`, naming what imported it. It checks the bundled graph, so type-only imports, which ship nothing, are not counted.

### The dashboard and `/u/`

In production Caddy keeps the dashboard from ever being served at `/u/`. An in-app link to `/u/<slug>` that Wouter would otherwise route is caught by a `/u/*` route in `App.tsx`, which reloads so the server serves the page.

## What it reads

`api.userPagesPublic.bySlug({ slug, sessionToken? })` is a public query, so the page updates live as the owner republishes, a bound counter changes or the viewer's roles change. It answers one of:

| Lookup | Page shows |
| --- | --- |
| `page` | The published page, as this viewer may see it. |
| `unavailable` | The not-found page. |
| `unclaimed` | The not-found page, and, if `api.userPagesPublic.claimable({ slug })` says the name can still be taken, an invitation to sign up and claim it. |

`unavailable` and an unclaimable `unclaimed` read the same, so a visitor cannot tell an unpublished page from a name nobody has.

A running timer arrives as the moment it ends. The page counts it down in the browser, re-rendering as each second ticks over, and fetches nothing while it runs.

## Sections only some viewers see

Each section has a visibility: `public`, `signed_in`, `follower`, `subscriber` (any tier) or `tier` with a level (that tier or higher). `bySlug` decides every section against the viewer its `sessionToken` signs in, before it loads anything the section shows (`sectionAccess` in `convex/lib/sectionAccess.ts`):

| Visibility | Open for |
| --- | --- |
| `public` | Everyone. |
| `signed_in` | A viewer with a live session. |
| `follower` | A signed-in viewer whose cached roles on the page's channel say they follow it. |
| `subscriber` | The same, subscribed at any tier. |
| `tier` | The same, subscribed at that tier or higher. |

A missing, unknown or ended session token is an anonymous visitor. The page's channel comes from the instance's Twitch link; roles for a viewer on another platform, or on a page with no link, are never checked.

A section the viewer may not see comes back as `{ kind: "locked", region, requirement, reason }`, in its place among the open ones. It carries nothing else: no id, no title, no widget. Its bound values and live facts are not even read, so the projection rows they come from never reach the viewer. `reason` says what would open it:

| Reason | Meaning | The page shows |
| --- | --- | --- |
| `sign_in` | Nobody is signed in. | "Sign in with Twitch". |
| `roles_unknown` | Signed in, but no current role check for this channel. | "Checking your Twitch account…" while it refreshes them. |
| `not_eligible` | The current roles don't meet the requirement. | What to do on Twitch, such as follow or subscribe at a tier. |
| `unverifiable` | The channel can't be checked for this viewer. | That the section can't be unlocked here. |

### Freshness without a clock

A query can't read the time, and it can't call Twitch. Roles are cached in `viewerRoles` (see [Viewer sign-in](/ui/viewer-sign-in#roles)), and a row exists only while it's fresh: storing a check schedules the row's deletion `VIEWER_ROLES_TTL_MS` (ten minutes) later. So `bySlug` treats any row it finds as current, and treats no row as `roles_unknown`. When any section is locked for `roles_unknown`, the page result has `rolesStale: true`.

The page then calls `viewerRoles.refresh({ sessionToken, slug })`. Its write re-runs `bySlug`, which opens or keeps locked each section on the new roles.

So that a viewer who keeps the page open never sees an open section lock while their roles are re-checked, the page renews roles before they expire. On a page with a section gated on roles, a viewer with current roles gets `rolesRenewAt`: their check time plus the TTL, less `VIEWER_ROLES_RENEW_LEAD_MS` (two minutes, so at four fifths of the TTL). At that moment the page calls `viewerRoles.refresh`. From that point, refresh asks Twitch instead of answering from the cache. The new check replaces the row and moves `checkedAt` on, so the old row's scheduled deletion finds a newer check and does nothing. If the renewal can't reach Twitch, the page retries as below. If no retry lands before the row expires, the row is deleted and its sections lock: an outage never keeps a section open on expired roles.

How the page handles each refresh answer:

| Answer | Page |
| --- | --- |
| roles stored | Nothing more: the query re-runs, with a later `rolesRenewAt`. |
| `unavailable`, `rate_limited`, or no answer | Keeps "checking" and retries after 30 seconds, doubling up to 5 minutes, with jitter (`ROLE_REFRESH_RETRY` in `client/src/user-page/viewer/role-refresh.ts`). |
| `reauth_required` | Asks the viewer to sign in again. |
| `not_signed_in` | Forgets the session token. |
| `page_not_found`, `broadcaster_not_linked`, `platform_mismatch` | Stops; the section stays locked. |

### Signing in on the page

The flow is the one in [Viewer sign-in](/ui/viewer-sign-in#the-sign-in-flow); the page's side lives in `client/src/user-page/viewer/`:

- **Start.** "Sign in with Twitch" sits in the page's top-right corner. It stores a fresh nonce in `sessionStorage` and sends the browser to `<user-pages origin>/u/_/viewer-auth/twitch/start` with `return_to` set to the page's own URL. The origin is `VITE_USER_PAGES_BASE_URL`, `https://woofx3.tv` when unset, and must match Convex's `USER_PAGES_BASE_URL`. A sign-in can only return to that origin, so the page offers it only there. Opened anywhere else (the dashboard's host, a preview), locked sections link to the page on that origin instead.
- **Return.** Before rendering, `main.tsx` reads `viewer_code` or `viewer_auth_error` off the URL and removes them with `history.replaceState`. A code is exchanged with `viewerSession.exchangeHandoff` and the nonce, which is used once and then removed. The session token goes into `localStorage`, which the browser keeps per origin. A code with no nonce in this tab is refused without asking Convex.
- **Errors.** Each callback error (`access_denied`, `missing_params`, `token_exchange_failed`, `profile_fetch_failed`, `rate_limited`) and exchange refusal has its own message, shown above the sections until dismissed.
- **Reloading.** Signing in changes `bySlug`'s arguments. The page keeps the anonymous answer on screen until the signed-in one arrives (`useLookupWhileLoading`), so it doesn't drop back to its loading skeleton. It never keeps an answer for another slug, nor one read for a session that has since ended or changed hands.
- **Signed in.** The corner shows the viewer's avatar and name from `viewerSession.me`, and "Sign out", which forgets the token and calls `viewerSession.signOut`. If `me` answers null, the session has ended and the token is forgotten.

Where browser storage is blocked, the page behaves as signed out.

## Forms

A visitor's answers go through the edge to Convex, wait in an outbox and reach the engine from there. A submit never calls the engine, so forms keep working while it is offline.

```
page → POST woofx3.tv/u/_/forms/submit (edge: per-address limit)
     → POST <site>/api/user-page-forms/submit (Convex: edge secret, checks, outbox)
     → deliverUserPageSubmission on the engine (capability userPages.formSubmissions)
```

### Submitting

`convex/userPageFormsHttp.ts` answers `200 { "ok": true }` or `{ "error": { "code", "message" } }`. Success means queued, so the page says the answer was sent and nothing about the streamer having seen it.

| Code | Status | Meaning | The page |
|------|--------|---------|----------|
| `unauthorized`, `invalid_request` | 401, 400 | Not from the edge, or an unreadable body | Asks to try again |
| `not_configured` | 503 | This deployment has no edge secret | Shows the form as closed |
| `too_large` | 413 | Over 64 KiB, which the longest answers a form allows can exceed | Asks to shorten |
| `page_unavailable`, `form_stale` | 404, 409 | The page is gone, or the form's id or questions changed | Asks to reload |
| `section_locked` | 403 | The form's section isn't open to this viewer | Says so, offers a reload |
| `session_expired` | 401 | A session token that signs nobody in | Offers sign-in |
| `invalid_answers` | 422 | The answers break the form's rules | Asks for another look |
| `not_accepting` | 503 | The page's queue is full | Shows the form as closed |
| `verification_unconfigured` | 503 | Anonymous, and Convex has no Turnstile secret | Shows the form as closed |
| `verification_failed`, `verification_unavailable` | 403, 503 | Turnstile refused, or couldn't be asked | Asks to try again with a fresh check |
| `rate_limited` | 429 | Too many from this viewer (`viewerFormSubmit`) or address (the edge) | Asks to wait |

`evaluateSubmission` (`convex/lib/userPageFormSubmit.ts`) makes every decision against the published page. The route runs it as a query, so a doomed submit spends no Turnstile token, and `acceptSubmission` runs it again in the transaction that writes the row. Answers are checked with `checkFormAnswers` in `shared/user-pages/forms.ts`, the same rules the page applies before sending. A submit carries one entry per question, so a different set of ids means the form changed.

The page mints an idempotency key and keeps it until an answer changes, so resending after a lost response can't queue twice. A repeat of an accepted key answers `ok` before any other check, without a second row or Turnstile call. The viewer's identity and roles come only from the session, and the labels and viewer are copied onto the row, so a later edit doesn't change what is delivered.

`toPublicWidget` gives each form `accepting`. It is false while the queue is full (`userPages.formsAtCapacity`, written only when it flips, so visitors' queries don't re-run on every queue change) and, for anonymous viewers, while Convex has no Turnstile secret. Off the user-pages origin the page has no route to post to, so a form links to the page there instead.

### Delivering

`pageSubmissions` holds each answer as `pending`, `delivered` or `failed`. `pageSubmissionQueues` holds, per instance, the pending count the cap checks (`USER_PAGE_LIMITS.pendingSubmissionsPerPage`) and when the engine is next worth contacting. Tunables are in `SUBMISSION_DELIVERY` (`convex/lib/userPageSubmissions.ts`).

A pass (`convex/lib/userPageFormDelivery.ts`) is scheduled on insert and by a one-minute sweep. It takes the queue's lease, asks the engine whether it has the capability, sends the oldest due rows and saves each outcome as it arrives.

| What happened | Row | Queue |
|---------------|-----|-------|
| A receipt, `recorded` or `duplicate` | `delivered` | |
| The engine refused it as malformed (`UserPageSubmissionRefused: …`) | `failed`, with the reason | |
| Any other error from the call | Pending, backs off alone | |
| A timeout or failed connection during a send | Pending, backs off | Engine backs off, pass stops |
| The capability check fails or lacks the id, or the instance has no engine credentials | Untouched | Engine backs off |

Backing off the engine on the queue row means an offline engine costs one probe per interval, however many answers wait. Pending rows never expire. Delivered rows are deleted after 30 days; failed ones stay until the streamer retries them or the instance is deleted. Only managed engines have pages today, and every route to the engine is behind `SubmissionTransport`.

### Setup

| Where | Name | Value |
|-------|------|-------|
| Cloudflare | Turnstile widget | Create one for the user-pages host name, managed mode |
| Convex | `TURNSTILE_SECRET_KEY` | The widget's secret. Read when used: without it, anonymous submits are refused and forms show as closed to anonymous visitors. Signed-in viewers aren't affected |
| GitHub `production` environment | `VITE_TURNSTILE_SITE_KEY` | The widget's site key, baked into the page at build time. Without it the page closes forms to anonymous visitors |
| Edge Worker + Convex | `VIEWER_SIGN_IN_EDGE_SECRET` | Already set for [viewer sign-in](./viewer-sign-in.md#configuration), and shared with this route, rotation included |

Previews have no edge in front of them and are not on the user-pages origin, so a form on a preview can't be sent. The page sets no Content-Security-Policy today; one added later must allow `https://challenges.cloudflare.com` for scripts and frames.

## Safety

Owner content is held to the same rules Convex applies on save, checked again before it reaches the DOM: Markdown renders without any HTML it contains; links are http or https only and open with `rel="noopener noreferrer nofollow ugc"`; images, banners and avatars load over https only.

## Developing

```bash
bun run dev              # the dashboard; forwards /u/ to the page's dev server
bun run dev:user-page    # the page, on port 5174 (WOOFX3_USER_PAGE_PORT moves it)
```

With both running, open `/u/<slug>` on the dashboard's dev server.
