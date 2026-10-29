# User pages

A user page is a streamer's public page, opened by viewers at `https://woofx3.tv/u/<slug>`, where the slug is the engine's name. It shows the page its owner published: a layout, an accent colour, a banner and avatar, and sections of widgets (text, counters, timers, live status, links, images and forms).

## A separate app

The page is not part of the dashboard. It is its own Vite entry, `client/src/user-page/`, built by `vite.user-page.config.ts`:

- **Base `/u/`.** The marketing site owns `woofx3.tv`, and its edge forwards only `woofx3.tv/u/*` to the dashboard's origin (`stream.woofx3.tv`), keeping the path. Everything the page loads therefore sits under `/u/`: its HTML, `/u/assets/*` for scripts, styles, the font and the favicon. The page has no `publicDir`, since the dashboard's public files are served from the root.
- **Output `dist/u`.** `bun run build` builds the dashboard into `dist`, then the page into `dist/u`, so one image serves both. `deploy/Caddyfile` answers every `/u/` path with `/u/index.html` and serves `/u/assets/*` as immutable files (see [Deploying](/ops/deploy)).
- **Not in the desktop app.** The desktop shell bundles the dashboard's own build, which never lists the page's HTML as an input, so the page cannot end up in it.
- **No dashboard sign-in.** It talks to Convex with a plain `ConvexReactClient`: no auth provider, no engine gateway, nothing scoped to an instance. A viewer can sign in with Twitch, but that gives them a viewer session of their own, which the page passes to its queries as an argument (see [Sections only some viewers see](#sections-only-some-viewers-see)).

### Import boundary

The page is downloaded by anyone, so the build refuses to bundle anything it does not need. `userPageBoundary` (`client/src/user-page/build/boundary.ts`) is a Vite plugin that checks every module Rollup bundled against `USER_PAGE_LOCAL_MODULES` (the page's own code, `shared/user-pages`, `client/src/lib/resource-values.ts` and the few Convex files they reach, among them `convex/lib/oauthHandoff.ts` for the sign-in nonce's format) and refuses packages that exist for signing in, the engine connection or the desktop app. A refused import fails `bun run build`, naming what imported it. It checks the bundled graph, so type-only imports, which ship nothing, are not counted.

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

The page then calls `viewerRoles.refresh({ sessionToken, slug })`. Its write re-runs `bySlug`, which opens or keeps locked each section on the new roles. When the row expires, the query re-runs again, the section locks, and the page refreshes once more. A viewer who keeps the page open therefore sees gated sections close briefly every ten minutes while the check runs.

How the page handles each refresh answer:

| Answer | Page |
| --- | --- |
| roles stored | Nothing more: the query re-runs. |
| `unavailable`, `rate_limited`, or no answer | Keeps "checking" and retries after 30 seconds, doubling up to 5 minutes, with jitter (`ROLE_REFRESH_RETRY` in `client/src/user-page/viewer/role-refresh.ts`). |
| `reauth_required` | Asks the viewer to sign in again. |
| `not_signed_in` | Forgets the session token. |
| `page_not_found`, `broadcaster_not_linked`, `platform_mismatch` | Stops; the section stays locked. |

### Signing in on the page

The flow is the one in [Viewer sign-in](/ui/viewer-sign-in#the-sign-in-flow); the page's side lives in `client/src/user-page/viewer/`:

- **Start.** "Sign in with Twitch" sits in the page's top-right corner. It stores a fresh nonce in `sessionStorage` and sends the browser to `<user-pages origin>/u/_/viewer-auth/twitch/start` with `return_to` set to the page's own URL. The origin is `VITE_USER_PAGES_BASE_URL`, `https://woofx3.tv` when unset, and must match Convex's `USER_PAGES_BASE_URL`. A sign-in can only return to that origin, so the page offers it only there. Opened anywhere else (the dashboard's host, a preview), locked sections link to the page on that origin instead.
- **Return.** Before rendering, `main.tsx` reads `viewer_code` or `viewer_auth_error` off the URL and removes them with `history.replaceState`. A code is exchanged with `viewerSession.exchangeHandoff` and the nonce, which is used once and then removed. The session token goes into `localStorage`, which the browser keeps per origin. A code with no nonce in this tab is refused without asking Convex.
- **Errors.** Each callback error (`access_denied`, `missing_params`, `token_exchange_failed`, `profile_fetch_failed`, `rate_limited`) and exchange refusal has its own message, shown above the sections until dismissed.
- **Signed in.** The corner shows the viewer's avatar and name from `viewerSession.me`, and "Sign out", which forgets the token and calls `viewerSession.signOut`. If `me` answers null, the session has ended and the token is forgotten.

Where browser storage is blocked, the page behaves as signed out.

## Safety

Owner content is held to the same rules Convex applies on save, checked again before it reaches the DOM: Markdown renders without any HTML it contains; links are http or https only and open with `rel="noopener noreferrer nofollow ugc"`; images, banners and avatars load over https only.

## Developing

```bash
bun run dev              # the dashboard; forwards /u/ to the page's dev server
bun run dev:user-page    # the page, on port 5174 (WOOFX3_USER_PAGE_PORT moves it)
```

With both running, open `/u/<slug>` on the dashboard's dev server.
