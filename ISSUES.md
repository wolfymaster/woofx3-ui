# Candidate Issues (unreviewed)

This is an unreviewed candidate backlog generated from a codebase scan on 2026-08-09.
Nothing here is a filed GitHub issue yet — review, trim, and edit before turning any
item into a real issue (e.g. via `gh issue create --title ... --body ...`).

Note: issues #1 "Workflow variable discovery: picker for trigger/action data refs",
#2 "Add Permissions Management", and #3 "Add Permissions to Chat Commands" are
already filed and open in this repo. Nothing below duplicates them.

## Dashboard widgets

### Recent Events widget only ever shows hardcoded mock data

- **Files:** `client/src/components/dashboard/widgets/recent-events.tsx:14-19,37`
- **Category:** bug
- **Size:** small
- **Description:** `useState<RecentEvent[]>(mockEvents)` is never replaced with a live subscription. Sibling widgets like `event-feed-module.tsx` already use `transport.subscribeStreamEvents` as a pattern to follow.

### Alert Queue widget is fully mocked

- **Files:** `client/src/components/dashboard/widgets/alert-queue.tsx:12-27`
- **Category:** bug
- **Size:** medium
- **Description:** Skip/Clear only mutate a local `mockAlerts` array. There's no real connection to the engine's alert queue, so Pause/Skip/Clear do nothing to actual stream alerts.

### Quick Actions widget buttons are all inert

- **Files:** `client/src/components/dashboard/widgets/quick-actions.tsx:6-59`
- **Category:** bug
- **Size:** medium
- **Description:** "Start/End Stream" and "Mute" just flip local React state (no API call). "Skip Alert"/"Test Alert" have no `onClick` at all.

### Macro Pad: chat-command and workflow-trigger macros are unimplemented

- **Files:** `client/src/components/dashboard/macro-pad-module.tsx:101-115`
- **Category:** bug
- **Size:** medium
- **Description:** Only the `http-request` macro type actually executes; the other two macro types just `console.log`.

### Chat module "settings" gear button has no handler

- **Files:** `client/src/components/dashboard/chat-module.tsx:99-101`
- **Category:** ux-bug
- **Size:** small
- **Description:** No settings panel exists behind the gear icon.

### Event Feed "Filter" button has no handler

- **Files:** `client/src/components/dashboard/event-feed-module.tsx:98-100`
- **Category:** ux-bug
- **Size:** small
- **Description:** Icon suggests filtering by event type but nothing is wired up.

## Workflow / Alerts

### Workflow builder undo/redo buttons are permanently disabled

- **Files:** `client/src/pages/workflow-builder.tsx:580-585`
- **Category:** enhancement
- **Size:** large
- **Description:** No history/undo stack exists at all for step edits, so an accidental delete/drag has no recovery path.

### Alert Log filters only search the most recent 200 alerts, with no pagination

- **Files:** `convex/alertLog.ts:6-44`
- **Category:** bug
- **Size:** medium
- **Description:** `take(200)` runs before the `alertType`/`user` filters are applied in-memory, so filtering/searching for anything outside the newest 200 rows silently returns nothing even though matches exist.

### Alert replay has no error feedback

- **Files:** `client/src/pages/alert-log.tsx:167-170`
- **Category:** bug
- **Size:** small
- **Description:** `handleReplay` isn't wrapped in try/catch; a failed replay mutation fails completely silently (no toast).

## Transport / desktop shell

### TauriTransport is a complete stub — every method throws

- **Files:** `client/src/lib/transport/tauri-transport.ts` (entire file)
- **Category:** enhancement
- **Size:** large
- **Description:** `connect`/`disconnect`/all subscriptions throw "not yet implemented." Given `src-tauri/` exists as a real target, the desktop app cannot function today. Worth confirming the desktop shell is still an active near-term target before investing here.

### BrowserTransport polling silently swallows all errors

- **Files:** `client/src/lib/transport/browser-transport.ts:93-158`
- **Category:** bug-ux
- **Size:** medium
- **Description:** Empty `catch {}` blocks in chat/events/workflow-run pollers mean that if the engine WS session drops, the UI shows stale data forever with no "disconnected" indicator or retry/backoff.

## Scenes / modules

### Orphaned OBS browser-source page + placeholder widget-asset endpoint

- **Files:** `client/src/pages/browser-source.tsx` (266 lines, not registered in any `App.tsx` route), `convex/http.ts:1161-1193`
- **Category:** tech-debt
- **Size:** medium
- **Description:** Overlay rendering has moved to engine-minted overlay tokens per `live-scene-preview.tsx`/`scene-canvas-editor.tsx`, but this dead page still points at an endpoint that literally returns placeholder text (`// TODO: Integrate with barkloader's storage system to fetch actual widget assets`). Either delete both as dead code or finish the integration if still needed.

### Malformed module manifest.json is silently swallowed during install

- **Files:** `client/src/pages/module-install.tsx:503-508`
- **Category:** bug
- **Size:** small
- **Description:** `try { manifest = JSON.parse(manifestContent); } catch {}` leaves `manifest = {}` on parse failure with no user-facing error, so a broken manifest quietly installs as "Unknown Module" v1.0.0 instead of failing the upload.

## Settings / auth / UX consistency

### "System" theme option is rendered but permanently disabled

- **Files:** `client/src/pages/settings.tsx:449-458`
- **Category:** enhancement
- **Size:** small
- **Description:** Dead affordance (`disabled` on the radio item, `opacity-50 cursor-not-allowed`) with no tracking of when it'll ship.

### No success notice after registration before redirect to login

- **Files:** `client/src/pages/auth/register.tsx:34-36`
- **Category:** ux
- **Size:** small
- **Description:** Explicit TODO in the code. User is bounced to `/auth/onboarding` with no confirmation their account was created.

### Asset upload failure uses native `alert()` instead of the app's toast system

- **Files:** `client/src/pages/assets.tsx:299`
- **Category:** ux-tech-debt
- **Size:** small
- **Description:** Inconsistent with every other error path in the app (toast is used elsewhere, e.g. `team.tsx`).

### Team "remove member" uses `window.confirm()` instead of the app's `AlertDialog`

- **Files:** `client/src/pages/team.tsx:458`
- **Category:** ux-tech-debt
- **Size:** small
- **Description:** Other destructive flows (e.g. instance deletion in `settings.tsx`) use the styled `AlertDialog`; this is an unbranded native browser confirm.

## Convex backend tech debt

### `twitchOAuthState` is hardcoded to a single OAuth platform

- **Files:** `convex/schema.ts:402-412`
- **Category:** tech-debt
- **Size:** medium
- **Description:** Explicit TODO to generalize when YouTube/Kick login-bridge is added, matching the pattern `platformLinks` already uses. Blocks adding a second login-bridge platform without a schema migration.

### Widespread `as any` casts bypass Convex's `v.id()` validators

- **Files:** `convex/browserSource.ts:13,24,53,54,152,171,189,190`, `convex/obsCommands.ts:10,29`, `client/src/pages/alert-log.tsx:169`, `convex/http.ts:1094-1095`
- **Category:** tech-debt
- **Size:** medium
- **Description:** Args are typed as loose strings and force-cast to `Id<...>` at call sites instead of declaring proper `v.id()` validators, losing compile-time and runtime safety.

### Auth user object typed as `any` in the shell chrome

- **Files:** `client/src/components/layout/broadcast-shell.tsx:167,311,322`
- **Category:** tech-debt
- **Size:** small
- **Description:** `(user as any)?.name/.image/.email` with no shared type for the authenticated user profile shape.

## Cross-cutting

### Icon-only buttons largely missing `aria-label`

- **Files:** ~57 `size="icon"` buttons across `client/src` (chat send/settings, event-feed filter/refresh, workflow-run refresh, macro edit/delete, scene canvas controls, etc.) vs. only 9 files using `aria-label` anywhere
- **Category:** ux-tech-debt
- **Size:** large
- **Description:** Screen-reader users can't tell what most icon buttons do. Good candidate for a scoped audit-and-fix pass per feature area rather than one giant PR.

### Leftover unconditional debug `console.log`s shipped to production code paths

- **Files:** `client/src/App.tsx:32` (logs the Convex URL on every load), `client/src/lib/transport/index.ts:16,19`, `client/src/lib/transport/browser-transport.ts:54` (logs connection URL)
- **Category:** tech-debt
- **Size:** small
- **Description:** Minor noise/info-leak, easy cleanup.
