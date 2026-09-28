# Workflows

**Routes:** `/stream/workflows`, `/stream/workflows/new`, `/stream/workflows/:id`, `/stream/starter-packs`
**Primary files:** `client/src/pages/workflows.tsx`, `client/src/components/workflows/basic-editor.tsx`, `client/src/components/workflows/step-list-editor.tsx`, `client/src/lib/workflow-display.ts`, `client/src/hooks/use-workflow-catalog.ts`

`pages/workflows.tsx` serves all three routes and picks one of three screens from the location: the list, the create flow, or the editor.

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

Curated sets of workflows and chat commands (raid welcome, follower thanks, sub and gift hype, cheer thanks, handy commands, BRB scene) that a new streamer installs in one click. The dashboard shows a banner linking here while the instance has no workflows (`api.workflows.hasAny`).

- The packs are pure data in `convex/lib/starterPacks.ts`. Each names its actions by canonical ref and its triggers by event subject, and is resolved against the instance's catalog when installed, so the definitions carry the same handler type, function id and `$ref` the create wizard writes.
- A pack's editable fields (message text, scene names, thresholds) accept `{name}` placeholders, such as `{raider}`, which become engine expressions such as `${trigger.data.fromBroadcasterUserName}`. A placeholder a field's items do not offer is refused, and so is any raw `${...}`: the engine resolves every expression in a parameter, `${env.NAME}` included, with no way to escape one. Lengths are checked against Twitch's limits (500 for chat, 140 for markers), counting each placeholder as 25 characters. Scene names are used exactly as typed and only flagged when they start or end with a space.
- The raid pause is off (0) and its field disabled: a delay wait is a task type, not a catalog action, and no engine reports supporting it, while an engine without it fails the run at the wait. `STARTER_FEATURES` in `convex/lib/starterPacks.ts` is where that switches on once an engine can say so.
- Items whose actions the catalog lacks show **Requires engine update**; items whose Twitch trigger is missing show **Requires the Twitch module**. The rest of the pack still installs.
- `starterPacks.install` checks membership, then creates each item through `createWorkflowInEngine` / `createCommandInEngine`, the same helpers behind `workflowActions.createFromDefinition` and `chatCommandActions.createCommand`.
- Installs are idempotent: the `starterPackItems` table records each item as `installing` before the engine call and `installed` with its engine id after, so a repeat or concurrent install skips it. A workflow row also records the create's correlation key; if the engine's echo arrives after the install stopped waiting, `workflowInternal.resolveCorrelation` marks the row installed, and until then the row blocks a retry for five minutes rather than one. An item whose workflow or command has since been deleted counts as not installed again. A command whose name is already taken is skipped as a conflict.

## Create flow (`/stream/workflows/new`)

- A full-width screen with a back link, wrapping **`BasicWorkflowEditor`**: a step-based wizard driven by presets (`client/src/lib/workflow-presets.ts`) and `useWorkflowCatalog` for trigger/action definitions.
- On save it navigates to the new workflow's editor.

## Editor (`/stream/workflows/:id`)

- A header bar (back, click-to-rename title, enabled badge, **Save**, and a kebab with *View JSON* and *Delete*) above **`StepListEditor`**, which reads the workflow id from the route itself.
- The screen is keyed by workflow id, so switching workflows resets the in-progress definition rather than carrying the previous one's draft into the next save.
- Saves go through `workflowActions.updateFromDefinition` with `escapeDollarKeys` applied (the engine's `$`-prefixed keys are not legal Convex field names).

## Summary

| Area | Role |
|------|------|
| Convex `workflows` + `workflowActions` | List, toggle, rename, save, delete |
| `lib/workflow-display.ts` | Name, description, step count, trigger label shared by list and editor |
| Presets + catalog hook | Guided creation UX |
| `StepListEditor` | Step-by-step editing surface |
