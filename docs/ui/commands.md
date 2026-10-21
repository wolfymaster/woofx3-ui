# Chat commands

Everything in this area is its own route. Nothing is edited in a dialog: a dialog is awkward to work in on a phone, and it has no back button, no link worth sharing and nowhere to put a second level of editing. So each thing you work on is a page, and the only modals left are the confirmations — delete this, discard that — which are a single yes or no rather than somewhere you do work.

## Routes

| Path | Screen | Notes |
|------|--------|-------|
| `/stream/commands` | `pages/commands.tsx` | Commands list |
| `/stream/commands/new` | `pages/command-editor.tsx` | Create a command |
| `/stream/commands/:engineCommandId` | `pages/command-editor.tsx` | Edit a command |
| `/stream/commands/groups` | `pages/commands.tsx` | Groups list |
| `/stream/commands/groups/new` | `pages/command-group-editor.tsx` | Create a group |
| `/stream/commands/groups/:engineGroupId` | `pages/command-group-editor.tsx` | Edit a group and its members |

All of them are built by `lib/command-editor-route.ts` — build paths there rather than by hand. They nest under the list so the Commands menu entry stays marked active throughout (`isNavItemActive` matches on the path prefix).

**Order matters when these are registered in `App.tsx`.** The fixed segments (`new`, `groups`) must be matched before `:engineCommandId`, or a literal path is read as a command id. Engine ids are uuids and never collide with them, but the router decides by order regardless.

The Commands/Groups tabs are links, not local state — the group pages need somewhere definite to go back to, and a reload lands where it left off.

## Where the data lives

The engine is the authority. `chatCommands` and `chatCommandGroups` in Convex are read caches, written by `convex/chatCommandActions.ts` from each RPC's own response and by the `command.*` / `group.*` webhooks. Every screen reads them through `engine/hooks/use-chat-commands.ts` (a `useQuery` underneath), and every write goes through a Convex **action** that proxies to the engine — never a direct mutation of the cache.

No screen has a per-id query: each reads the list and finds its row, the same way the Alerts screen finds its workflow in `workflows.list`.

A command's steps are a stored workflow of its own in the engine, whose trigger has type `"command"`: only the command starts it, after its cooldown and permission checks, so it runs once per use however many workflows also listen for the command (the engine's `docs/services/commands-ui.md`, "How a command runs its steps"). The `chatCommands` row holds that workflow's id (`engineWorkflowId`) and its tasks (`steps`), so the editor needs nothing else. A command the engine has not linked to a workflow yet still has its `actions`, which open as the same steps and become the workflow when saved. The workflow also reaches the `workflows` table through the usual sync, but `workflows.list` leaves it out (`lib/commandWorkflow.ts`): it is edited as its command, and listing it under Workflows would offer a second editor for the same steps.

When the engine could not give a command its workflow (its actions failed to convert on upgrade, or the workflow it pointed at is gone), the row carries the engine's reason as `workflowError`. The list marks the command "Steps need attention" and the editor shows the reason above the steps; saving the command sends its steps again, which is how the engine relinks it.

Every save of a command sends its whole `steps`; a save that sends none (turning a command on or off from the list or the command palette) leaves them as they are.

## Drafts

Edits to a command collect in `lib/command-drafts.ts`, a store outside any component keyed by engine command id (or `NEW_COMMAND_KEY` for one being created), with the snapshot they started from. The page has unsaved changes exactly when the value no longer serializes to the baseline.

A draft is seeded from the engine's copy the first time the page needs it and dropped on Save and on leaving the editor, so reopening a command always shows what is stored, and a webhook refreshing the list while the page is open does not overwrite edits in progress. Nothing is persisted — a reload starts again from the engine's copy.

## The command editor

The page is the unified step editor, `components/flow/flow-editor.tsx`, the same one the workflow editor uses (see [Workflows](./workflows.md)). A command differs from a workflow only in what the flow starts from, so the page hands `FlowEditor` two things and nothing else changes:

- **`when`** — the "When" card, `components/commands/command-when-card.tsx`, built from `FlowWhenCard` so it looks and opens like a workflow's. Collapsed, it reads "A chatter types !sr {songTitle}" with who can use it, the cooldown and what each argument captures under it (`lib/command-when.ts`). "Change" opens, in place:
  - **Command** — one field. Everything up to the first space is the command word; the rest is the `argumentPattern` (`sr {songTitle}` → command `sr`, pattern `{songTitle}`). Split and rejoined by `lib/command-input.ts`; the engine's extraction rule is `CommandSnapshot.argumentPattern` in `@woofx3/api`.
  - **Cooldown** and **priority**.
  - **Who can use it** — anyone in chat, or only the groups (`GroupMultiSelect`) and people picked.
  - **Turned on**.
  A command being created opens with the card open.
- **`triggerVariables`** — what the steps can read from the start of the run: the chatter, the message, and each argument (`commandActionVariables` in `lib/command-variables.ts`), followed as the command field is typed.

The steps below are any the flow offers: actions picked object first, pauses, waits and conditions with their branches. The page reads the command's steps into a `WorkflowTree` (`commandFlow` in `lib/command-steps.ts`, through `definitionToTree`) and Save writes the tree's tasks back as `steps` (`commandSteps`), so the round trip is the workflow editor's. Steps the tree can't hold are shown as not editable here and left as they are on Save. Nothing reaches the engine until Save, which writes the command and its steps together: `onCommit` only keeps the edit in the draft. Back and Cancel drop the draft, asking first when it has changed.

A step's alert content opens in the `layout` field's own editor, as it does in the workflow editor.

## The alert editor

`components/alert-editor/alert-layout-editor.tsx` is the canvas, the widget tiles, the layer list and the selected layer's settings. It edits a copy and knows nothing about where the layout came from: it takes the stored value, a line of context, the variables the owning step can reference, and hands the result back through `onDone` (or `null` when nothing changed).

`pages/alert-editor.tsx` supplies that for the Alerts screen: it finds the step in an event's workflow draft and navigates back to that screen.

Underneath, it is a view over the same headless composition editor as the scene editor (`createCompositionEditor` from `@woofx3/scene/editor`, see [Scenes: The editor](./scenes.md#the-editor)), made with `PROFILES.alert` over a `LocalDocumentSource` holding a copy of the step's layout (`hooks/use-alert-layout-editor.ts`). The editor does the geometry and every change: dragging, the corner resize handle, snapping (to the canvas centre and edges and to other layers, with guides), stacking, undo, and the shared keyboard shortcuts. The inspector draws the selected widget's settings from its schema with the same form the scene editor uses (`WidgetSettingsForm` in `components/scenes/widget-settings-panel.tsx`), so a widget shows the same fields in an alert as on a scene, and each change calls `editor.nodes.patch`; size and place are set on the stage. Below the settings it adds the layer's timing within the alert. How a box follows its content is the widget's trait in the engine's type registry, applied by the editor: a Text layer's height grows with its text and font size, and an Image, Video or Lottie layer keeps its aspect. What the dashboard still computes is only read-outs: a layer's length, the alert's length and layer labels (`lib/alert-editor.ts`).

**Timing and behaviors.** Beside Duration, a layer's Timing sets when it plays within the alert: Starts after (seconds after the alert starts) and Stays (until it completes, or for a set time). It is stored as the layer's `activity` behavior anchored to the alert's start; a layer left at "starts with the alert, until it completes" stores none, and setting it back removes the one it had (`activityEditFor` in `lib/behavior-editor.ts`). Below the layer's settings are its Enter and Exit transitions and its effects, the same section as the scene editor's (see [Scenes: Transitions and effects](./scenes.md#transitions-and-effects)); on an alert an effect may also start when the alert starts. Once any layer has an activity, a layer's duration no longer says when the alert ends, so the header's "Plays …" readout, the "longest layer" note and the layers list's per-layer times come from the editor's resolved timeline (`state.timeline.tracks`: the alert's `endMs`, the one timed layer leaving at it, each layer's enter–leave window). With no activities they stay as they were, read from durations.

**Reading and writing the layout.** A step's `layout` is stored in one of two shapes, and `lib/alert-layout.ts` reads both into a composition:

- the composition, `{ layout, widgets, behaviors }`, with widgets keyed by id and stacked by their fractional `z` keys;
- the list every engine plays, `{ width, height, widgets: [{ id, widgetCanonicalId, position, size, settings, … }] }`, stacked in array order. Array order becomes `z` keys; a widget with no name takes its catalog name; rotation, opacity, visibility and lock default to 0, 1, shown and unlocked. An entry with no id, or a repeated one, is dropped, as the engine drops it.

Done writes the composition when the engine lists the `alerts.compositionLayout` capability, and the list otherwise, so an engine that predates compositions keeps playing the alert. The list is lossy: behaviors have nowhere to go, and layers are written bottom first. Done hands back `null`, and Cancel or Back asks nothing, when the editor's document is still deeply equal to the one it opened with.

The same editor (for an alert written into its step) also opens in a dialog from the workflow builder and anywhere else a module declares a `layout` field, through `configFieldRenderers` in `components/workflows/trigger-config-form.tsx` (`components/scenes/alert-layout-field.tsx`): the editor's stage, palette, layers and inspector, with the dialog's own Cancel and Done. Keys reach the editor from the stage itself there, since the page-wide shortcut listener leaves keys inside a dialog to the dialog.

### Alert editor preview

On an engine that lists `compositions.preview`, the stage shows the alert as it will play: sceneManager's composition preview page (see the engine's `docs/services/composition-preview.md`) in a frame behind the stage's layers, at the same place and zoom, playing the real widgets on the real runtime. Nothing about the layout changes. The layers stay where they were as transparent press areas with their outlines and resize handle, and every gesture still goes to the editor. Without the capability, until the page has played the document, or when the page can play nothing (`bind` or `frames-unavailable`), the stand-ins draw as before; a layer the page draws nothing for (`unknown-widget`, `unframed-widget`, `invalid-entry`) keeps its stand-in over the frame.

- **The URL.** `compositionPreview.getUrl` (an action, refused unless the capability is listed) asks the engine for `getCompositionPreviewUrl()` and answers `{ url, expiresAt }`. The browser frames that URL directly, as the scene editor frames its overlay (a convex.site page in between would drop sceneManager's SameSite=Strict session cookie). Nothing is stored in Convex: the token names no composition and only opens the page, which then keeps its own session. The browser holds each instance's URL until shortly before it expires (`createPreviewUrlCache` in `lib/composition-preview.ts`); a framed page that does not say it is listening within a few seconds is framed again with a fresh URL, up to three times, and the stand-ins stay after that.
- **What the page is posted** (`hooks/use-composition-preview.ts`, over `@woofx3/scene/runtime`'s `preview-protocol.ts`). A `load` with profile `alert` once the page is `ready`, and again once the document has held still for 400 ms, since every load remounts the frames. The document goes as the stand-ins show it: each `${…}` reference the step can make shortened to `{name}` (`previewDocumentOf`, the same `toDisplayText` the Text stand-in uses), because the page has no workflow to resolve it. The sample event is `{ type: "alert", data }`, `data` holding each trigger field the step can reference by its short name (`sampleEventOf`, from the step's available variables). A library alert's editor also sends its inputs as `inputs`, each its default or `{id}` where it has none (`libraryPreviewInputs`), so its `{{id}}` references show where the value goes. A drag or resize in progress goes as `overrides` on every editor state change, so the real widget follows the pointer without a remount; the load after the gesture's commit clears them.
- **Transport.** Where the header's canvas readout showed the alert's length, a playing preview shows play / pause, restart, a scrub and the playhead (`composition-preview-frame.tsx`); the phone layout puts the scrub in a thin row under the stage and the buttons where the length was, and the workflow builder's layout dialog puts them beside its buttons. The page owns the playhead: its `playhead` and `finished` reports move the editor's timeline (`editor.timeline.seek`, `play`, `pause`), and the buttons post `play`, `pause`, `seek` and `restart` to the page. A reload after an edit returns to the playhead where it was. A widget's own content (a video, a sound) runs on its own time in its frame and does not seek; restart plays it again.
- **Problems.** Each `problems` report is shown as a toast, once per problem per editor (`unseenProblems`), naming the layer it is about.

### The alert library

On an engine that lists `compositions.alerts` (`ALERT_LIBRARY_CAPABILITIES`), the engine keeps a library of alerts to start from. A step never plays a library alert by id: it always holds its own `{ target, layout }`, and the library only supplies starting points. Without the capability none of this is offered.

A stored alert belongs to no trigger, so it refers to no event data. What it shows from the event goes through its inputs: `{{id}}` inside text, or `{ "$input": id }` as a whole value. `lib/alert-library.ts` converts between the two forms.

- **Start from…** in the editor's header (`components/alert-editor/alert-library-dialog.tsx`) lists the library from Convex (`alertCompositions.list`, through `engine/hooks/use-alert-library.ts`, which also reads the engine's whole library into the cache once per page session with `alertCompositionActions.refresh`). **Use as starting point** copies the alert onto the canvas (`inlineCopyOfLibraryAlert`), an ordinary unsaved edit that Cancel undoes. Each input takes the step's variable of the same name, else its default, else stays as visible `{id}` text, which a toast names. A library alert is deleted from the same list; steps keep the copies they hold.
- **Save to library** (`save-to-library-dialog.tsx`) stores a copy of the canvas as a new alert (`alertCompositionActions.create`). Each `${...}` on the canvas becomes an input named after the variable's last path segment (`libraryAlertOfStep`), which is how a later copy finds the variable again. The step keeps its own alert.
- **The library alert's editor** (`/stream/alert-library/:id`, `pages/library-alert-editor.tsx` and `components/alert-editor/library-alert-editor.tsx`), opened from **Edit** in the library list, edits the stored alert itself like a scene: through sceneManager's editor socket (`useSceneEditorSession` with the alert's id; the socket's origin is the engine's overlay URL, since an alert has no preview page), autosaved into a draft, with the scene editor's header controls (`DraftLiveControls`) and its sync status beside the title. Publishing changes what new copies start from; nothing that already plays changes. Its text fields offer the alert's inputs. Leaving a step's editor for it with unsaved changes asks first. Both editors share `AlertEditorFrame`.

## Groups

The Groups list splits built-in groups (seeded per application by the engine) from custom ones. "Used by N commands" is counted client-side from the already-loaded command list; there is no server-side lookup for it.

Each row opens the group's own page. A built-in group's page is read-only — membership of all but `everyone` is owned by the platform membership sync, so a hand edit would be reverted on that chatter's next message, and the engine refuses a rename or a delete outright. `everyone` has no membership rows at all (it matches through a wildcard), so the list marks it rather than linking to a roster that would look empty.

On a custom group's page, name and description are written on Save; **membership is not**. Each add and remove is its own engine call, applied as it is made, because that is the only shape the engine offers. The page says so rather than letting the Save button imply otherwise.
