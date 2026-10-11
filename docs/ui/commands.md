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

Underneath, it is a view over the same headless composition editor as the scene editor (`createCompositionEditor` from `@woofx3/scene/editor`, see [Scenes: The editor](./scenes.md#the-editor)), made with `PROFILES.alert` over a `LocalDocumentSource` holding a copy of the step's layout (`hooks/use-alert-layout-editor.ts`). The editor does the geometry and every change: dragging, the corner resize handle, snapping (to the canvas centre and edges and to other layers, with guides), stacking, undo, and the shared keyboard shortcuts. The inspector's controls call `editor.nodes.patch` (text, size, colour, duration, More settings), `editor.nodes.resize` (Width) and `editor.nodes.moveCenter` (Center, X and Y). How a box follows its content is the widget's trait in the engine's type registry, applied by the editor: a Text layer's height grows with its text and font size, and an Image, Video or Lottie layer keeps its aspect. What the dashboard still computes is only read-outs: a layer's length, the alert's length (its longest layer) and the "longest layer" note, and layer labels (`lib/alert-editor.ts`).

**Timing and behaviors.** Beside Duration, a layer's Timing sets when it plays within the alert: Starts after (seconds after the alert starts) and Stays (until it completes, or for a set time). It is stored as the layer's `activity` behavior anchored to the alert's start; a layer left at "starts with the alert, until it completes" stores none, and setting it back removes the one it had (`activityEditFor` in `lib/behavior-editor.ts`). Below the layer's settings are its Enter and Exit transitions and its effects, the same section as the scene editor's (see [Scenes: Transitions and effects](./scenes.md#transitions-and-effects)); on an alert an effect may also start when the alert starts. Once any layer has an activity, a layer's duration no longer says when the alert ends, so the header's "Plays …" readout, the "longest layer" note and the layers list's per-layer times come from the editor's resolved timeline (`state.timeline.tracks`: the alert's `endMs`, the one timed layer leaving at it, each layer's enter–leave window). With no activities they stay as they were, read from durations.

**Reading and writing the layout.** A step's `layout` is stored in one of two shapes, and `lib/alert-layout.ts` reads both into a composition:

- the composition, `{ layout, widgets, behaviors }`, with widgets keyed by id and stacked by their fractional `z` keys;
- the list every engine plays, `{ width, height, widgets: [{ id, widgetCanonicalId, position, size, settings, … }] }`, stacked in array order. Array order becomes `z` keys; a widget with no name takes its catalog name; rotation, opacity, visibility and lock default to 0, 1, shown and unlocked. An entry with no id, or a repeated one, is dropped, as the engine drops it.

Done writes the composition when the engine lists the `alerts.compositionLayout` capability, and the list otherwise, so an engine that predates compositions keeps playing the alert. The list is lossy: behaviors have nowhere to go, and layers are written bottom first. Done hands back `null`, and Cancel or Back asks nothing, when the editor's document is still deeply equal to the one it opened with.

The same editor (for an alert written into its step) also opens in a dialog from the workflow builder and anywhere else a module declares a `layout` field, through `configFieldRenderers` in `components/workflows/trigger-config-form.tsx` (`components/scenes/alert-layout-field.tsx`): the editor's stage, palette, layers and inspector, with the dialog's own Cancel and Done. Keys reach the editor from the stage itself there, since the page-wide shortcut listener leaves keys inside a dialog to the dialog.

### The alert library

On an engine that lists both `compositions.alerts` and `alerts.compositions` (`ALERT_LIBRARY_CAPABILITIES`), an alert can also live in the engine's library and be played by several steps. A step then holds `{ target, composition, inputs }` in place of `{ target, layout }`: the alert's id and a value for each input the alert declares. It always plays the alert's latest published version. A step holds exactly one of `layout` and `composition`; `lib/alert-library.ts` shapes both (`linkedAlertParams`, `inlineAlertParams`). Without the capabilities none of this is offered and every alert lives in its step.

- **Start from…** in the editor's header (`components/alert-editor/alert-library-dialog.tsx`) lists the library from Convex (`alertCompositions.list`, through `hooks/use-alert-library.ts`, which also reads the engine's whole library into the cache once per page session with `alertCompositionActions.refresh`). **Use** links the step to the alert. **Duplicate** copies it onto the canvas with its inputs filled in from their defaults (`inlineCopyOfLibraryAlert`), an ordinary unsaved edit that Cancel undoes. A library alert is deleted from the same list; the engine refuses while steps link it, and the dialog lists those steps (`describeLinks`).
- **Save to library** (`save-to-library-dialog.tsx`) stores the canvas as a new alert (`alertCompositionActions.create`) and links the step to it. A stored alert refers only to its inputs, never to event data, so each `${...}` on the canvas becomes an input and the step fills it in with the same reference (`libraryAlertOfStep`): a whole-value reference becomes `{ "$input": id }`, one inside text `{{id}}`.
- **A linked step's editor** (`components/alert-editor/linked-alert-editor.tsx`) edits the library alert itself, like a scene: through sceneManager's editor socket (`useSceneEditorSession` with the alert's id; the socket's origin is the engine's overlay URL, since an alert has no preview page), autosaved into a draft, with the scene editor's header controls (`DraftLiveControls`: the Draft / Live toggle, Discard and Publish, disabled rather than hidden in live mode) and its sync status beside the title. Publishing changes every step that uses it. The header says how many steps use it (`alertCompositionActions.listLinks`), and its menu's **Duplicate for this trigger only** (or command) replaces the link with a copy bound with the step's input values. Both editors share `AlertEditorFrame`.
- **The step's form** (`components/triggers/linked-alert-step-form.tsx`, drawn by `ActionRow` for a linked alert step) shows the step's own settings, the linked alert, and a form generated from the alert's inputs (`inputFieldsOf`) with the usual field renderers and variable picker. An input whose value refers to a variable the step's trigger and earlier steps do not provide is flagged (`inputVariableWarnings`), since it would play empty.

Linking, unlinking and input values are edits to the step, kept in the owning screen's draft until its Save like any other; the engine records the link when the workflow or command is saved. Edits to the library alert itself are saved by the editor as they are made.

## Groups

The Groups list splits built-in groups (seeded per application by the engine) from custom ones. "Used by N commands" is counted client-side from the already-loaded command list; there is no server-side lookup for it.

Each row opens the group's own page. A built-in group's page is read-only — membership of all but `everyone` is owned by the platform membership sync, so a hand edit would be reverted on that chatter's next message, and the engine refuses a rename or a delete outright. `everyone` has no membership rows at all (it matches through a wildcard), so the list marks it rather than linking to a roster that would look empty.

On a custom group's page, name and description are written on Save; **membership is not**. Each add and remove is its own engine call, applied as it is made, because that is the only shape the engine offers. The page says so rather than letting the Save button imply otherwise.
