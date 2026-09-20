# Chat commands

Everything in this area is its own route. Nothing is edited in a dialog: a dialog is awkward to work in on a phone, and it has no back button, no link worth sharing and nowhere to put a second level of editing. So each thing you work on is a page, and the only modals left are the confirmations — delete this, discard that — which are a single yes or no rather than somewhere you do work.

## Routes

| Path | Screen | Notes |
|------|--------|-------|
| `/stream/commands` | `pages/commands.tsx` | Commands list |
| `/stream/commands/new` | `pages/command-editor.tsx` | Create a command |
| `/stream/commands/:engineCommandId` | `pages/command-editor.tsx` | Edit a command |
| `/stream/commands/:engineCommandId/steps/:actionId/alert` | `pages/command-step-alert-editor.tsx` | That step's alert content |
| `/stream/commands/groups` | `pages/commands.tsx` | Groups list |
| `/stream/commands/groups/new` | `pages/command-group-editor.tsx` | Create a group |
| `/stream/commands/groups/:engineGroupId` | `pages/command-group-editor.tsx` | Edit a group and its members |

All of them are built by `lib/command-editor-route.ts` — build paths there rather than by hand. They nest under the list so the Commands menu entry stays marked active throughout (`isNavItemActive` matches on the path prefix).

**Order matters when these are registered in `App.tsx`.** The fixed segments (`new`, `groups`, `.../steps/...`) must be matched before `:engineCommandId`, or a literal path is read as a command id. Engine ids are uuids and never collide with them, but the router decides by order regardless.

The Commands/Groups tabs are links, not local state — the group pages need somewhere definite to go back to, and a reload lands where it left off.

## Where the data lives

The engine is the authority. `chatCommands` and `chatCommandGroups` in Convex are read caches, written by `convex/chatCommandActions.ts` from each RPC's own response and by the `command.*` / `group.*` webhooks. Every screen reads them with `useQuery`, and every write goes through a Convex **action** that proxies to the engine — never a direct mutation of the cache.

No screen has a per-id query: each reads the list and finds its row, the same way the Alerts screen finds its workflow in `workflows.list`.

## Drafts

Edits to a command collect in `lib/command-drafts.ts`, a store outside any component keyed by engine command id (or `NEW_COMMAND_KEY` for one being created), with the snapshot they started from. The page has unsaved changes exactly when the value no longer serializes to the baseline.

They live outside the component because editing a step's alert content **leaves the page for its own route**. Page state would be lost on the way there. The alert editor's Done hands its layout back to the draft rather than saving, so the command's own Save covers it like any other edit. This mirrors `lib/event-drafts.ts`, which does the same job for the Alerts screen.

A draft is seeded from the engine's copy the first time a page needs it and dropped on Save and on leaving the editor, so reopening a command always shows what is stored. Nothing is persisted — a reload starts again from the engine's copy. One consequence: a command still being created lives only in its draft, so a deep link to its step's alert editor has nothing to open and says so.

## The command editor

- **Command** — one field. Everything up to the first space is the command word; the rest is the `argumentPattern` (`sr {songTitle}` → command `sr`, pattern `{songTitle}`). Split and rejoined by `lib/command-input.ts`; the engine's extraction rule is `CommandSnapshot.argumentPattern` in `@woofx3/api`.
- **Then** — the steps, see below.
- **Who can use it** — public, or restricted to groups (`GroupMultiSelect`) and named chatters.
- **How it runs** — cooldown, priority, enabled.

Nothing reaches the engine until Save. Back and Cancel drop the draft, asking first when it has changed.

## Steps

A command's steps are the same UI the Alerts screen uses for a trigger's actions — `components/triggers/action-row.tsx` for the numbered rows and `components/triggers/step-tiles.tsx` for the always-visible catalog tiles — wrapped by `components/commands/command-steps-editor.tsx`. An action configured on a command and the same action configured on an alert offer identical controls, since both render the action's declared fields through `TriggerConfigForm`.

`ActionRow` is written against `ActionRowStep`, the little that the two surfaces share (id, handler type, function call, parameters). They store their steps differently — a trigger's is a `ProjectedAction` projected out of a workflow definition, a command's is an `ActionStep` held on the `chatCommands` row — and each keeps its own shape. Three behaviours differ, and the row takes them as optional props:

- **Concurrency.** A trigger can start a step alongside the one above it; a command's steps always run in order, so no "start at the same time" switch is offered there.
- **Order.** A command's step order is the user's to change, so its rows carry move buttons. A trigger's order comes from the workflow, and its rows have none.
- **Alert content.** Each surface passes the route of *its own* alert editor. A step with no such route falls back to the shared `field:layout` renderer, which edits the layout in place.

A step is addressed by `commandStepId` (its `id`, or its position for a step written before ids were assigned). The row keys and the alert route both use it, so the route always names the step it opened — which is why that rule lives in one function rather than two.

## The alert editor

`components/alert-editor/alert-layout-editor.tsx` is the canvas, the widget tiles, the layer list and the selected layer's settings. It edits a copy and knows nothing about where the layout came from: it takes the stored value, a line of context, the variables the owning step can reference, and hands the result back through `onDone` (or `null` when nothing changed).

Two thin pages supply that. `pages/alert-editor.tsx` finds the step in an event's workflow draft; `pages/command-step-alert-editor.tsx` finds it in a command's draft. Each navigates back to its own screen.

The same canvas still opens in a dialog from the workflow builder and anywhere else a module declares a `layout` field, through `configFieldRenderers` in `components/workflows/trigger-config-form.tsx`. That path has not been converted.

## Groups

The Groups list splits built-in groups (seeded per application by the engine) from custom ones. "Used by N commands" is counted client-side from the already-loaded command list; there is no server-side lookup for it.

Each row opens the group's own page. A built-in group's page is read-only — membership of all but `everyone` is owned by the platform membership sync, so a hand edit would be reverted on that chatter's next message, and the engine refuses a rename or a delete outright. `everyone` has no membership rows at all (it matches through a wildcard), so the list marks it rather than linking to a roster that would look empty.

On a custom group's page, name and description are written on Save; **membership is not**. Each add and remove is its own engine call, applied as it is made, because that is the only shape the engine offers. The page says so rather than letting the Save button imply otherwise.
