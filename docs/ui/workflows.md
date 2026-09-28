# Workflows

**Routes:** `/stream/workflows`, `/stream/workflows/new`, `/stream/workflows/:id`, `/stream/workflows/:id/runs/:engineRunId`
**Primary files:** `client/src/pages/workflows.tsx`, `client/src/components/workflows/basic-editor.tsx`, `client/src/components/workflows/step-list-editor.tsx`, `client/src/lib/workflow-display.ts`, `client/src/hooks/use-workflow-catalog.ts`

`pages/workflows.tsx` serves the first three routes and picks one of three screens from the location: the list, the create flow, or the editor.

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
- **Steps / Runs** tabs in the header. The step editor stays mounted behind the Runs tab so unsaved edits survive the switch; `?tab=runs` opens the editor on Runs.

### Test run

**Test run** opens `components/workflows/test-run-sheet.tsx`, which runs the *saved* workflow in one of two ways:

- **Sample event** (event triggers whose trigger is in the catalog): the trigger's generated test form (`components/test-events/`), firing the workflow's own event through `useFireTestEvent`. It runs exactly as live — conditions evaluated, `trigger.data` filled — but every other enabled workflow on that event runs too, so the sheet lists them first (`otherWorkflowsOnEvent`) and asks for confirmation naming the real effects (workflows run, overlays play alerts, widgets receive the event, the alert feed records it). Refused for `stream.online` / `stream.offline` (`sampleEventRefusal`): those open and close stream sessions.
- **This workflow only** (default once the engine supports it): `workflowActions.trigger` by engine id, with `options` (wolfymaster/woofx3#172, #174): the sample form's payload as `triggerData`, the trigger's `platform`, and `dryRun` from the **Dry run** switch (on by default). Only this workflow runs, with `trigger.data` filled from the sample. A sample that fails the trigger conditions comes back `conditions_not_met` with the unmet list and a **Run anyway (skip conditions)** button. Without dry run, the sheet warns that its actions happen for real; dry-run steps show their `wouldDo`. Whether the engine takes options is probed once per instance per session (`workflowActions.testRunCapabilities`, `hooks/use-test-run-capabilities.ts`) with a call that cannot start a run on any engine; on an older engine the mode runs without sample data and the switch is disabled. The engine shapes are declared locally in `convex/lib/engineTestRun.ts`.

Both fire with the `test` origin (`convex/lib/manualRunOrigin.ts`). The engine does not record runs whose origin is `dashboard`, and any other origin is recorded, so a test run lands in the Runs tab with a full trace. Progress is read from `transientEvents.listByCorrelation` (filtered to this workflow by `testRunProgress`, since a sample event can start several workflows under one key) and then from the recorded run (`workflowRuns.runWithSteps`), both pushed by Convex rather than polled. Transient rows expire after a minute, so the run id and last answer are kept in component state and the recorded run's status takes over (`resolveTestRunOutcome`).

### Runs

`components/workflows/workflow-runs-panel.tsx` lists `workflowRuns.listForWorkflow` newest first: status, start, source (`runOriginLabel`), duration, error. A row opens `pages/workflow-run.tsx`, the same trace as the alert-run page with a back link to the workflow. `listForWorkflow` returns list rows only, with `hasTriggerEvent` in place of the event JSON. **Replay** (settled runs with a recorded trigger event, after a confirmation) replays with the `replay` origin, so the replay is listed too. Dry runs carry a **Dry run** badge here and on the run page. **Stop run** (running runs) calls `workflowActions.cancelRun`. An engine with real cancel stops the run, answers with an `outcome` (`cancelled` / `already_finished`), and settles the row through `workflow.run.updated`, plus a `workflow.run.cancelled` lifecycle event for a caller watching the run (handled in `convex/http.ts`). An older engine only marks its history row — the remaining steps still run — and answers nothing, so for it the action mirrors the status into Convex itself and the confirmation says so.

## Summary

| Area | Role |
|------|------|
| Convex `workflows` + `workflowActions` | List, toggle, rename, save, delete |
| `lib/workflow-display.ts` | Name, description, step count, trigger label shared by list and editor |
| Presets + catalog hook | Guided creation UX |
| `StepListEditor` | Step-by-step editing surface |
| Test run sheet + Runs panel | Try a workflow now; its recorded runs, traces, replay, cancel |
