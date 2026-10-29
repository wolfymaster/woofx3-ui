# User pages

A user page is a streamer's public page, opened by viewers at `https://woofx3.tv/u/<slug>`, where the slug is the engine's name. It shows the page its owner published: a layout, an accent colour, a banner and avatar, and sections of widgets (text, counters, timers, live status, links, images and forms).

## A separate app

The page is not part of the dashboard. It is its own Vite entry, `client/src/user-page/`, built by `vite.user-page.config.ts`:

- **Base `/u/`.** The marketing site owns `woofx3.tv`, and its edge forwards only `woofx3.tv/u/*` to the dashboard's origin (`stream.woofx3.tv`), keeping the path. Everything the page loads therefore sits under `/u/`: its HTML, `/u/assets/*` for scripts, styles, the font and the favicon. The page has no `publicDir`, since the dashboard's public files are served from the root.
- **Output `dist/u`.** `bun run build` builds the dashboard into `dist`, then the page into `dist/u`, so one image serves both. `deploy/Caddyfile` answers every `/u/` path with `/u/index.html` and serves `/u/assets/*` as immutable files (see [Deploying](/ops/deploy)).
- **Not in the desktop app.** The desktop shell bundles the dashboard's own build, which never lists the page's HTML as an input, so the page cannot end up in it.
- **Anonymous.** It talks to Convex with a plain `ConvexReactClient`: no auth provider, no engine gateway, nothing scoped to an instance.

### Import boundary

The page is downloaded by anyone, so the build refuses to bundle anything it does not need. `userPageBoundary` (`client/src/user-page/build/boundary.ts`) is a Vite plugin that checks every module Rollup bundled against `USER_PAGE_LOCAL_MODULES` (the page's own code, `shared/user-pages`, `client/src/lib/resource-values.ts` and the few Convex files they reach) and refuses packages that exist for signing in, the engine connection or the desktop app. A refused import fails `bun run build`, naming what imported it. It checks the bundled graph, so type-only imports, which ship nothing, are not counted.

### The dashboard and `/u/`

In production Caddy keeps the dashboard from ever being served at `/u/`. An in-app link to `/u/<slug>` that Wouter would otherwise route is caught by a `/u/*` route in `App.tsx`, which reloads so the server serves the page.

## What it reads

`api.userPagesPublic.bySlug({ slug })` is a public query, so the page updates live as the owner republishes or a bound counter changes. It answers one of:

| Lookup | Page shows |
| --- | --- |
| `page` | The published page. |
| `unavailable` | The not-found page. |
| `unclaimed` | The not-found page, and, if `api.userPagesPublic.claimable({ slug })` says the name can still be taken, an invitation to sign up and claim it. |

`unavailable` and an unclaimable `unclaimed` read the same, so a visitor cannot tell an unpublished page from a name nobody has.

A running timer arrives as the moment it ends. The page counts it down in the browser, re-rendering as each second ticks over, and fetches nothing while it runs.

## Safety

Owner content is held to the same rules Convex applies on save, checked again before it reaches the DOM: Markdown renders without any HTML it contains; links are http or https only and open with `rel="noopener noreferrer nofollow ugc"`; images, banners and avatars load over https only.

## Developing

```bash
bun run dev              # the dashboard; forwards /u/ to the page's dev server
bun run dev:user-page    # the page, on port 5174 (WOOFX3_USER_PAGE_PORT moves it)
```

With both running, open `/u/<slug>` on the dashboard's dev server.
