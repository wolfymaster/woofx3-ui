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
- **Editing.** The edit button sits next to the panel tabs in the status bar. Edit
  mode adds Save and Cancel there, plus add, rename and delete panel buttons
  (double-clicking a tab also renames it; right-clicking a tab still offers the
  same actions). Those controls go in the status bar, and each widget's edit
  controls are laid over it, so the canvas keeps the same size in and out of edit
  mode. While editing, each widget is covered by a drag surface with a remove
  button. Dragging a widget reorders it within its zone or moves it to another
  zone on the same panel (`moveWidget` in `client/src/lib/dashboard-panels.ts`); a
  line shows where it will land. Swiping between panels is turned off while
  editing so a drag does not move the carousel.
- **Adding a widget** opens `WidgetPickerDialog`
  (`client/src/components/dashboard/widget-picker-dialog.tsx`): every registry
  entry as a card with its description, grouped by category, with a search box.
- **Widgets keep a fixed height.** Secondary content opens in an overlay rather
  than expanding inside the widget. See
  [Dashboard widgets keep a fixed height](/patterns/dashboard-widgets).
- **Rail.** The icon column on the right opens rail widgets as flyouts. The
  [getting started checklist](#getting-started-checklist) is pinned first while it
  has anything left to do. The user's own rail widgets start
  as Notes and Stream Stats (`DEFAULT_RAIL_WIDGETS` in
  `client/src/lib/dashboard-rail.ts`). In edit mode any widget can be added to it
  through the same picker, removed, or dragged to reorder, up to 12. The rail is
  stored on the user's `dashboardLayouts` row as `railWidgets`, unset until first
  edited, and saved with the panels on Save.
- **Persistence** has two paths. Placement edits (add, remove, move, resize) are held in
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
| `go-live` | stream | Pre-flight checklist before a stream; also a page at `/stream/go-live` — see below |
| `events` | stream | Everything that happened on stream, with the alerts it played — see below |
| `activity` | stream | The events feed and saved highlights, as tabs |
| `stream-info` | stream | Title, category, tags, saved presets and stream markers — see below |
| `stream-preview` | stream | Thumbnail, click to enlarge |
| `announcement` | stream | Send a coloured announcement to chat |
| `pinned` | stream | Twitch pinned message, plus re-pinnable history — see below |
| `ad-breaks` | stream | Next ad countdown, preroll-free time, snooze — see below |
| `shoutout` | stream | Autocomplete from chat, confirm, queue — see below |
| `moderation` | stream | Blocked terms, timeout/ban/unban, chat modes — see below |
| `queue` | stream | One queue's line, with manual add and remove — see below |
| `timer` | stream | One timer's countdown, with start, pause and add time — see below |
| `workflow-runs` | automation | Recent and in-progress executions |
| `macro-pad` | automation | One-click buttons — see below |
| `stream-stats` | utility | Viewers, uptime, category, and follows/subs/bits/raids pushed since the page loaded |
| `recent-streams` | utility | Totals for the last finished sessions, from `streamSessionSummaries` — see below |
| `notes` | utility | Scratch pad shared by everyone on the instance — see below |

Saved panels can hold two retired types, `live-events` and `alert-log`. Both
render the Events widget (`REPLACED_WIDGET_TYPES` in the registry) and keep their
saved type and config; the picker offers only `events`.

## Events

One feed of what happened on stream
(`components/dashboard/widgets/events.tsx`). A row is one thing that happened,
built by `mergeActivity` in `client/src/lib/activity-feed.ts`:

- **Rows are every alert, plus every event of an enabled type that no alert
  claims.** An alert joins its event by `engineAlerts.sourceEventId`, else by the
  id of the event its envelope carries, so one event that played two alerts is
  one row marked "2 alerts". An alert always shows, whatever the selection; one
  with no event (a schedule, a manual fire) shows on its own.
- **Wording** comes from the event's trigger: its `emits.summary` and
  `emits.details` (`describeEvent` in `lib/alert-summary.ts`), so the widget never
  names an event type. An event no installed trigger claims reads as its type.
- **Test events never show.** The dashboard's own test alerts and debug triggers
  reach the engine with CloudEvent `source: "api"`; such events, and alerts whose
  envelope event has that source, are dropped. The Alerts page feed still shows
  them: it is where a test alert is checked.
- **Which events: the engine's selection.** Each engine keeps one selection of
  event types (CloudEvent `type`), which decides what it logs and pushes, and
  every Events widget on that engine shows it. The widget's filter reads it with
  `getEventLogSettings` and writes it with `setEventLogSelection`
  (`engine/hooks/use-event-log-settings.ts`, shared by every widget on the page and read
  again on reconnect and whenever the filter opens). The checklist lists the
  engine's `offered` types grouped by the module of the trigger that fires each
  (`eventTypeGroups`; a type no installed trigger claims shows as its raw type),
  checked when `enabled`. The engine decides the defaults and what it offers;
  the dashboard computes neither. The selection is stored as overrides on the
  defaults, and `withEventTypeEnabled` keeps it that way: turning a default on
  drops it from `hidden`, turning a non-default on adds it to `shown`, turning a
  default off adds it to `hidden`, turning a non-default off drops it from
  `shown`. Turning a type on records it from then on; history does not fill in
  backwards. The widget keeps no config of its own, so a `filter` saved in an
  older layout's config is ignored.
- **Sources.** History is a page of the engine's event log
  (`listEvents({ types: enabled })` on the transport), read on mount, whenever
  `enabled` changes, and again on every reconnect because the push is not
  gapless; pushed events of the enabled types go on top, deduplicated by event
  id (`engine/hooks/use-event-log.ts`). Alerts come from `engineAlerts.listForInstance`.
- **Older engines.** An engine without the `events.log` capability has no
  selection and no log. The widget shows a "Live only" badge, disables the
  filter with a tooltip to update the engine, and shows alerts plus whatever the
  engine pushes (its fixed set: follows, subs, gifts, cheers, raids, stream
  online/offline, ad breaks).
- **A row** shows its summary, details, time and module. A row with an alert adds
  the newest alert's status, its failure reason, **Open run**
  (`/stream/alert-run/:engineRunId`) and **Replay** (`alertActions.replay`). An
  event-only row opens its fields in a popover, labelled from the trigger's
  `emits` descriptions, so the row itself never grows. The header carries the
  counts, the alert queue controls (skip, clear) and the filter.

The Activity panel's Events tab is the same feed with a star on each row that
saves it to Highlights (`activityPanel.saveHighlight`), storing the row's summary
as it read then.

### One stream subscription per page

Every widget that listens to pushed events (Events, Stream Stats, Ad Breaks)
goes through the gateway's `eventLog.useStreamEventsSubscription()`
(`useStreamEventsSubscription` in `client/src/engine/hooks/use-event-log.ts`),
declaring the event types it takes. Under the Convex gateway that is the
browser transport's `subscribeStreamEvents`. The browser transport holds one engine
subscription per session and registers the union of every listener's types
with `subscribeStreamEvents(subscriber, types)`. Calling it again replaces the
previous registration, so the transport registers again whenever the union
changes (debounced by 100 ms, so a widget changing its types or several
mounting together cost one call) and after every reconnect. Each listener
receives only frames of its own types. Events asks for its `enabled` types,
Stream Stats for the five it counts (`STREAM_TALLY_EVENTS`) and Ad Breaks for
the three ad-break events.

On connect the transport asks the engine for its capabilities over the same
session. An engine without `events.log` adds a subscription on every call
rather than replacing one, so it is registered once, without types, and pushes
its fixed set; listeners still take only their own types, and a listener that
passes `null` (the Events widget on such an engine) takes everything.

## Go live checklist

A pre-flight run just before going live, so a broken setup is found by the
streamer and not by the viewers. The same component
(`components/go-live/go-live-checklist.tsx`) is the `go-live` widget and the
`/stream/go-live` page. Every check starts at once on mount and each row fills
in as its answer lands; the checks that ask Twitch are separate Convex actions
in `convex/goLive.ts` for exactly that reason, and the OBS check sends its own
field-options request.

| Check | Source | Notes |
|-------|--------|-------|
| Engine | `$engineConnected` from the transport | No request of its own |
| Twitch connection | `goLive.checkTwitch` | Validates the token with Twitch and diffs its scopes against `TWITCH_INTEGRATION_SCOPES` |
| Overlays | `goLive.overlays` | Scenes and OBS browser-source keys. Nothing reports whether an overlay is open in OBS right now, so the best case is a warning with the URL to copy and when a browser source last loaded one |
| OBS | `fieldOptions.dispatch` | Asks for the options of the OBS platform module's (`woofx3_obs`) `obs.switch_scene` scene field by reference, exactly as the workflow builder's scene picker does, and reads the reply from `transientEvents`. Scenes listed pass with their count; the scene manager's `{ error }` reason (e.g. OBS not connected) warns with that reason; an engine without that field (the OBS module is not installed or lacks the field, or the engine predates field references) warns that OBS can't be checked and asks to install or update the OBS module; no reply within 15 seconds warns that OBS didn't answer. There is no OBS-specific engine call |
| Stream info | `goLive.checkStreamInfo` | Helix `GET /channels`; warns about no title or category, a title identical to the last completed checklist, or a category unchanged for over a week |
| Workflows | `goLive.checklist` | Warns when none is enabled; counts enabled workflows only up to 20 through `workflows.by_instance_enabled` |

Whether a fact passes, warns or fails is decided in `lib/go-live-checks.ts`,
pure and tested, next to the fix each result offers. "Fail" is kept for what
will visibly break the stream; anything the checklist cannot confirm is a
warning. A check can be dismissed (an instance without OBS, say): dismissals
live in `goLiveChecklists`, one row per instance shared by the whole team, and
never count toward the verdict.

Overlays have their own query because a browser source loading its URL
rewrites the key's `lastUsedAt`, and only that query should rerun.

Finishing the checklist (`goLive.complete`) optionally posts an editable
announcement to chat and drops a "Stream start" stream marker. Twitch only
marks a live broadcast, and the checklist usually runs before going live, so
an offline request is stored on the `goLiveChecklists` row and claimed by
whichever writer first flips `instanceLiveState` to live (the STREAM_ONLINE
webhook or the poll), which schedules `goLive.dropStreamStartMarker`. A
request older than two hours is dropped unused (`lib/goLiveMarker.ts`). Each
step reports its own outcome so one refusal does not hide the other. Unless
every requested step failed, it also records the channel's title and
category, which is what the next run's "same title as last time" is measured
against: Twitch keeps no history of either.

## Getting started checklist

The getting started checklist (`client/src/components/dashboard/getting-started-checklist.tsx`) is pinned as the first rail item, above the user's own rail widgets. Its flyout lists the items in one column. While anything is left to do, the rail icon carries a dot, red when an item needs attention (a failed install, say). The rail item cannot be moved or removed in edit mode. `useGettingStarted` is called once by the dashboard and feeds both the icon and the flyout. Its rules are in `client/src/lib/getting-started.ts` (unit-tested).

| Item | Done when | Offers |
|---|---|---|
| Finish setting up | `instanceSetup.completedAt` is set | Continue setup (`/setup`) |
| Platforms installed | every chosen platform's `moduleInstalls` entry is `installed` | Retry (`setup.retryApply`) on a failure; the module page on a needs-approval |
| Set up *platform* (one per platform) | the streamer says so | Open the module page, **Done** |
| Twitch connected | the instance has a Twitch link | Connect Twitch |
| Overlay added to OBS | a browser source has loaded a browser-source key (`goLive.overlays.lastLoadedAt`) | Copy browser-source URL, Open scenes |
| Fire a test follow | the checklist fired one | **Send a test follow**: a `channel.follow` test event with the trigger's sample values, through `useFireTestEvent` |
| Run your first chat command | the streamer says so | See your commands, **I've tried it** |

- **Items the checklist records itself.** The engine reports no event for a chat command run, and a test follow is only known to have been sent. So those two are recorded in `gettingStartedChecklists.doneItemIds` (`gettingStarted.markDone`). Everything else is read from existing data.
- **Platform settings.** A chosen platform whose installed module declares settings gets its own item (`setup.status.platformsNeedingSettings`). Spotify (a Client ID and an authorization) and OBS (its WebSocket address, port and password) are two. Those settings are kept on the engine, so this item is also recorded by the checklist (`platform-settings:<id>`).
- **OBS connection.** On an engine with the `obs.status` capability, "Set up OBS" follows the engine's actual OBS connection instead of the Done button. `useObsStatus` polls `obsStatus.get` every 5 s while the tab is visible. The item is done once OBS is connected; otherwise it shows why not, for example "OBS refused the password" or "Can't reach OBS at host:port".
- **When it hides.** The rail item disappears once every item is done, or when someone dismisses it from the bottom of the flyout (`gettingStarted.dismiss`). Both are per instance, like the Go live checklist's dismissals.
- **Test follow availability.** Sending a test follow needs a registered engine and the follow trigger in the catalog, which comes from the Twitch module. Until then the button is disabled, with the reason.

Help → **Setup** reopens the setup wizard (`/setup`). Once setup is finished, it opens on the All set page.

## Notes

`notes` is one note per instance (`instanceNotes`, `convex/dashboardNotes.ts`), shared by every member like the macro pad: a streamer and their moderators keep one set of notes for the channel. It saves 800 ms after typing stops and when the widget closes. Another member's save replaces the text on screen only while this widget has no unsaved edit of its own, keeping the caret where it was, so it never overwrites what is being typed. Two people typing at once is last write wins, and the footer names whoever saved last.

Notes used to be private per member (`dashboardNotes`, now read only by the migration). `bunx convex run migrations/backfillSharedNotes:default` folds them into the shared note: one member's notes as they were, several members' joined under each author's name.

## Recent streams

`recent-streams` lists the instance's last ten finished sessions from
`streamSessionSummaries` (`convex/streamSessionSummaries.ts`), newest first.
Each row is one engine session: the time actually live (its segments added up,
so the gaps a session spans across brief dropouts are left out), peak and
average viewers, and the session's follows, subs, gifted subs, bits and raids.

Rows arrive by the engine's `session.summary` webhook, which fires when a
session *ends*. The engine ends a session when the next broadcast past its
grace window begins, not when its own stream goes offline. Until then the
current session shows from snapshots the UI takes, badged "In progress" only
while its stream is live; see [when a session is in progress](./stream-recaps#when-a-session-is-in-progress).
A session that was never live is a real row with every figure at
zero and no viewer figures. Each delivery is a whole snapshot; the table keeps
one row per `(instanceId, sessionId)` and replaces it only with a snapshot whose
`generatedAt` is newer, so redeliveries and re-summaries are harmless. A
snapshot with a `schemaVersion` this deployment does not know is kept as raw
JSON and shown as unreadable rather than guessed at.

Each row links to that stream's recap (`/stream/recaps/:sessionId`), described
under [Stream recaps](./stream-recaps).

## Command bar

The strip above the panels (`client/src/components/dashboard/command-bar.tsx`):
stream preview, live pill, counter cards, Clip. It is not a widget and is not in
the layout — it spans the whole dashboard and is hidden per browser through the
`$commandBarHidden` nanostore.

Clip creates the clip from `convex/twitchClips.ts`, on Helix or through an
engine with `twitch.clips` (see
[Helix calls through the engine](#helix-calls-through-the-engine)). Stream
recap clips stay in Convex.

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

## Moderation

For a streamer with nobody else modding: block a phrase, time out or ban a user,
or lock chat down, in seconds and without leaving the dashboard. Every call goes
to Helix from `convex/moderation.ts` with the broadcaster's token, the same
path as the announcement and shoutout controls, or through an engine with
`twitch.moderation` (see
[Helix calls through the engine](#helix-calls-through-the-engine)).

The widget is three stacked sections, ordered by how fast each has to happen:

- **Block a phrase** — a quick-add box (2 to 500 characters, `*` as a wildcard,
  Twitch's own rules) above a count that opens the channel's blocked terms in an overlay,
  each removable. The list is read from `GET /helix/moderation/blocked_terms`,
  following the cursor up to 2000 terms, and is loaded once rather than polled.
- **User** — a username box with the shoutout widget's chatter autocomplete
  (`hooks/use-chatters.ts`), then timeout presets (60s, 10m, 1h, 24h) or a
  custom duration (`90`, `10m`, `1h30m`, `2d`, up to Twitch's two weeks), and
  Ban / Unban. Ban opens an inline confirmation with an optional reason, focused on the
  reason rather than the Ban button so a reflexive keypress cannot confirm; Unban
  also lifts an active timeout, since Helix treats the two the same.
- **Chat modes** — switches for followers-only (with a minimum follow age),
  subscriber-only, emote-only and slow mode (3 to 120 seconds), via
  `PATCH /helix/chat/settings`. Only the fields being changed are sent, so a
  toggle never overwrites a mode someone else changed from Twitch. The current
  modes are polled every minute while the tab is visible; a poll that started
  before a change is discarded (`lib/write-fence.ts`) so it cannot flip a switch
  back, and a failed poll keeps the last known modes quietly. Turning on
  subscriber-only, which silences most of a small channel at once, offers an
  Undo toast.

**Who may do what.** `CAPABILITY_RULES` in `convex/lib/moderation.ts` is the one
table; every action enforces it and the widget reads it through
`moderation.access` only to disable and explain.

| Capability | Instance roles | Twitch scope |
|------------|----------------|--------------|
| Add (and list) blocked terms | owner, admin, member | `moderator:manage:blocked_terms` |
| Remove blocked terms | owner, admin | `moderator:manage:blocked_terms` |
| Timeout | owner, admin, member | `moderator:manage:banned_users` |
| Ban / unban | owner, admin | `moderator:manage:banned_users` |
| Chat modes | owner, admin | `moderator:manage:chat_settings` |

Adding a term and timing someone out are open to members because they are what
a helper covering chat reaches for, and both fail safe. Removing a term can
silently unblock a slur, a ban lasts until someone lifts it, and a lockdown
changes chat for everyone, so those stay with the people who run the channel.
Members see the blocked-term list without remove buttons.

`moderator:manage:chat_settings` is requested by the Twitch integration link but
a link made before it was added does not carry it. The switches still show the
current modes (reading needs only `moderator:read:chat_settings`) and the section
says **Needs reconnect** until Twitch is reconnected in Settings → Integrations.

Twitch refusals are turned into sentences by `describeModerationError`: an
account Twitch will not let be banned or timed out, an already-banned user, unbanning
someone who is not banned, rate limits, and a revoked token each get their own
message; anything else shows Twitch's text. A username Twitch cannot find is
refused before any moderation call. Every failure leaves `convex/moderation.ts`
as a `ConvexError`, including those from the shared `authorizeTwitch` and
`fetchTwitchUser`, so the message survives production, where a plain `Error`
becomes "Server Error". Anything that still arrives that way is shown as
"Something went wrong (request `<id>`)" by `lib/action-error.ts`.

Deleting a single chat message is not here: it needs the message id, and nothing
in the dashboard receives chat messages.

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

Square buttons that send a chat message, fire a chat command, a workflow, a single
catalog action, or an HTTP request. Its own
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
URL, body, a header value, or any text setting of an action is collected from the user in a prompt before the macro runs.
The <code v-pre>{{…}}</code> delimiter is deliberately distinct from the workflow engine's `${…}`
and the shared TS resolver's `{…}` (see `convex/lib/macroVariables.ts` for why) —
variable names are restricted to `[A-Za-z0-9_]`.

`chat-command`, `trigger-workflow` and `run-action` macros run in Convex through `macros.run`,
the same `planMacroRun` / `executeMacroPlan` path a remote trigger uses
(`convex/lib/macroTrigger.ts`, `convex/lib/macroExecution.ts`). A workflow macro
calls the engine's `triggerWorkflowByName`; a chat-command macro must be a
`!command` and calls the engine's `executeCommand` as the linked Twitch
broadcaster, exactly as if they had typed it — the engine cannot post a plain chat
message. An action macro holds one action and calls the engine's `runActions` with
that one step. The engine records no run for it, so there is no outcome to watch. The step is stored
with `$ref` as `ref`, since Convex refuses `$` field names, and is converted back
just before the RPC (`macroActionToEngineStep`). `http-request` fetches straight from the browser, so it is subject to
CORS and its headers are visible to anyone with dashboard access.

### Action buttons

The **Action** tab of the button editor (`macro-action-step.tsx`) picks and edits the
one action in place, inside the editor, with no second dialog:

- With no action yet, it shows the flow editor's object-first picker
  (`ObjectActionPicker`) offering actions only (`flowSteps={[]}`), since a button
  runs one action and has no pauses, waits or conditions. The thing chosen in the
  picker ("Which counter?") fills the action's setting, as when a flow adds a step.
- Once picked it collapses to the action, worded as the step reads in the flow, with
  **Change** to reopen the picker and the action's settings below. The settings are
  `StepInlineEditor`, the flow's own step editor, on the action as a step
  (`macroStepNode` / `macroStepFromNode` in `lib/macro-pad.ts`), without a step id
  field: only the action, its `function`, `ref` and settings are stored, in the same
  shape as before.
- Escape steps back through the picker rather than closing the button editor: the
  dialog leaves Escape to the picker (`isInsideActionPicker`).

The label of an action button follows its step's sentence ("Add to Hype counter")
until the streamer types a label of their own. The sentence is `stepSummary`'s
title with the thing the action points at read into it (`useMacroActionSentence`,
`stepTarget` in `lib/action-objects.ts`). The label is stored as text either way,
so the pad shows it without the catalog. An opened button whose stored label is the
sentence keeps following it as the action changes (`typedMacroLabel`); clearing the
label goes back to the sentence (`macroButtonLabel`).

### Trigger macros from a Stream Deck or phone

Any `chat-command`, `trigger-workflow` or `run-action` macro can get a **remote trigger**: a
secret token that presses the button with a single HTTP request, so an Elgato
Stream Deck, Bitfocus Companion, Touch Portal, or a phone shortcut can drive the
show without the dashboard open.

**Turning it on**

1. On the dashboard, open the macro pad's edit mode and click the pencil on the
   macro.
2. Switch on **Remote trigger**. Only an owner or admin of the instance can do this,
   and doing it approves what the macro does right now.
3. Copy the token (or the full URL, or one of the ready-made examples) right away.
   **It is shown once**: woofx3 keeps only a SHA-256 hash of it, so if you lose it,
   click **Rotate** to get a new one (the old one stops working at the same moment).
4. Switch Remote trigger off to revoke it.

A tile with a remote trigger shows a small radio icon; hover it for when it was
last used, how many presses the engine accepted, and whether the last one failed.

**Who can change a triggered macro.** A trigger runs whatever its macro is set to
do, from anywhere, so once a macro has one, only an owner or admin can change its
action type, its command, workflow or other settings, or delete it. Other members
can still rename it and change its icon and color. As a second line of defense the
trigger remembers the exact action it was approved for: if the macro's action
changes anyway (an admin edits it, say), or the person who approved it stops being
an owner or admin, the trigger answers `409` and the editor shows **Re-confirm**
until an owner or admin approves the macro as it now stands.

**Calling it**

- Send `POST https://<your-convex-site>/api/macros/trigger` with the header
  `Authorization: Bearer <token>`. A device that cannot set headers can put the
  token in the path instead: `POST …/api/macros/trigger/<token>`. Prefer the
  header: a URL ends up in places a header does not, including browser history,
  proxy logs and Convex's own request logs.
- The answer is `202 {"ok":true}` (plus a `triggerId` for a workflow run) once the
  engine has accepted the run.
- If the macro has <code v-pre>{{variables}}</code>, send them as a JSON body
  (`{"channel":"bob"}`), a form body, or query parameters. A request missing one
  gets `400` naming the missing variables, and so does a value containing a line
  break or any other control character.
- GET is refused (`405`) unless you switch on **Also accept GET** for that macro.
  Only do that for a device that can do nothing else: chat apps and browsers fetch
  pasted links to build previews, so a GET URL can fire by accident.
- Requests from a web page are refused with `403`: browsers attach an `Origin`
  header and the devices above do not. A device or tool that does send `Origin`
  (a browser extension, a web-based deck) cannot use remote triggers.
- Each trigger accepts one press a second, with bursts of up to five; beyond that
  it answers `429` with a `Retry-After` header.
- An unknown or revoked token, or one whose macro or instance is gone or whose
  instance is not connected to its engine, answers `404`.
- `409` means the run was refused with a reason in the body: the macro needs
  re-confirming, no Twitch account is linked, or the engine refused the command
  (for example "Command is disabled"). `502` / `504` mean the engine could not be
  reached or did not answer within 10 seconds.

Treat the token like a password: anyone who has it can press that one button (and
nothing else). Rotate it if it shows up on stream or in a screenshot.

**Elgato Stream Deck**

The built-in *Website* action can only open a URL, so use a free plugin that can
send a POST with a header:

1. Install **API Ninja** (BarRaider) or **Web Requests** from the Stream Deck store.
2. Drag its action onto a key.
3. Set the method to **POST**, the URL to `https://<your-convex-site>/api/macros/trigger`,
   and add the header `Authorization: Bearer <token>`.
4. If the macro has variables, set the content type to `application/json` and the
   body to a JSON object, e.g. `{"channel":"bob"}`.

If you did switch on *Also accept GET*, the built-in *Website* action works too:
paste the full URL with the token in it (variables go in the query string,
`?channel=bob`) and tick **GET request in background** so no browser window opens.

**Bitfocus Companion**

1. Add a connection of type **Generic: HTTP Requests**.
2. On a button, add the connection's **POST** action.
3. Set the URL to `https://<your-convex-site>/api/macros/trigger` and the header to
   `{"Authorization":"Bearer <token>"}`. For variables, set the body to a JSON object
   and add `"Content-Type":"application/json"` to the header.

**iOS Shortcuts**

1. Create a shortcut with the **Get Contents of URL** action and set the URL to
   `https://<your-convex-site>/api/macros/trigger`.
2. Expand the action, set **Method** to **POST**, and add a header named
   `Authorization` with the value `Bearer <token>`.
3. For variables, set **Request Body** to **JSON** and add one text field per
   variable (an *Ask for Input* action before it lets the shortcut prompt you).
4. Add the shortcut to the home screen, or run it from Siri or the Action button.

**Why HTTP-request macros cannot have one.** They run from the viewer's browser,
where a target on the local network (OBS, a light controller) is reachable. Run
from Convex they would reach a different network and turn Convex into a proxy for
any URL with the macro's headers attached. Point the device at that URL directly.

**Chat-command macros run as the broadcaster**, whether pressed on the dashboard or
through a trigger, so they can run any command the streamer could type. On the
dashboard only owners and admins can press them; other members see the button
disabled.

**How it works.** `convex/http.ts` routes `/api/macros/trigger` and
`/api/macros/trigger/<token>` to one handler. It refuses a request carrying
`Origin`, reads at most 8 KB of body, hashes the token and calls
`macroTriggers.claim`, a single mutation that looks the hash up in the
`macroTriggers` table, checks the method, spends a rate-limit token, checks the
approval still stands, and validates the variables. The handler then calls the
engine with provenance `macro-trigger`, so these runs appear in the run history
(dashboard presses, provenance `dashboard`, do not), and records the outcome:
accepted runs bump `lastUsedAt` / `useCount`, refused or failed ones set
`lastFailedAt` / `lastFailure`. The decision logic is pure and tested in
`convex/lib/macroTrigger.test.ts`.

## Helix calls through the engine

The widgets below call Twitch Helix from Convex with the broadcaster's link
token. An engine that advertises a `twitch.*` capability can make the same
calls itself, with the same link's token, and answer with Twitch's own status
and body. `convex/lib/twitchEngineHelix.ts` is the one place that chooses:

- `twitchHelixRoute` picks the engine only when it is registered and lists the
  capability (asked once per action, with a 3s limit).
- `helixResponse` hands the engine's answer back as a `Response`, so each
  module's status checks, parsers and error sentences are the same on both
  paths.
- When the engine has no answer from Twitch (`not_linked`, `unavailable`,
  `invalid_arguments`, or the engine is unreachable) the call goes to Helix
  directly, and the fallback is logged. A read also falls back after `timeout`
  or `failed`. A write does not: Twitch may already have applied it, so it
  fails as a Twitch 504 (timeout) or 502 (failed) instead of being sent twice.

## Chat writes through the platform gateway

Chat messages, announcements and pins (from the macro pad, the command
palette, the Announcement and Pinned widgets, the stream recap and the Go live
announcement) go through the engine's platform gateway when the engine
advertises `platform.gateway`. The engine then posts with its own Twitch
connection, so the line gets its command guard and is recognised as the
engine's own when Twitch echoes it, and the answer says what Twitch did.
`convex/lib/platformGateway.ts` chooses the route (`chatRoute`, one capability
read per action) and reads the answer:

| Gateway outcome | What the dashboard does |
|---|---|
| `delivered` | Done; pins record the posted message id in the history |
| `dropped` | Shows Twitch's reason (AutoMod, a duplicate, a banned term) |
| `unconfirmed`, or no answer in 15s | Says the line may already be in chat; never resends it |
| `unavailable` | Says why nothing was sent (Twitch off or not linked in the engine, the gateway not running). There is no Helix fallback: the engine owns the platform connection |
| `failed` | Shows Twitch's refusal. A pin by id that Twitch refused as `invalid` or `upstream` re-posts the text, as on the Helix route |

Every write carries an idempotency key, `<scope>:<operationId>:<step>`
(`dashboard:…` for widget and palette actions, `golive:…:announce` for the Go
live checklist). The client mints one operation id per intent
(`client/src/lib/operation-id.ts`): the same action, target and text asked
again reuse the id until one attempt succeeds, so a double click or a retry
after an unconfirmed send replays the engine's first answer rather than
posting twice. The gateway forgets a send that reached no platform, so a retry
after `unavailable` sends again. A client that sends no operation id gets a
server-side one, with no dedupe. The engine keeps keys in memory, so a restart
forgets them.

Engines without `platform.gateway` keep the
[Helix route](#helix-calls-through-the-engine). Shoutouts, reading the current
pin and unpinning always take it.

## Stream info

Edits the channel's title, category and tags, and drops stream markers, without
leaving for Twitch's own dashboard. Every call goes to Helix from
`convex/streamInfo.ts`, or through an engine with `twitch.streamInfo` (see
above), so it keeps working while no engine is running. Every call needs one scope,
`channel:manage:broadcast` — reads included, although Get Channel Information
needs none, so a link missing the scope shows a single "reconnect Twitch" state
instead of a card that shows data and refuses every button.

- **Current info** comes from Get Channel Information, plus Get Games for the
  category's box art (the channel endpoint returns only its id and name); a poll
  passes the art it already has and skips Get Games while the category is
  unchanged. Twitch pushes nothing when the title changes elsewhere, so the card
  polls every minute while the tab is visible. A poll merges per field
  (`client/src/lib/stream-info-edit.ts`): a field being edited keeps the edit,
  every other field follows Twitch.
- **Saving** sends only the fields that differ from what the card last read
  (`diffStreamInfo`). The title may have been changed since by Twitch's
  dashboard, a moderator or a chat command, and a save that only touched tags
  must not put the old title back. The save is optimistic, and rolls back if
  Twitch refuses. Afterwards `updateChannelInfo` reads the channel again and
  returns what Twitch actually holds: Modify Channel Information answers 204
  even when it ignores a value such as an unknown category, so the card reports
  any field Twitch kept.
- **Category** is a debounced typeahead over Search Categories; clearing it sends
  an empty `game_id`.
- **Tags**: at most 10, each at most 25 characters, no spaces, no duplicates
  ignoring case — checked in both the editor and the action by
  `convex/lib/streamInfo.ts`. A refused tag stays in the input with the reason
  under it. Twitch's rule on characters ("no special characters") is only
  warned about, for anything outside letters, combining marks and digits of any
  script; Twitch's own 400 message is the authority. Changes are detected
  case-sensitively, so "fps" to "FPS" can be saved. Titles are at most 140
  characters, counted in code points so an emoji is one.
- **Saved presets** (`streamInfoPresets`) are named title/category/tags sets,
  instance-scoped because they describe the channel, not the viewer. Saving
  under an existing name replaces it. Rows are bounded (name, title, tags and
  category lengths), and box art must be a `https://static-cdn.jtvnw.net/` URL
  since it renders for everyone on the account. Applying a preset sends all
  three fields through the same optimistic save; a preset that matches the
  channel already is marked and disabled, and the others say what applying
  them would change.
- **Markers** use Create Stream Marker with an optional description (at most
  140). Twitch answers 404 both when the channel is offline and when past
  broadcasts are off, without saying which; that becomes one inline message
  covering both (reruns and premieres cannot be marked either). Any other
  failure, such as a 403 for a token that is not the channel's owner or an
  editor, shows Twitch's own message.

## Pinned

Twitch keeps **exactly one pinned message per channel**, and pinning a new one
silently replaces it — so the widget shows a single current pin, not a list. The
list behind **History** (opened in an overlay) is *history*: things worth pinning again, kept because the same
message tends to recur stream after stream.

Pinning targets an existing chat message by id (`PUT /helix/chat/pins`), so a
"custom" pinned message is really Send Chat Message with its `pin` flag — which
means **it posts a visible chat message** from the connected account. Twitch pins
messages; there is no free-floating pinned text.

Reading the current pin (`GET /helix/chat/pins`, parsed by
`convex/lib/twitchPins.ts`) returns the message's text, its sender, when it was
pinned (`starts_at`) and when the pin expires (`ends_at`, null when it lasts
until the stream ends). The widget shows the text and sender as Twitch reports
them. A pin made outside this app, from Twitch's own chat or by a moderator, is
added to the history the first time the widget sees it (`pins.recordSeenPin`),
keyed by its message id so it is added once, and can then be pinned again from
here. There is no EventSub type for pinning, which is why the current pin is
polled rather than pushed.

Pinning and re-posting go through the platform gateway on an engine with
`platform.gateway` (see
[Chat writes through the platform gateway](#chat-writes-through-the-platform-gateway)).
Otherwise, and always for reading and unpinning, they go to Helix from
`convex/pins.ts`, or through an engine with `twitch.pins` (see
[Helix calls through the engine](#helix-calls-through-the-engine)). The history
stays in Convex. A message the gateway posted but could not pin is recorded
with its id and reported as a warning rather than an error: the pin counts as
done, so the draft clears and the next click is a new pin. It can then be
pinned from the history by its id. It is not an error because the gateway
forgets a reply where nothing succeeded, so retrying it would post the line
a second time.

Re-pinning has two paths, chosen by `convex/lib/pinStrategy.ts`: reuse the
stored message id when the entry was created during the current broadcast,
otherwise re-post the text and pin the new message, since a message id stops
being pinnable once its stream ends. A refusal falls back to re-posting anyway —
the rule exists to keep that fallback rare, not to replace it. A pin the engine
sent but could not confirm does not fall back: Twitch may have pinned it, and a
re-post would put the message in chat twice. History rows
predating this feature were hand-written Activity-panel notes; they carry no
message id and so always take the re-post path.

Pinning needs `moderator:manage:chat_messages`. Reading needs only
`moderator:read:chat_messages`, which existing links already carry — so the
current pin is visible before reconnecting, while the controls are disabled with
an inline hint. These endpoints have been in open beta since 2026-05-15.

## Shoutout

Queues Twitch shoutouts and sends them one at a time within the endpoint's
cooldown.

The chatter list, the confirmation lookup and each send go to Helix, or through
an engine with `twitch.chat` (see
[Helix calls through the engine](#helix-calls-through-the-engine)). The queue
itself stays in Convex. A
queued shoutout the engine could not confirm fails like a Twitch 5xx and is
retried after its backoff, which cannot shout out twice: Twitch refuses a
second shoutout to the same channel within the hour.

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

## Ad breaks

A heads-up for mid-roll ads, so the streamer is not cut off mid-sentence: a
countdown to the next scheduled ad, when the last one ran, the preroll-free
time left, and a snooze button with the snoozes left and when the next one
refills. While an ad plays the widget shows "Ad running, back in m:ss".

The schedule and the snooze go to Helix from `convex/adBreaks.ts` (Get Ad
Schedule under `channel:read:ads`, Snooze Next Ad under `channel:manage:ads`),
or through an engine with `twitch.ads` (see
[Helix calls through the engine](#helix-calls-through-the-engine)). A snooze
the engine could not confirm is not resent, since a second one would spend
another snooze. `authorizeTwitch` checks membership and the scope.
Any member may snooze: a snooze only pushes the next ad back, and it is a call
a moderator running the stream makes on the spot. Helix documents its ad
times as RFC3339 but also answers with epoch seconds (a number or a numeric
string), 0 or `""` for none; `convex/lib/adBreaks.ts` normalizes all of them
to ISO or null and refuses a malformed answer whole. A 401 asks for a Twitch
reconnect, a 403 or a missing scope says to reconnect Twitch to allow ad
controls, a 400 on a snooze (no snoozes left, channel not live) shows Twitch's
own message, and a 429 reads as rate limited.

Twitch pushes nothing to the browser about the schedule, and a snooze from
Twitch's own dashboard changes it, so the widget polls every 60 seconds while
visible and live, and again whenever a countdown reaches zero. The ad events
still come from the engine over the stream-event session (`begin` from
Twitch EventSub; `upcoming` and `end` synthesized by the engine's Twitch
service, since Twitch sends neither): the running state starts at once and
the schedule refreshes after each ad; without them a last ad still inside its
length is read as running. Helix sends no clock of its own, so each answer
carries the Convex action's clock at receipt as `serverNow`, and times are
placed on the browser's clock relative to it, so a skewed browser clock does
not move the countdowns. Every countdown ticks off the shared
`$nowPerSecond` ticker. Which state shows is decided in
`client/src/lib/ad-break-view.ts`, pure and tested: offline, then a missing
scope, then a running ad, then what Twitch answered.

The scopes (`channel:read:ads`, `channel:manage:ads`) are the optional "Ad
breaks" capability: a link made before them raises no banner, the integrations
page lists them as not granted, and the widget offers a reconnect.

## Data sources

| Concern | Mechanism |
|---------|-----------|
| Layout and widget config | Convex (`dashboardLayouts`) |
| Per-widget data | Each widget owns its own Convex query/action — see the widget file |

Use this area when you need a **live operations** view without leaving the main shell.
