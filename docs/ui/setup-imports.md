# Importing from Firebot and Streamer.bot

A streamer moving to woofx3 can bring their setup from Firebot or Streamer.bot. The import rebuilds it as ordinary woofx3 objects (workflows, chat commands, command groups and counters), created through the same functions the workflow builder, command editor, groups page and counters page use. The engine cannot tell an imported item from one a person built, and nothing about it is a module.

It is offered in two places, both using `SetupImportPanel` (`client/src/components/setup-import/`):

- the **Bring your setup** step of the setup wizard (see [Auth & onboarding](/ui/auth-onboarding#setup));
- a card on the **Backup** page (`/admin/backup`).

Only owners and admins can import.

## Flow

1. **Open the export in the browser.** `convex/lib/setupImport/decode.ts`, shared with the client:
   - **Firebot**: a `.firebotsetup` file, or a backup zip from Settings > Backups. A backup is the whole profile, sounds and overlay files included, so only the JSON files the import reads are unzipped (with `fflate`). The profile Firebot was last signed into is used, and its files are gathered into the same `components` shape a setup file has.
   - **Streamer.bot**: an export string pasted from Import/Export, or a `.sb` file.
2. **Convert and review.** The opened document is sent to `setupImports.analyze` in chunks, because Convex limits one string to 1 MiB. `analyze` converts it, then stores the result as a `setupImports` row with one `setupImportItems` row per engine object. Nothing reaches the engine yet. The panel shows each item with what it does and what could not come over.
3. **Import.** `setupImports.start` queues it, and `setupImports.apply` creates the items in the background, reporting each item's outcome as it goes. The report stays on the page, and the instance's latest import is shown when the page is opened again.

Converting does not need the catalog. Items name actions by canonical ref (`woofx3:action:chat.reply`) and triggers by event subject, the way starter packs do, so a file can be reviewed before the engine or its modules exist. The refs are resolved against the instance's catalog only when the import is applied.

## What comes over

| Firebot | Streamer.bot | woofx3 |
|---|---|---|
| Command (and each alias) | Command (each line of its command text) with the actions whose Command Triggered trigger names it | Chat command |
| Event, including events in event sets | Action with a Twitch event trigger | Workflow on the matching event |
| Timer | Timed action and the actions it triggers | Workflow on an `@every <n>s` schedule |
| Scheduled task (5-field cron) | — | Workflow on that schedule |
| Counter | — | Counter (`counter` resource) |
| Custom role | User group a command is limited to | Command group |

**Commands with more than actions.** A command runs a plain list of actions. When a source command uses a delay or an if/else, the import creates the command with no actions, plus a workflow on its `chat.command.<word>` event. The command keeps its cooldown and who may use it. The workflow is only created when its command is.

**Steps** become actions, delay waits, or condition tasks:

- chat messages become `chat.reply`;
- delays become a `delay` wait;
- Firebot conditional effects and Streamer.bot if/else become condition tasks;
- Firebot run-effect-list and preset lists, and Streamer.bot Run Action and groups, are copied in at the call site;
- counter updates, shoutouts, clips, stream markers, stream title/category, timeouts, OBS scene switches, OBS source show/hide and OBS mute map onto their woofx3 actions.

**Variables.** `$user`, `$arg[1]`, `%user%`, `%input0%` and the event variables become `${trigger.data...}` expressions, using the event's own field names (`convex/lib/setupImport/events.ts`, which must match the module manifests' `emits`). A variable woofx3 has no value for in that context is left as written and named in the report.

## What does not, and why it is never widened

Each converted item has notes, and its readiness follows from them (`itemReadiness`):

- **ready**: comes over as it was;
- **partial**: something was left out, such as a sound, a whisper sent as chat, or a per-user cooldown;
- **unsupported**: a *blocking* note, so it is not created.

An item is blocked when creating it without the missing piece would make it run *more* than it did before:

- an event filter woofx3 cannot check;
- a regex command;
- a command that costs currency;
- inverted restrictions;
- an event or trigger woofx3 has no equivalent for;
- nothing left to run.

The same rule applies to access. A command limited to VIPs or subscribers, which woofx3 commands cannot check, keeps the other roles it allowed. If it allowed no other role, it is limited to the broadcaster and moderators, never opened to everyone.

Things with no place on woofx3 at all are listed as leftovers rather than items:

- Firebot currencies, hotkeys, quick actions, overlay widgets, rank ladders and variable macros;
- Streamer.bot actions nothing triggers;
- Streamer.bot commands no action runs.

Streamer.bot C# code is left out, and its source (decoded from the export's base64 `byteCode`) is attached to the note so the streamer can rebuild it.

## Applying an import

`setupImports.apply` is an internal action that holds a claim on the import row while it runs, so two runs cannot create the same items. It creates items in this order: groups, counters, commands, then workflows, so later items can refer to earlier ones.

| Item | When something is already there | Created with |
|---|---|---|
| Group | A group with the same name is used, and its members are left alone | `createGroupInEngine`, then `addGroupMemberInEngine` for each member |
| Counter | A counter with the same id is used | The engine's `createResourceInstance`, on the module that declares the `counter` kind |
| Command | A command with the same word is kept, and the imported one is not created | `createCommandInEngine` |
| Workflow | One an earlier import of the same file created, if it still exists | `createWorkflowInEngine`, then `setWorkflowEnabledInEngine` when the source was off |

A command is not created if a group it is limited to was not created.

Each item's outcome is one of:

- `created`
- `exists`
- `needs_module`: the catalog lacks an action or trigger; the message names the Twitch or OBS module, a newer version of one, or a newer engine
- `skipped`: unsupported, or its command or group was not created
- `pending`: the workflow echo is late; `lib/setupImportLedger.ts` marks it created when the echo arrives
- `failed`

**Try the rest again** (`setupImports.retry`) clears `needs_module` and `failed` outcomes and applies again, for example after installing a module.

Apply works in slices of about four minutes and schedules the next slice, so a large import is not cut off by action time limits.

**Waiting.** An import queued during setup does not start until setup finishes (`setup.complete` schedules `setupImports.resumeQueued`). It then waits while setup's modules install and its starter packs are pending, as starter packs do for their triggers to sync. Outside setup it waits for the engine to register. Either wait gives up after 30 minutes and applies anyway, so what is still missing shows as `needs_module`. An engine that never registers leaves the import `stalled`, and **Try again** starts it.

## Source formats

Neither tool documents its export format, so these are recorded here.

**Firebot** (crowbartools/Firebot v5, from its `src/types` and effect definitions):

- A setup file is plain JSON: `{ name, description, author, version, components: { commands, events, eventGroups, timers, scheduledTasks, presetEffectLists, counters, viewerRoles, currencies, ... } }`.
- A backup zip holds `global-settings.json` (`profiles.loggedInProfile`) and `profiles/<name>/` with:
  - `chat/commands.json` (`customCommands`);
  - `events/events.json` (`mainEvents`, `groups`);
  - `timers.json`, `scheduled-tasks.json`, `effects/preset-effect-lists.json`, `counters/counters.json` and `roles/custom-roles.json`, most of them records keyed by id.
- Filters and conditions treat `"inclusive"` as any-must-pass and `"exclusive"` as all-must-pass.

**Streamer.bot** (0.2.2 through 1.0.4, from decoded real exports):

- An export string is `base64("SBAE" + gzip(JSON))`. The JSON is `{ meta, data: { actions, commands, timers, queues, ... }, version }`.
- Schema 23 (1.0.x) nests sub-actions. An if/else (type 120) holds its branches as sub-actions of type 99901 and 99902. Older schemas keep a flat `actions` list with `actionGroups`, and their if/else runs other actions.
- Trigger and sub-action types are numbers. The ones used, and which were inferred from the C# `EventType` order rather than seen in an export, are listed in `convex/lib/setupImport/streamerbot.ts`.
- Commands and timed actions link to actions through triggers 401 (`commandId`) and 701 (`timerId`).

## Code

- `convex/lib/setupImport/`:
  - converters: `firebot.ts`, `streamerbot.ts`;
  - variables: `templates.ts`, `events.ts`;
  - the engine shapes: `compile.ts`;
  - file opening: `decode.ts`;
  - the model: `types.ts`.

  All of it is pure, with tests next to each file.
- `convex/setupImports.ts`: analyze, review, start, apply, retry, discard.
- `client/src/lib/setup-import.ts`: report sections and summaries.
