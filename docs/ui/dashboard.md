# Dashboard

**Route:** `/`  
**Primary files:** `client/src/pages/dashboard.tsx`, widgets under `client/src/components/dashboard/`

## Purpose

A **configurable workspace** of resizable panels. Users add, remove, resize, and
configure dashboard widgets. Layout is persisted per user per instance via Convex
(`dashboardLayouts`).

## Behavior

- **Widget registry** (`client/src/lib/dashboard-widgets/registry.ts`) is an explicit
  hand-written list mapping a stable `type` key to a React component, grouped into
  `stream` / `automation` / `utility` categories. Unknown types render an "Unknown
  widget type" fallback rather than crashing, so renaming a `type` orphans existing
  placements.
- **Layout** is chosen per panel from `client/src/lib/dashboard-layouts.ts`. Zone ids
  are positional (`${rowIndex}-${columnIndex}`); a zone can hold several stacked,
  resizable widgets, each identified by `slotId`.
- **Persistence** has two paths. Placement edits (add, remove, resize) are held in
  local draft state while edit mode is on and written by `setPanelWidgets` on Save,
  so Cancel needs no server round-trip. A widget changing **its own config** outside
  edit mode writes through immediately — otherwise the change would be dropped.
  Note this covers a widget's *settings*, which are per user along with the layout
  row they live in. Content that belongs to the channel rather than the viewer —
  macros, the command bar's counters, the shoutout queue — lives in its own
  instance-scoped table instead.

## Widgets

| Type | Category | Notes |
|------|----------|-------|
| `stream-status` | stream | Live/offline, viewers, uptime |
| `live-events` | stream | Follows/subs/cheers/raids, pushed from the engine |
| `activity` | stream | Tabbed events and highlights |
| `stream-preview` | stream | Thumbnail, click to enlarge |
| `announcement` | stream | Send a coloured announcement to chat |
| `pinned` | stream | Twitch pinned message, plus re-pinnable history — see below |
| `shoutout` | stream | Autocomplete from chat, confirm, queue — see below |
| `queue` | stream | One queue's line, with manual add and remove — see below |
| `timer` | stream | One timer's countdown, with start, pause and add time — see below |
| `workflow-runs` | automation | Recent and in-progress executions |
| `macro-pad` | automation | One-click buttons — see below |
| `stream-stats` | utility | Viewers, uptime, category |
| `recent-streams` | utility | Totals for the last finished sessions, from `streamSessionSummaries` — see below |
| `notes` | utility | Per-stream scratch pad |

## Recent streams

`recent-streams` lists the instance's last ten finished sessions from
`streamSessionSummaries` (`convex/streamSessionSummaries.ts`), newest first.
Each row is one engine session: the time actually live (its segments added up,
so the gaps a session spans across brief dropouts are left out), peak and
average viewers, and the session's follows, subs, gifted subs, bits and raids.

Rows arrive by the engine's `session.summary` webhook, which fires when a
session *ends*. A session ends when the next broadcast past the engine's grace
window begins, not when its own stream goes offline, so the stream that just
finished appears once the next one starts, and the one in progress never
appears here. A session that was never live is a real row with every figure at
zero and no viewer figures. Each delivery is a whole snapshot; the table keeps
one row per `(instanceId, sessionId)` and replaces it only with a snapshot whose
`generatedAt` is newer, so redeliveries and re-summaries are harmless. A
snapshot with a `schemaVersion` this deployment does not know is kept as raw
JSON and shown as unreadable rather than guessed at.

## Command bar

The strip above the panels (`client/src/components/dashboard/command-bar.tsx`):
stream preview, live pill, counter cards, Clip. It is not a widget and is not in
the layout — it spans the whole dashboard and is hidden per browser through the
`$commandBarHidden` nanostore.

The counter cards are a **projection of counter resources**, not a store of their
own. A card reads its number from the `resourceValues` mirror and its name and
goals from the counter's `moduleResourceInstances` row, through the same
`counterValue` / `counterGoals` / `goalProgress` helpers in
`client/src/lib/resource-values.ts` that the Counters page uses — so a card can
never disagree with the counter's own page, and changing a goal is done in one
place. `dashboardCounters` (`convex/dashboardCounters.ts`) holds only which
counters are on the bar and in what order; a row whose counter has since been
deleted resolves to nothing and is skipped.

A card shows `{value} / {goal}` for the goal being worked toward — the smallest
above the current value — and just the number once every goal is passed, or when
the counter has none. Clicking any card flips **all** of them to `{remaining} to
go`; the display mode is one piece of component state, not a per-card setting.
Values arrive by webhook while the dashboard is open, and the bar calls
`refreshResourceValues` once on mount to cover anything written before it was.

## Queue widget

Shows one queue resource (`client/src/components/dashboard/widgets/queue.tsx`)
and lets you add an entry, remove any entry, and take the next one.

All three go through the queue's **own engine actions** via `useResourceAction`
— `queue.add`, `queue.remove`, `queue.next` — never a write to the mirrored
`resourceValues` row. A change made in the widget is therefore the same change a
chat command or a workflow would make, and it returns through the engine's
change event rather than being guessed at locally. Whether an add would be
refused (duplicate, full) is worked out before sending with `queueAddRefusal`,
since a dashboard action run reports no result back.

Which queue it shows lives in the widget's own config as `canonicalId`, so two
placements can watch different queues. An unset config, or one naming a queue
since deleted, falls back to the first queue by name — the widget is useful the
moment it is placed, and choosing from the header dropdown is what writes the
config. With only one queue the dropdown is replaced by a link to its page.

## Timer widget

Shows one timer resource (`client/src/components/dashboard/widgets/timer.tsx`)
with the same controls as the Timers page: start or pause, reset, quick-adjust
(`timer.add`) and set to a time (`timer.set`). It follows the Queue widget's
shape — the same config (`canonicalId`), fallback to the first timer by name,
header link or dropdown, and every control through `useResourceAction`.

A running timer is stored as `{ running: true, endsAt }` and is not rewritten
while it counts down, so the time left is computed in the browser.
`useTimerState` (`client/src/hooks/use-timer-state.ts`) does that for both the
widget and the Timers page, ticking every 250 ms only while the timer runs, so
the two cannot drift apart. A timer that has run out but not yet been stopped by
the engine reads as Finished.

## Macro pad

Square buttons that fire a chat command, a workflow, or an HTTP request. Its own
edit mode (distinct from the dashboard's) enables drag-to-reorder via dnd-kit plus
per-button edit and delete.

**There is one macro pad per instance, and it is shared.** The buttons and their
order both live in the `macros` table (`convex/macros.ts`), not in the widget's
config — the same reasoning as `dashboardCounters`: a dashboard layout is a personal
workspace preference, but the macro pad is the channel's, so everyone sharing the
account sees the same buttons in the same order. Placing the widget on two panels
shows the same pad in both.

One row per macro, not an array on a parent document: add, edit and delete each
touch a single document, and a reorder writes `sortOrder` only on the rows that
moved, so two people editing the pad cannot clobber each other. Reorder is applied
through a Convex optimistic update so a dragged tile does not spring back while
the round-trip completes.

Each button carries an optional Lucide **icon** and **color**. Color is stored as
six-digit hex (`#rrggbb`) — chosen from preset swatches or the native picker — and
tints the tile's border, icon, and a faint `${hex}20` background wash, the same
treatment the module detail panel gives catalog colors. The label keeps the theme
foreground so any choice stays readable.

Buttons support **variables**: any <code v-pre>{{name}}</code> written into the command,
URL, body, or a header value is collected from the user in a prompt before the macro runs.
The <code v-pre>{{…}}</code> delimiter is deliberately distinct from the workflow engine's `${…}`
and the shared TS resolver's `{…}` (see `convex/lib/macroVariables.ts` for why) —
variable names are restricted to `[A-Za-z0-9_]`.

`chat-command` and `trigger-workflow` macros run in Convex through `macros.run`,
the same `planMacroRun` / `executeMacroPlan` path a remote trigger uses
(`convex/lib/macroTrigger.ts`, `convex/lib/macroExecution.ts`). A workflow macro
calls the engine's `triggerWorkflowByName`; a chat-command macro must be a
`!command` and calls the engine's `executeCommand` as the linked Twitch
broadcaster, exactly as if they had typed it — the engine cannot post a plain chat
message. `http-request` fetches straight from the browser, so it is subject to
CORS and its headers are visible to anyone with dashboard access.

### Trigger macros from a Stream Deck or phone

Any `chat-command` or `trigger-workflow` macro can get a **remote trigger**: a
secret URL that presses the button with a single HTTP request, so an Elgato
Stream Deck, Bitfocus Companion, Touch Portal, or a phone shortcut can drive the
show without the dashboard open.

**Turning it on**

1. On the dashboard, open the macro pad's edit mode and click the pencil on the
   macro.
2. Switch on **Remote trigger**. Only an owner or admin of the instance can do this.
3. Copy the URL, or one of the ready-made examples, right away. **It is shown once**:
   woofx3 keeps only a SHA-256 hash of it, so if you lose it, click **Rotate** to get
   a new one (the old URL stops working at the same moment).
4. Switch Remote trigger off to revoke the URL. Deleting the macro revokes it too.

A tile with a remote trigger shows a small radio icon; hover it for when the URL
was last used and how many times.

**Calling it**

- `POST https://<your-convex-site>/api/macros/trigger/<token>` fires the macro.
  The answer is `202 {"ok":true}` (plus a `triggerId` for a workflow run).
- If the macro has <code v-pre>{{variables}}</code>, send them as a JSON body
  (`{"channel":"bob"}`), a form body, or query parameters. A request missing one
  gets `400` naming the missing variables.
- GET is refused (`405`) unless you switch on **Also accept GET** for that macro.
  Only do that for a device that can do nothing else: chat apps and browsers fetch
  pasted links to build previews, so a GET URL can fire by accident.
- Each URL accepts one press a second, with bursts of up to five; beyond that it
  answers `429` with a `Retry-After` header.
- An unknown or revoked URL answers `404`.

Treat the URL like a password: anyone who has it can press that one button (and
nothing else). Rotate it if it shows up on stream or in a screenshot.

**Elgato Stream Deck**

The built-in *Website* action can only send GET, so use a free plugin that can POST:

1. Install **API Ninja** (BarRaider) or **Web Requests** from the Stream Deck store.
2. Drag its action onto a key.
3. Set the method to **POST** and paste the trigger URL.
4. If the macro has variables, set the content type to `application/json` and the
   body to a JSON object, e.g. `{"channel":"bob"}`.

If you did switch on *Also accept GET*, the built-in *Website* action works too:
paste the URL (variables go in the query string, `?channel=bob`) and tick
**GET request in background** so no browser window opens.

**Bitfocus Companion**

1. Add a connection of type **Generic: HTTP Requests**.
2. On a button, add the connection's **POST** action.
3. Paste the trigger URL. For variables, set the body to a JSON object and add the
   header `Content-Type: application/json`.

**iOS Shortcuts**

1. Create a shortcut with the **Get Contents of URL** action and paste the trigger URL.
2. Expand the action, set **Method** to **POST**.
3. For variables, set **Request Body** to **JSON** and add one text field per
   variable (an *Ask for Input* action before it lets the shortcut prompt you).
4. Add the shortcut to the home screen, or run it from Siri or the Action button.

**Why HTTP-request macros cannot have one.** They run from the viewer's browser,
where a target on the local network (OBS, a light controller) is reachable. Run
from Convex they would reach a different network and turn Convex into a proxy for
any URL with the macro's headers attached. Point the device at that URL directly.

**How it works.** `convex/http.ts` routes `/api/macros/trigger/` to one handler.
It reads at most 8 KB of body, hashes the token and calls
`macroTriggers.claim`, a single mutation that looks the hash up in the
`macroTriggers` table, checks the method, spends a rate-limit token, validates
the variables and stamps `lastUsedAt` / `useCount`. The handler then calls the
engine with provenance `macro-trigger`, so these runs appear in the run history
(dashboard presses, provenance `dashboard`, do not). The decision logic is pure and
tested in `convex/lib/macroTrigger.test.ts`.

## Pinned

Twitch keeps **exactly one pinned message per channel**, and pinning a new one
silently replaces it — so the widget shows a single current pin, not a list. The
list underneath is *history*: things worth pinning again, kept because the same
message tends to recur stream after stream.

Pinning targets an existing chat message by id (`PUT /helix/chat/pins`), so a
"custom" pinned message is really Send Chat Message with its `pin` flag — which
means **it posts a visible chat message** from the connected account. Twitch pins
messages; there is no free-floating pinned text.

Reading the current pin (`GET /helix/chat/pins`) returns only ids and timing —
no message text, no author. So the widget can quote a pin only when its id
matches one we recorded; a pin made from Twitch's own UI shows as "pinned
outside this app". Nothing here receives chat, so there is no other way to learn
what it says. There is also no EventSub type for pinning, which is why the
current pin is polled rather than pushed.

Re-pinning has two paths, chosen by `convex/lib/pinStrategy.ts`: reuse the
stored message id when the entry was created during the current broadcast,
otherwise re-post the text and pin the new message, since a message id stops
being pinnable once its stream ends. A refusal falls back to re-posting anyway —
the rule exists to keep that fallback rare, not to replace it. History rows
predating this feature were hand-written Activity-panel notes; they carry no
message id and so always take the re-post path.

Pinning needs `moderator:manage:chat_messages`. Reading needs only
`moderator:read:chat_messages`, which existing links already carry — so the
current pin is visible before reconnecting, while the controls are disabled with
an inline hint. These endpoints have been in open beta since 2026-05-15.

## Shoutout

Queues Twitch shoutouts and sends them one at a time within the endpoint's
cooldown.

The autocomplete lists **who is currently in chat**. Nothing in woofx3 tracks
chat presence — the only signal anywhere is the per-message chat event, and no
service accumulates it — so the roster comes from Twitch's
`GET /helix/chat/chatters` (`convex/shoutouts.ts`), cached per instance with
in-flight dedupe in `hooks/use-chatters.ts` and ranked locally on each keystroke
by `lib/chatter-match.ts`. That needs `moderator:read:chatters`, which is already
in `TWITCH_INTEGRATION_SCOPES`; a link created before that scope was added keeps
working for everything else, so `authorizeTwitch` turns the gap into a "reconnect
Twitch" message rather than a silent 401.

Picking from the list, or pressing Send with a typed name, looks the channel up
and shows a confirmation card — avatar, display name, partner/affiliate — before
anything is queued, so a mistyped name is caught by a face. You can shout out
someone who is not currently in chat; the list is a convenience, not a filter.

The queue is instance-scoped (`shoutoutQueue`), one row per entry, so reordering
rewrites `sortOrder` only on the rows that moved and removal is a single delete —
the queue is edited by hand while a scheduled processor writes to it. A processor
run (`processQueue`) sends at most one shoutout and reschedules itself: the
cooldown is minutes, and an action holding a timer open that long is neither
reliable nor cheap, so the scheduler is the timer. `shoutoutState` keeps the
single-flight guard, since two runs firing together would send two shoutouts
inside one cooldown.

Twitch refuses a shoutout when the target is not live, and refuses the same
channel twice within an hour. A failed entry stays queued with a growing backoff
(capped at 15 minutes) and the processor **skips past it** to the next eligible
entry, so one offline channel cannot stall everyone behind it. Nothing gives up
on its own — an entry leaves the queue when it sends or when you remove it. Every
*attempt* is paced by the cooldown, successful or not: a refused shoutout is
still a call to a rate-limited endpoint. The timing rules are pure and tested in
`convex/lib/shoutoutSchedule.ts`.

## Data sources

| Concern | Mechanism |
|---------|-----------|
| Layout and widget config | Convex (`dashboardLayouts`) |
| Per-widget data | Each widget owns its own Convex query/action — see the widget file |

Use this area when you need a **live operations** view without leaving the main shell.
