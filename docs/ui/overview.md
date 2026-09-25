# Application shell and routing

The SPA is built with **React 18**, **Vite**, and **Wouter** for client-side routes. Global providers wrap the tree in this order (see `client/src/App.tsx`):

1. **Convex** — `ConvexProvider` + `ConvexReactClient` (`VITE_CONVEX_URL`)
2. **Auth** — `ConvexAuthProvider` (`@convex-dev/auth`)
3. **TanStack Query** — shared `queryClient` for non-Convex or legacy-style fetches
4. **UI** — tooltips, theme (`useTheme`), toasts

## Route layout

| Path | Guard | Purpose |
|------|--------|---------|
| `/auth/login`, `/auth/register` | None | Sign in / sign up |
| `/auth/onboarding` | `AuthGuard` | Create account + first instance |
| Everything under the main shell | `AuthGuard` → `OnboardingGuard` | Product UI inside `BroadcastShell` |

**AuthGuard** redirects unauthenticated users to `/auth/login`. **OnboardingGuard** loads `accounts.getMyAccount` and `instances.listForCurrentUser`; if there is no account or no instances, it sends the user to `/auth/onboarding`.

Protected routes render inside **`BroadcastShell`** (`client/src/components/layout/broadcast-shell.tsx`): primary nav, utility links (Team, Admin), instance switcher, command palette hook, and stream status UI (currently a placeholder that does not yet call the real transport).

## Navigation structure

The menu is declared in one place — `client/src/components/layout/nav-config.ts`. Sections with `children` own a URL prefix and render a left sidebar (`section-sidebar.tsx`) beside the page; sections without children are a single route. Every rail — the subnav and the per-page list sidebars (modules, widget catalog) — shares one width and surface through `SIDEBAR_RAIL` in `sidebar-rail.ts`, so the rail does not change size or color between pages. The subnav collapses to icons only via the button at its foot — the state lives in the `$sidebarCollapsed` Nanostore, so it persists per browser and is shared by every section.

| Section | Route prefix | Sub-items |
|---------|--------------|-----------|
| Dashboard | `/` | — |
| Stream | `/stream` | Alerts, Commands, Counters, Scenes, Timers, Queues, Assets, Workflows |
| Modules | `/modules` | — (the page renders its own category sidebar) |
| Help | `/help` | Learning, Logs, Submit Feedback |
| Admin | `/admin` | Engine, Integrations, Storage, Appearance |

Admin and Team are not in the primary nav — they are the icon buttons in the header's utility cluster (`UTILITY_SECTIONS`), but Admin renders the same section sidebar as Stream and Help.

`/stream`, `/help`, and `/admin` redirect to their first sub-item. Learning and Submit Feedback are placeholder screens — no engine surface backs them yet.

**Counters, Timers and Queues** are first-party pages for the resource kinds the bundled `woofx3` module provides. Each is a `components/resources/resource-kind-page.tsx` — instances in a rail, the chosen one at `<page>/<instance id>`, creation and settings from the kind's own schema — plus the kind's value display and controls. Every control runs the kind's own action through `hooks/use-resource-action.ts`, exactly what a workflow step or chat command would run, and the value shown is the engine's, mirrored into `resourceValues` from its storage-changed webhook. A timer is stored as the moment it ends while running, so the page counts it down itself; `lib/resource-values.ts` reads each kind's stored shape. A dashboard run reports no result back, so the Queues page checks a new entry against the queue's capacity and duplicate rule before sending it.

Below its controls, each page shows both directions of its wiring. **What changes it** (`components/resources/resource-action-editors.tsx`) lists every trigger, on any event, that runs one of the kind's actions against this instance — a chat command that adds to a counter, a raid that adds time to a timer. The actions are found by declaration, mirroring the triggers below: any action with a `resource_ref` parameter for the kind (`lib/resource-actions.ts`). It is one list across many events, so it borrows each event's `EventWorkflowEditor` without its heading and Save bar (`bare`) under an `actionScope` — the mirror of `scope` — which shows only the triggers running one of those actions on this instance, aims a new step at it, and hides the parameter that aims it, since on the instance's own page that picker could only offer it again. Adding one asks for the trigger and the action together, because a trigger with no step yet is not one the list would show. Saving writes each event's workflow in turn; a step added here is seeded with *no* other parameters, so Increment counter keeps honouring the counter's own `Counts by` rather than being pinned to 1.

Below that, each page offers the triggers the kind's events declare — Counter changed; Timer started, paused and ended; Added to queue and Next in queue — as the same `EventWorkflowEditor` the Alerts screen uses, with a `scope` that shows only the triggers pinned to this instance (`components/resources/resource-trigger-editors.tsx`). They are found by declaration, not listed per kind: any eventbus trigger with a `resource_ref` condition field for the kind appears (`lib/resource-triggers.ts`). Because each event is still one workflow with a condition per instance, what a page saves is what the Alerts screen and the workflow builder show. A timer that repeats is a Timer ended trigger whose steps do something and then start the timer again. The pre-restructure top-level paths (`/alerts`, `/commands`, `/assets`, `/scenes`, `/scenes/:id`, `/workflows`, `/workflows/:id`, `/settings/:tab`) redirect to their new homes.

**Editors are routes, not dialogs.** A dialog is awkward on a phone and has no back button, no shareable link and nowhere to put a second level of editing, so anything you work in gets its own path; modals are left for confirmations. Alerts puts one step's content at `/stream/alert-editor/:event/:triggerId/:actionId`, and one recorded run at `/stream/alert-run/:engineRunId` — both beside Alerts rather than under it, because everything below `/stream/alerts/` is read as a menu path. Chat commands nest theirs (list, command, a step's alert content, groups list, group) so the Commands menu entry stays active throughout; see [Chat commands](./commands.md) for the full set. Paths come from `lib/alert-editor-route.ts`, `lib/alert-run-route.ts` and `lib/command-editor-route.ts` — build them there, not by hand.

Edits that span more than one of those routes are held in a draft store outside the component tree — `lib/event-drafts.ts` for an event's triggers, `lib/command-drafts.ts` for one command — so leaving the page for a nested editor does not lose them, and the owning screen's Save covers everything done under it. A draft belongs to the event, not to the screen editing it: where two sections of a resource page touch the same event, either one's Save writes both their edits and either one's Discard drops both. That is what keeps them from overwriting each other.

**Alerts** (`/stream/alerts`) opens on a dashboard rather than an empty state: four counters (alerts, played, failed, success rate over the last 24 hours), an hour-by-hour activity chart, the recent dispatch feed, and a card that fires a test event — `components/alerts/dashboard/`. Counters and chart come from `engineAlerts.overview`; the feed from `engineAlerts.listForInstance`. Both read the engine's **alert** log, not its workflow runs: a run can succeed while the alert it published never reaches an overlay, and this screen is about the second. Each row replays through `alertActions.replay` (the engine re-publishes the stored envelope, marks the original `replayed`, and both changes arrive back as webhooks) and drills into the run that fired it at `/stream/alert-run/:engineRunId` (`lib/alert-run-route.ts`), which shows that one run as a trace — the trigger event, the run, each step and the overlay alerts it published on one time axis, with the selected span's fields and payloads (inputs, outputs, event data, alert parameters) pulled out below, and a replay — `components/alert-run/`, laid out by `lib/run-trace.ts` — and its back arrow returns to the dashboard. Choosing a kind of event on the left rail replaces the dashboard with that event's triggers.

There is no separate Debug page any more: `/debug` and `/help/debug` redirect to Alerts. Test events are fired from the dashboard's card or from the lightning icon beside each event, which opens a side sheet; both render the same `components/test-events/test-event-picker.tsx`. Its trigger picker (`trigger-picker.tsx`) is a searchable combobox over every alert trigger, grouped the way the rail is (platform, then each `alert.*` segment), with the clicked one preselected — a query matches the trigger's name, its menu path or its event type. Its settings sit below, above a Trigger button.

What those settings are is decided by the trigger, not by the UI: `components/test-events/registry.ts` gives a trigger that declares an `emits` shape a generated form (`shape-test-event-form.tsx`, built by `lib/test-event-fields.ts` — a labelled control per declared path, seeded from its `example`, from an `examplePayload` the trigger's config carries, or from the choices that config declares), and a trigger that declares nothing the raw JSON editor. There are deliberately no per-event forms. Either way, JSON is one toggle away for the payload a form cannot express. Twitch triggers fire through `debug.simulateTwitchEvent` so the engine stamps the platform; anything else is published as-is through `debug.fireTrigger`.

**Error boundaries** reset on `location` change so a bad screen does not brick the whole app.

## Instance scope

Most Convex-backed screens use **`useInstance()`** (`client/src/hooks/use-instance.ts`): it reads `instances.listForCurrentUser`, picks the Nanostore-selected `currentInstanceId` or falls back to the first instance, and exposes `instance`, `setInstance`, and loading state. Queries and mutations should pass `instanceId` when talking to Convex functions that proxy to the engine.

## Where data comes from (today)

The codebase is intentionally **hybrid**:

- **Convex** (`useQuery` / `useMutation` / `useAction`) — multi-tenant control-plane data: accounts, instances, workflows metadata, assets, module catalog, dashboard layout, engine health checks, etc. Engine-proxied reads (e.g. `moduleEngine.listEngineModules`, `workflowCatalog.fetchMerged`) are Convex **actions** that talk to the engine over capnweb on the server side.
- **`WoofxTransport`** (`client/src/lib/transport/`) — direct **browser ↔ engine** WebSocket (or future Tauri IPC) for **realtime** channels only (chat, stream status, workflow runs). Documented in-repo as *not* for Convex-proxied calls. Browsing / installing / uninstalling modules does **not** use the transport — those flows go browser → Convex mutation/action → engine.
- **`transientEvents`** (Convex realtime subscription) — the bridge the UI uses to observe async engine operations correlated via an operation-specific key. Any flow that RPCs the engine and later receives a webhook callback (module install, uninstall, future async operations) emits progress/success/error events to this table; components subscribe by `correlationKey` and get realtime pushes the moment the webhook handler writes.
- **TanStack Query** — used where code still follows older “API client” patterns: some dashboard modules, **Team**, **Scenes** list, **Scene editor**, and parts of **workflow creation** (`BasicWorkflowEditor` + `apiRequest`). Some of these `queryFn`s are **stubs** (empty arrays) until wired to Convex or the transport.

When you touch a screen, check imports: `from "convex/react"` vs `@/lib/transport` vs `@/lib/queryClient` tells you which path it uses.

## Related docs

- [Dashboard](./dashboard.md)
- [Chat commands](./commands.md)
- [Modules](./modules.md)
- [Workflows](./workflows.md)
- [Assets](./assets.md)
- [Scenes](./scenes.md)
- [Admin & team](./admin-team.md)
- [Auth & onboarding](./auth-onboarding.md)
- [Convex & HTTP surface](./convex-surface.md)
