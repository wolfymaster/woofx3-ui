# Unified actions

One step editor for everything that runs steps: chat commands, alerts, workflows and the macro pad. Adding a step asks what should change, then which of the streamer's own things, then the verb. Settings, conditions and waits are edited inside their own row, with no popups or overlays. When the work is done, the separate workflow editor, the basic workflow wizard and the dialog action picker go away.

Feature PRs for this effort target `release/unified-actions` in this repository and in the engine repository.

- Design mockups: <https://claude.ai/artifact/2FkTTiDSrCVe8fGyx652Cr>
- Plan with the decisions table: <https://claude.ai/artifact/EgRbADAL8PEhj4sxEALhWH>

## What the editor is

- **One component, configured per surface.** The command editor, the Alerts trigger cards, the workflow editor and the macro pad embed the same step editor. They differ only in the "When" card above it and in which step kinds they allow.
- **Object first.** The picker offers Chat, Alerts, Scenes, Counters, Timers, Queues, Twitch and Advanced, built from each action's first `taxonomy` entry. After a thing is picked, its verbs read as finished steps ("Add to Hype counter"), and the choice fills the action's matching setting.
- **Inline.** The picker opens in place at "Add a step". A page that needs a full editor, such as an alert layout, opens as a page and comes back.
- **Lossless.** Every setting type in the module spec renders, and conditions and waits offer everything the engine can evaluate and nothing it can't.

## Groundwork

These fix the data the editor reads and bugs found while auditing the spec.

- #281 (merged): actions grouped by purpose; the engine sync keeps each action's taxonomy.
- #304, then #305, then #306 (stacked): parsed settings keep every spec property; condition values keep their type; waits offer only the waited event's fields, and their outputs to later steps.
- Engine: bundled actions declare purpose taxonomy, and the manifest and wait docs are corrected.

## Phase 1: the new editor in the workflow editor

Workflows already store every step kind, so the editor replaces the current step list there with no data model change.

- **Lossless model.** `WorkflowTree` and its flatten/unflatten (`client/src/lib/workflow-tree.ts`) carry per-step `disabled`, `onError`, `timeout`, `conditionLogic`, and the engine's `log` and sub-workflow tasks. A task type the editor doesn't know is kept untouched and shown as one it can't edit, instead of being turned into an empty action.
- **Object-first picker.** "Which one" lists the streamer's counters, timers and queues (`moduleResourceInstances.listByKind`), alerts and scenes, with "create one" inline. The chosen thing fills the action's first setting that matches it: a `resource_ref` of that kind, or a `scenes` / `alertWidgets` source. Search covers verbs, the streamer's own names and the flow blocks. Below the objects: Pause, Wait for something, Check a condition.
- **Inline settings.** All setting types render in the step row, reusing `ConfigurationForm`'s field renderers. Close the gaps the audit found: `description`, `hint` and `examplePayload` shown as inline help; `required` and `min` / `max` enforced with messages; `asset` pickers scoped by `kinds` to the module's own assets; `layout` reads `surface`; `button` fields render; "use a value from earlier" on every field. A collapsed step reads as a sentence: the action's manifest `sentence` filled the way trigger sentences are (configured values with option labels, `missingText` for an empty required setting, a value from an earlier step by its short name), or, when the action declares none, one built from its setting labels.
- **Conditions.** The left-hand side is picked: the trigger's emitted fields, earlier steps' outputs, earlier waits' outputs, facts about the viewer. Operators follow the field's type and the value control follows the operator. Fields with a known set of options offer them to pick from. Rows combine with "all" or "any". Free `${…}` stays under Advanced.
- **Waits.** The event is picked from the trigger catalog. Its own settings appear as a sentence with slots and are saved as `${event.data.…}` conditions. How many: the first one, a count, a running total, or one big enough, with an optional window and a time limit that stops or carries on.
- **Rollout.** Behind a flag on the workflow editor route, replacing `StepListEditor` and its side sheet.
- **Done when** a fixture set of real workflow definitions opens and saves back unchanged apart from intended edits, the tree round trip has unit tests, and a Kernel pass in a preview covers each step kind.

## Phase 2: the macro pad

A run-action button's config modal embeds the picker in single-action mode instead of opening the dialog picker on top of the modal. After picking, it collapses to the chosen action with "Change", and the button label defaults to the step's sentence.

## Phase 3: commands become workflows

Engine, Convex and UI. The command record keeps what only commands have (name, argument pattern, cooldown, priority, visibility, allowed groups and users, enabled) and links to a stored workflow. When a command matches and passes its checks, the commander runs that workflow with the `chat.command.<slug>` event and the captured arguments. Existing commands migrate on engine upgrade. The command editor becomes the "When" card above the unified editor.

Every invocation already emits `chat.command.<slug>`, which other workflows can trigger on, so the command's own workflow must not also trigger on that event. Running it by id from the commander avoids running it twice.

## Phase 4: the Alerts trigger cards

The Alerts page stays the overview; opening a trigger card shows the unified editor with that trigger's sentence as the "When" card. Either keep today's projection (one workflow per event, a condition task per trigger) and edit each trigger's branch, or store each trigger as its own workflow with a migration.

## Phase 5: retire the old screens

Remove the basic workflow wizard, `ActionPickerDialog`, `StepTiles`, the old step list editor and its side sheet, and the projection's refusal rules. Update `docs/ui/workflows.md`, `docs/ui/commands.md` and the Alerts docs.

## Decisions needed

| Decision | Recommendation | Blocks |
|---|---|---|
| How a command runs its workflow | The commander runs it by id, after its checks | Phase 3 |
| Migrating existing commands | Automatic and idempotent on engine upgrade | Phase 3 |
| Alerts storage | One workflow per trigger, if a split migration is acceptable | Phase 4 |
| One automations list or separate pages | Decide after Phase 3 | Phase 5 |
| Step sentences for actions | **Decided:** an optional `sentence` on actions, mirroring the trigger `sentence` (`{fieldId}` placeholders naming the action's own settings, checked at install). Without one, the sentence is built from the setting labels. The bundled actions get sentences in the same change | Phase 1 |
| Options for emitted fields | `options` on `DataShape` fields, borrowing from the trigger's select settings as the fallback | Phase 1 |
| Viewer facts | An engine endpoint listing the facts `${viewer.*}` resolves, with types | Phase 1 |
| Old conditions that store numbers as text | A fix-it prompt in the new editor | Phase 1 |

## Every phase

Ship behind a flag per surface, keep the definition round trip lossless with fixture tests, check each phase in a PR preview with Kernel, and update the docs in the same PR as the behaviour.
