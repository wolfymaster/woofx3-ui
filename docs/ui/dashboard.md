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
| `workflow-runs` | automation | Recent and in-progress executions |
| `macro-pad` | automation | One-click buttons — see below |
| `stream-stats` | utility | Viewers, uptime, category |
| `notes` | utility | Per-stream scratch pad |

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
and the shared TS resolver's `{…}` (see `client/src/lib/macro-pad.ts` for why) —
variable names are restricted to `[A-Za-z0-9_]`.

Execution of `chat-command` and `trigger-workflow` is **not yet wired** to the
engine; both log to the console. `http-request` currently fetches straight from the
browser, so it is subject to CORS and exposes any header secret client-side.

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
