# Alert triggers

Choosing a kind of event on the Alerts rail (`/stream/alerts/<platform>/<kind>…`) replaces the dashboard with that event's **triggers**: what happens when it fires, and when. The same list appears on resource pages (Counters, Timers, Queues), filtered to one instance. See [Shell & routing](./overview.md) for the rail, the dashboard and the test sheet.

## One workflow per trigger

Every trigger is a workflow of its own. Its trigger block names the event, holds the trigger's conditions (`trigger.conditions`) and its place in the list (`trigger.order`); its steps are the workflow's steps. There is nothing on the Alerts side to keep in step with the engine: the list is every workflow on the event (`lib/alert-triggers.ts`, `eventTriggers`), however it was made, so a trigger written in the workflow builder shows here and one written here opens in the builder.

**Every trigger that matches runs.** Nothing stops at the first match: a cheer of 500 bits runs both "at least 100 bits" and "at least 500 bits". Triggers that carry an order run one after another, top to bottom, each starting once the one above it finishes or pauses at a wait, so the alerts they raise queue up in list order. The engine does the ordering (`trigger.order`, documented in the engine's `docs/workflow/execution.md` under Ordered workflows); `eventTriggers` sorts the same way (order, then workflow id). A workflow without an order, such as one made in the builder, runs alongside them as soon as the event arrives, and is listed after them. A new trigger takes the next order and goes to the bottom.

## Cards and the step editor

`components/alerts/event-trigger-list.tsx` lists the triggers as cards. A card reads as the trigger's sentence (the trigger's `sentence` template with its condition values, `lib/condition-sentence.ts`) and its top-level steps; its switch pauses or resumes it (`workflowActions.setEnabled`), and a red badge says when the engine is not running it. Opening a card shows the unified step editor (`components/flow/flow-editor.tsx`) in place, with the sentence as its **When** card (`components/alerts/trigger-when-card.tsx`): each value in it opens its own picker. Steps can be actions, pauses, waits and conditions, like any workflow's.

`components/alerts/trigger-editor.tsx` saves as you go, through `workflowActions.updateFromDefinition`: a step when it closes, the sentence when a picker closes. A condition value nobody has chosen (neither a value nor Any) refuses the save and says which. Changing the sentence rewrites only the conditions its fields own (`withFieldConditions`), so a condition added in the builder survives. The last step can't be removed; delete the trigger instead (an inline confirm, then `workflowActions.deleteByEngineId`).

**New trigger** opens an unsaved card at the bottom with the fields' defaults. It exists only on the page until its first step is saved, because the engine refuses a workflow with no steps; it is then created (`workflowActions.createFromDefinition`, named after its sentence) and switched on.

## Resource pages

`components/resources/resource-trigger-editors.tsx` shows a kind's events (Timer ended, Counter changed…) with a `pin`: only the triggers whose condition holds the instance's field to this instance, a new trigger starts pinned, and the pinned value reads as text in the sentence rather than a picker. `components/resources/resource-action-editors.tsx` lists, across every event, the triggers with a step (inside conditions too) that runs one of the kind's actions on this instance (`stepsAimAt`, `lib/resource-actions.ts` `eventsChangingResource`). Its **Add trigger** asks for the event and the action together, and opens a new trigger on that event's list starting with the step, aimed at the instance and with no other settings, so Increment counter keeps honouring the counter's own "Counts by".

## Triggers saved together

An engine set up before triggers were workflows of their own holds all of an event's triggers in one workflow: a `condition` task per trigger with its actions in `onTrue`, and actions belonging to no condition as a trigger that fires every time. The engine's migration `0065_split_alert_workflows` (engine `db/database/migrate/migrations/alertworkflows`) splits each such user workflow into one workflow per trigger on upgrade: the conditions move onto the workflow trigger, the order is the trigger's place, a paused trigger's workflow is switched off, and the first trigger keeps the workflow's id, so its run history and alerts still lead to it. Every trigger still runs when it matches, in the order it was stored.

A workflow the split can't reproduce exactly is left as it was: a step shared by several triggers (it ran once when any of them matched), "either of" conditions, a step reading another trigger's results, steps set to run at the same time, else branches and waits. Such a workflow is still listed, as one card ("3 cheer triggers saved together", counted by `storedTriggerCount` in `lib/alert-triggers.ts`), but it can't be edited: the card says to delete it and add each trigger again, and links to the workflow editor, which shows it read-only with *View JSON* and *Delete*. Any other workflow on the event the step editor can't read says why and links there too.
