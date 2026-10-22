# Workflows

**Routes:** `/stream/workflows`, `/stream/workflows/new`, `/stream/workflows/:id`, `/stream/workflows/:id/runs/:engineRunId`, `/stream/starter-packs`
**Primary files:** `client/src/pages/workflows.tsx`, `client/src/components/workflows/workflow-editor.tsx`, `client/src/components/workflows/workflow-flow-editor.tsx`, `client/src/components/flow/flow-editor.tsx`, `client/src/lib/workflow-display.ts`, `client/src/hooks/use-workflow-catalog.ts`

`pages/workflows.tsx` serves the first three routes and picks one of three screens from the location: the list, the create flow, or the editor.

## List view (`/stream/workflows`)

Modelled on the Chat Commands page: `PageHeader`, an All / Enabled / Disabled tab filter with counts, a search box, a **Create Workflow** button, and a single full-width table.

- Rows come from the Convex `workflows` table for the current instance (`api.workflows.list`).
- Columns: workflow (name + description), trigger, steps, enabled, actions.
- The **trigger** label is resolved against the catalog by `workflowTriggerLabel` (`lib/workflow-display.ts`), which shares `triggerNodeLabel` with the step cards, so a workflow reads the same in the list as in the editor.
- The **enabled** toggle calls `workflowActions.setEnabled` inline; clicking a row (or the pencil) opens the editor; the trash opens the shared delete dialog.
- There is no list rail on this page — the section subnav is the only sidebar, and the table is the list.

An instance with no workflows gets an empty state pointing at the starter packs first and the create flow second.

## Starter packs (`/stream/starter-packs`)

**Primary files:** `client/src/pages/starter-packs.tsx`, `convex/lib/starterPacks.ts`, `convex/starterPacks.ts`

Curated sets of workflows and chat commands (raid welcome, follower thanks, sub and gift hype, cheer thanks, handy commands, BRB scene, ad break heads-up, ad break scene) that a new streamer installs in one click. The dashboard shows a banner linking here while the instance has no workflows (`api.workflows.hasAny`).

- The packs are pure data in `convex/lib/starterPacks.ts`. Each names its actions by canonical ref and its triggers by event subject, and is resolved against the instance's catalog when installed, so the definitions carry the same handler type, function id and `$ref` the flow editor writes.
- A pack's editable fields (message text, scene names, thresholds) accept `{name}` placeholders, such as `{raider}`, which become engine expressions such as `${trigger.data.fromBroadcasterUserName}`. A placeholder a field's items do not offer is refused, and so is any raw `${...}`: the engine resolves every expression in a parameter, `${env.NAME}` included, with no way to escape one. Lengths are checked against Twitch's limits (500 for chat, 140 for markers), counting each placeholder as 25 characters. Scene names are used exactly as typed and only flagged when they start or end with a space.
- The raid pause is off (0) and its field disabled: a delay wait is a task type, not a catalog action, and no engine reports supporting it, while an engine without it fails the run at the wait. `STARTER_FEATURES` in `convex/lib/starterPacks.ts` is where that switches on once an engine can say so.
- Twitch actions (`woofx3_twitch:action:twitch.shoutout`, `twitch.clip`, `twitch.marker`) come from the Twitch platform module, like every trigger the packs bind to. OBS scene switches (`woofx3_obs:action:obs.switch_scene`) come from the OBS platform module. Chat replies (`woofx3:action:chat.reply`) are the engine's own. Availability is read from the instance's action catalog, per item:
  - **Requires the Twitch module**: the catalog has nothing from `woofx3_twitch`, and the item needs a Twitch trigger or action.
  - **Requires the OBS module**: the catalog has nothing from `woofx3_obs`, and the item switches scenes.
  - **Requires engine update**: an engine action is missing, or an ad-break trigger is (`sinceEngineUpdate`), since those arrived in a later engine release.
  - **Requires the Twitch module (update it)** / **Requires the OBS module (update it)**: the module is installed but lacks an action or input the item uses, which means it is an older version.

  The ad break scene is its own pack rather than part of the heads-up so a streamer without OBS can take the chat warning alone. The rest of the pack still installs.
- `starterPacks.install` checks membership, then creates each item through `createWorkflowInEngine` / `createCommandInEngine`, the same helpers behind `workflowActions.createFromDefinition` and `chatCommandActions.createCommand`.
- Installs are idempotent: the `starterPackItems` table records each item as `installing` before the engine call and `installed` with its engine id after, so a repeat or concurrent install skips it. A workflow row also records the create's correlation key; if the engine's echo arrives after the install stopped waiting, `workflowInternal.resolveCorrelation` marks the row installed, and until then the row blocks a retry for five minutes rather than one. An item whose workflow or command has since been deleted counts as not installed again. A command whose name is already taken is skipped as a conflict.

## Create flow (`/stream/workflows/new`)

- A full-width screen with a back link, wrapping **`WorkflowEditor`** (`components/workflows/workflow-editor.tsx`).
- It first asks what starts the workflow, in place: the event list a wait step uses (`EventCatalog` in `components/flow/event-catalog.tsx`, grouped by `waitEventGroups`), searchable and grouped by what each event is about. Chat command events are left out, with a pointer to the Commands page, since a command's steps are its own workflow there (see [Chat commands](./commands.md)); so is any event named with a wildcard, which would need a name filled in.
- Picking an event builds an unsaved tree with `newTriggerTree` (`lib/alert-triggers.ts`), its conditions at their fields' defaults and no order, and opens it in the flow editor below a line naming the trigger, with **Pick a different trigger** to start over. Nothing is saved while editing: `onCommit` keeps the edit.
- **Create workflow** is enabled once the workflow has an action. It creates the workflow through `workflowActions.createFromDefinition`, named after its trigger, and opens it in the editor.

## Editor (`/stream/workflows/:id`)

- A header bar (back, click-to-rename title, enabled badge, **Save**, and a kebab with *View JSON* and *Delete*) above **`WorkflowFlowEditor`** (`components/workflows/workflow-flow-editor.tsx`).
- The screen is keyed by workflow id, so switching workflows resets the in-progress definition rather than carrying the previous one's draft into the next save.
- Saves go through `workflowActions.updateFromDefinition` with `escapeDollarKeys` applied (the engine's `$`-prefixed keys are not legal Convex field names).
- The step list is a tree read from the definition by `definitionToTree` (`client/src/lib/workflow-tree.ts`) and written back by `treeToDefinition`. The round trip is lossless: every task field is carried (ones the editor doesn't use ride along on the step), a task type the editor doesn't know is kept whole, and a workflow is written back in the `dependsOn` / `onTrue` layout it was read in, so a save changes only the edited steps. Only the order of `tasks` is normalised, to reading order. The engine runs a task after its `dependsOn` and after the condition whose `onTrue` / `onFalse` lists it, a step after a condition waits for the branch that ran, and tasks that wait on nothing run in `tasks` order, which reading order keeps. `workflow-tree.roundtrip.test.ts` holds the fixtures, including every starter pack workflow and setup import output.
- A definition the tree can't express without changing it (a step waiting on two others, steps that run side by side, a step in two branches) opens read-only with the reason, rather than being rewritten on save. An Alerts workflow the engine's upgrade could not split into one per trigger is such a definition (see [Alerts: Triggers saved together](./alerts.md#triggers-saved-together)).
- Log and sub-workflow steps, and steps of unknown types, show as rows that can't be edited yet.
- **Steps / Runs** tabs in the header. The step editor stays mounted behind the Runs tab so unsaved edits survive the switch; `?tab=runs` opens the editor on Runs.

### Flow editor

The Steps tab is **`WorkflowFlowEditor`**, which loads the workflow, reads it into the tree and saves it, and renders **`FlowEditor`** (`components/flow/flow-editor.tsx`). `FlowEditor` edits a `WorkflowTree` in place with no dialogs, sheets or popovers:

- A **When** card shows the trigger's name and configured values (`triggerNodeLabel`, `triggerNodeSummary`); **Change** opens the trigger's settings inside the card.
- Steps are numbered rows: 1, 2, 3 at the top and 2.1, 2.2 inside step 2's branches, running on from Then into Otherwise so every number names one step (`stepNumbers` in `lib/flow-tree.ts`). A condition's **Then** and **Otherwise** branches are indented below it, nested to any depth.
- **Add a step** at the end of every list, and a point before each step that shows on hover or Tab, turns into the object-first picker (`ObjectActionPicker`) in place. An action is added with the picker's parameters; Pause adds a 5 second delay wait, Wait for something an event wait with no event yet, Check a condition an empty condition (`stepForPick`).
  - A new action step starts with only the defaults its settings declare and the thing chosen in the picker (`initialParameters`). A setting with no declared default starts empty, because empty means something: Increment counter with no amount adds the counter's own step.
  - The thing chosen fills the action's first `resource_ref` of the object's kind, or the action's only `resource_ref` when it names another kind (a module's own counter-like kind filed under Counters), or the first `scenes` / `alertWidgets` source (`findTargetField`).
  - Once a thing is chosen, only the verbs that can take it are listed, plus those that act on no thing at all (`verbsFor`). Two actions of one object with the same name each end with their module's display name, as "Reset counter (Tally)" (`verbLabel`).
- A collapsed row reads as `stepSummary` (`lib/step-summary.ts`): an action's sentence (below), a condition's rows as a sentence by their labels ("If amount is at least 100 and tier is one of Tier 1 or Tier 2", `conditionsSentence`), a wait as a sentence (see Wait steps below). An action still missing a required setting shows a **Needs:** badge naming those settings (`missingSettings`). Given the thing an action points at (`target`, as the macro pad's action buttons pass it), the sentence names it in that setting's place; an action without a sentence reads the way the picker words it, "Increment Hype counter", without that setting. Log, sub-workflow and unknown steps say they are kept as is on save and have no settings.
- Clicking a row opens its settings inside the row. `StepInlineEditor` (`components/flow/step-inline-editor.tsx`) is the one place that picks a step kind's editor. Actions get `ActionSettingsEditor`, conditions the condition builder and waits `WaitStepEditor` (all below).
- Each row moves up or down within its own list and is removed after an inline confirmation. The last action can't be removed.
- Saving: edits stay local until the open step closes (saved only if it changed; a new step always saves), a remove or move saves at once, and the header's **Save** saves the current draft. A failed save keeps the step open with its edits.

`FlowEditor` is configured per surface rather than forked. A surface whose flow starts from something other than a catalog trigger passes its own **`when`** card, built from the exported `FlowWhenCard` so it looks and opens the same, and **`triggerVariables`**, what the start of the flow hands its steps (offered ahead of earlier steps' outputs by `computeAvailableVariables`). The chat command editor ([Chat commands](./commands.md#the-command-editor)) and an alert trigger's editor ([Alerts](./alerts.md)) are two. The command editor's `onCommit` keeps edits in its draft, since a command saves its steps with its own Save.

### Condition builder

A condition step's rows are edited by **`ConditionBuilder`** (`components/flow/condition-builder.tsx`), with the model in `lib/condition-builder.ts`. Everything opens inside the row:

- **Combine**: "Continue into Then when **all of these are true** / **any of these is true**" sets the step's `conditionLogic` (`and` / `or`). A step that never named one keeps not naming it while it stays on "all".
- **What to check** is picked, not typed. The row's field button opens a searchable list inside the row, grouped by where the value comes from: the trigger's payload, each earlier step's output and condition result, each earlier wait's exports (`computeAvailableVariables`), and **About the viewer**. Each entry shows its kind: Number, Text, Choice, Yes or no, or List.
- **Viewer facts** come from the engine's `listViewerFacts()` (capability `workflow.viewerFacts`), read live through the `viewerFacts.list` Convex action (`hooks/use-viewer-facts.ts`, shapes in `convex/lib/engineViewerFacts.ts`). They are offered only when the trigger's `emits` marks exactly one `string` field `identity: "viewer"`, since only then does the engine fill `${viewer.*}` (`triggerNamesViewer`). Nothing about the viewer is hard-coded: while the list loads the picker says so, and an engine without the method offers none.
- **Comparisons follow the kind** and are only ones the engine evaluates as their label says: a number has is, is not, more/less than, at least/most, between, one of and has a value / is missing; text has is, contains, starts and ends with, matches the pattern and one of; a choice has is, is not and one of; yes or no has is true / is false; a list or object only has a value / is missing.
- **The value control follows the comparison**: one number, two numbers for "is between", values added one at a time for "is one of", toggle pills for a field with known values, and for "matches the pattern" a pattern with a **Try it with** box that says whether a sample matches. A pattern using what the engine's Go regular expressions lack (lookaround, backreferences) is flagged.
- **Known values**: a field's choices are its `emits` `options` (woofx3 `docs/barkloader/modules.md`, Field options), or else the options of the trigger's `select` setting whose `eventPath` names the field (`triggerFieldChoices`). A number field's values are stored as numbers.
- **Numbers stored as text**: a row comparing a number field with a number written as text (saved before values were typed) shows "This compares a number as text" with **Fix it**, which stores the numbers (`comparesNumberAsText`, `fixNumbersAsText`). Nothing is migrated.
- **Type it**: any row can switch to the text it stores, with a free `${…}` field and value and every operator, for what the pickers can't express, such as comparing two variables. A row whose field isn't offered, or whose value is a `${…}` or a shape the pickers can't show, opens that way. Inside a list (an "is one of" item, a "between" bound) a `${…}` is accepted only when the engine resolves list items (capability `workflow.conditionListReferences`).
- A step's single `condition`, which the engine evaluates before `conditions`, shows as the first row and moves into `conditions` on the first edit, which evaluates the same.

### Wait steps

`WaitStepEditor` (`components/flow/wait-step-editor.tsx`, model in `lib/wait-event.ts`) edits a wait inside its row. It exposes what the engine's wait task supports (`workflow/internal/tasks/wait.go`) and nothing else:

- **Wait for something to happen** or **Pause for a set time**. A pause is a delay wait: a duration of up to 24 hours, then the next step runs. Switching between the two starts the other shape fresh, since a delay carries none of an event wait's fields.
- **What to wait for** lists the trigger catalog's events in place, grouped by platform (Twitch) or by what they are about (Chat, Counters, Timers, Queues, from `system.*` taxonomy), with a search. Only bus events are listed: a schedule never reaches a waiting run. An event named with a wildcard (`chat.command.*`) asks which one, because the engine matches a wait's event exactly; until it is named, the row says so and nothing ends the wait.
- The event's own settings read as its trigger sentence (`sentenceParts`), each setting a slot whose picker opens below the sentence. They are saved as conditions on `${event.data.…}` (`fieldValuesToConditions` with the `event` source).
- **Also check its details** adds checks on the event's payload fields only (its `emits`): the engine checks a wait's conditions against the waited event alone. Comparisons follow the field's type. A saved condition the rows can't show (another source, a compound expression, a list or range) stays as written and can be removed.
- Reopening splits the stored conditions back (`splitWaitConditions`): a condition counts as a setting only if the setting would save it back exactly, so nothing is reinterpreted. Conditions are rewritten only when the settings or checks are edited.
- **How many**: the first one (an event wait), a number of them (`count`), until they add up (`sum` of a numeric payload field) or one big enough (`threshold`: the first event whose field is at least the amount). Read from the presence of `aggregation`, as the engine does. The last two are offered only when the event carries a number. A counting wait can limit itself to the first part of the wait (`timeWindow`).
- **If it doesn't happen**: an optional time limit (`timeout`, at least a second) that either carries on with the next step or stops the workflow (`onTimeout`). Without one the wait lasts until the event arrives.
- Later steps are offered the wait's outputs through the variable menu (`waitExportVariables`): whether it happened, whether it gave up, every match, the last match and its payload fields, plus how many happened and their total for a counting wait. Every counting strategy keeps both current, and after a time limit that carries on the payload fields read as empty.
- Collapsed, a wait reads as a sentence (`waitSentence`): "Wait until Hype changes 3 times", "Wait until cheer happens where message contains “hype”, until the total of their bits reaches 500 within 5m", with its time limit below.

### Action sentences

A collapsed action reads as one line, built by `actionSentenceParts` (`lib/action-sentence.ts`). The module declares the template on the action as `sentence` ("Add {amount} to {target}"); the engine sync and the `module.action.registered` webhook carry it into `actionDefinitions.sentence`, and the workflow catalog hands it on with the action. It shares the trigger sentence's grammar and filling (`fillSentence`, `displayValue` in `lib/condition-sentence.ts`). Each `{fieldId}` shows:

- the configured value: an option's label, a counter, scene or placed widget by its name (`actionOptionLabels`), chat text in quotes with its variables as `{name}`
- a switch as its label, or "not" and its label ("visible", "not visible")
- a value taken from earlier by its short name, `{next}` for `${increment.next}`
- while a required setting is empty, the field's `missingText`, or "a counter", marked in amber
- while an optional setting is empty, the field's `missingText` ("the counter's step"), or else "the default amount": the action then uses its own default, so the sentence says what that is rather than leaving a gap

An action declaring no sentence reads as its name and the settings it has: "Increment counter: counter Deaths, amount 5". Empty optional settings are left out of that form.

### Action settings

`ActionSettingsEditor` (`components/flow/action-settings-editor.tsx`) draws each setting with the same renderer every other form uses: `ConfigurationForm` one field at a time, with `configFieldRenderers` from `trigger-config-form.tsx`. Around each one it adds:

- the field's `description` below it, and its `hint` and `examplePayload` behind **More about this setting**, shown in place rather than in a popover
- a message while a required setting is empty, or a number or range is outside its `min` / `max` (`settingProblem` in `lib/action-settings.ts`); the step can still be saved, and its row shows what it needs
- **Use a value from earlier** on every setting that holds one value: the trigger's fields, earlier steps' outputs and earlier waits' outputs (`computeAvailableVariables`), narrowed to numbers for a number and yes/no values for a switch (`variablesForSetting`). Text takes them written in (**Insert a value from earlier**, or type `{`); any other setting swaps its control for a choice of values. Lists, layouts, buttons and themes hold no single value and take none; a layout's widgets take them in their own settings.

A cleared setting is removed from the step's parameters rather than stored empty (`withSetting`), so the action sees it unset. Field types the step renders its own way:

- `asset` lists the files the action's own module ships, narrowed to the field's `kinds` (`moduleAssets.listForModule`), and stores the asset's canonical id. Everywhere else an `asset` still opens the streamer's asset library.
- `layout` reads `surface`: an `alert` layout opens the alert editor; a surface nothing edits per step is shown and kept as it is.
- `button` fires its `action` (`ConfigButtonField`, shared by every form): an `internal` request through `fieldOptions.dispatch`, addressed by the field's declaration (`withFieldOptionsOwner` gives the action its reference), or an `integration`'s account connection through `moduleOAuth.start`.

The step's id stays editable below the settings, as later steps refer to its outputs by it.

### Test run

**Test run** opens `components/workflows/test-run-sheet.tsx`, which runs the *saved* workflow in one of two ways:

- **Sample event** (event triggers whose trigger is in the catalog): the trigger's generated test form (`components/test-events/`), firing the workflow's own event through `useFireTestEvent`. It runs exactly as live — conditions evaluated, `trigger.data` filled — but every other enabled workflow on that event runs too, so the sheet lists them first (`otherWorkflowsOnEvent`) and asks for confirmation naming the real effects (workflows run, overlays play alerts, widgets receive the event, the alert feed records it). Refused for `stream.online` / `stream.offline` (`sampleEventRefusal`): those open and close stream sessions.
- **This workflow only** (default once the engine supports it): `workflowActions.trigger` by engine id, with `options` (wolfymaster/woofx3#172, #174): the sample form's payload as `triggerData`, the trigger's `platform`, and `dryRun` from the **Dry run** switch (on by default). Only this workflow runs, with `trigger.data` filled from the sample. A sample that fails the trigger conditions comes back `conditions_not_met` with the unmet list and a **Run anyway (skip conditions)** button. Without dry run, the sheet warns that its actions happen for real; dry-run steps show their `wouldDo`. Whether the engine takes options comes from its `workflow.testRunOptions` and `workflow.dryRun` capabilities (`hooks/use-test-run-capabilities.ts`); without them the mode runs without sample data and the switch is disabled. The engine shapes are declared locally in `convex/lib/engineTestRun.ts`.

Both fire with the `test` origin (`convex/lib/manualRunOrigin.ts`). The engine does not record runs whose origin is `dashboard`, and any other origin is recorded, so a test run lands in the Runs tab with a full trace. Progress is read from `transientEvents.listByCorrelation` (filtered to this workflow by `testRunProgress`, since a sample event can start several workflows under one key) and then from the recorded run (`workflowRuns.runWithSteps`), both pushed by Convex rather than polled. Transient rows expire after a minute, so the run id and last answer are kept in component state and the recorded run's status takes over (`resolveTestRunOutcome`).

### Runs

`components/workflows/workflow-runs-panel.tsx` lists `workflowRuns.listForWorkflow` newest first: status, start, source (`runOriginLabel`), duration, error. A row opens `pages/workflow-run.tsx`, the same trace as the alert-run page with a back link to the workflow. `listForWorkflow` returns list rows only, with `hasTriggerEvent` in place of the event JSON. **Replay** (settled runs with a recorded trigger event, after a confirmation) replays with the `replay` origin, so the replay is listed too. Dry runs carry a **Dry run** badge here and on the run page. **Stop run** (running runs) calls `workflowActions.cancelRun`. An engine with real cancel stops the run, answers with an `outcome` (`cancelled` / `already_finished`), and settles the row through `workflow.run.updated`, plus a `workflow.run.cancelled` lifecycle event for a caller watching the run (handled in `convex/http.ts`). An older engine only marks its history row — the remaining steps still run — and answers nothing, so for it the action mirrors the status into Convex itself and the confirmation says so.

## Health ("Not running on its own")

The engine refuses a workflow it cannot set up (bad parameters, a step naming a missing action, a trigger that fails to register). Such a workflow stays enabled but never fires by itself, so the UI marks it.

- **Storage:** Convex `workflowHealth`, one row per `(instanceId, engineWorkflowId)`, separate from `workflows` so a report can land before the workflow row does. Rules and payload shapes live in `convex/lib/workflowHealth.ts`.
- **Inputs:** the `workflow.health.snapshot` webhook (sent on engine start and api reconnect; authoritative, anything unlisted is ok), the `workflow.health.changed` webhook (one transition), and the `workflowHealth.resync` action, which calls the engine's `getWorkflowHealth()` with the snapshot's replace-all meaning. A report older than the stored one (by the engine's `since`) is ignored.
- **Resync:** on list-page mount (at most every 5 minutes per instance) and whenever the live engine session connects (at most every minute), throttled server-side in `workflowHealthSyncs`. An engine without the RPC is recorded as `unsupported` and shows nothing.
- **Where it shows:** a red badge with the engine's reason in a popover (`components/workflows/not-running-badge.tsx`) on list rows, the editor header, and the event trigger cards (Alerts, Counters, Timers, Queues), plus a one-line dashboard notice linking to the list. `workflowHealth.listNotRunning` returns only enabled, mirrored workflows.

## Summary

| Area | Role |
|------|------|
| Convex `workflows` + `workflowActions` | List, toggle, rename, save, delete |
| `lib/workflow-display.ts` | Name, description, step count, trigger label shared by list and editor |
| Presets + catalog hook | Guided creation UX |
| `WorkflowFlowEditor` / `FlowEditor` | Inline step editing surface |
| Convex `workflowHealth` | Whether the engine runs each workflow on its own |
| Test run sheet + Runs panel | Try a workflow now; its recorded runs, traces, replay, cancel |
