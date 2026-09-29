# Workflows

**Routes:** `/stream/workflows`, `/stream/workflows/new`, `/stream/workflows/:id`
**Primary files:** `client/src/pages/workflows.tsx`, `client/src/components/workflows/basic-editor.tsx`, `client/src/components/workflows/step-list-editor.tsx`, `client/src/lib/workflow-display.ts`, `client/src/hooks/use-workflow-catalog.ts`

`pages/workflows.tsx` serves all three routes and picks one of three screens from the location: the list, the create flow, or the editor.

## List view (`/stream/workflows`)

Modelled on the Chat Commands page: `PageHeader`, an All / Enabled / Disabled tab filter with counts, a search box, a **Create Workflow** button, and a single full-width table.

- Rows come from the Convex `workflows` table for the current instance (`api.workflows.list`).
- Columns: workflow (name + description), trigger, steps, enabled, actions.
- The **trigger** label is resolved against the catalog by `workflowTriggerLabel` (`lib/workflow-display.ts`), which shares `triggerNodeLabel` with the step cards, so a workflow reads the same in the list as in the editor.
- The **enabled** toggle calls `workflowActions.setEnabled` inline; clicking a row (or the pencil) opens the editor; the trash opens the shared delete dialog.
- There is no list rail on this page — the section subnav is the only sidebar, and the table is the list.

## Create flow (`/stream/workflows/new`)

- A full-width screen with a back link, wrapping **`BasicWorkflowEditor`**: a step-based wizard driven by presets (`client/src/lib/workflow-presets.ts`) and `useWorkflowCatalog` for trigger/action definitions.
- On save it navigates to the new workflow's editor.

## Editor (`/stream/workflows/:id`)

- A header bar (back, click-to-rename title, enabled badge, **Save**, and a kebab with *View JSON* and *Delete*) above **`StepListEditor`**, which reads the workflow id from the route itself.
- The screen is keyed by workflow id, so switching workflows resets the in-progress definition rather than carrying the previous one's draft into the next save.
- Saves go through `workflowActions.updateFromDefinition` with `escapeDollarKeys` applied (the engine's `$`-prefixed keys are not legal Convex field names).

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
| `StepListEditor` | Step-by-step editing surface |
| Convex `workflowHealth` | Whether the engine runs each workflow on its own |
