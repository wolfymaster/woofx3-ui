# Workflows: List View + Multi-Select Batch Operations

**Status:** Draft
**Date:** 2026-05-09
**Area:** `client/src/pages/workflows.tsx`, `convex/workflowActions.ts`

## Summary

Bring the workflows page to feature parity with the modules page on browsing affordances, and add multi-select for batch operations. Two changes:

1. Add a grid/list view toggle, mirroring the pattern already established in `pages/modules.tsx`.
2. Add multi-select with a bulk action bar supporting **Delete**, **Enable**, and **Disable** across the selected set.

## Motivation

Workflows are the heaviest user-managed entity in the UI. Once a streamer has more than a handful, the 2-column card grid becomes scroll-heavy, and one-by-one deletion is the only way to clean up after experiments. The modules page solved the same browsing problem with a list view; the workflows page should adopt the same affordance and add multi-select since enable/disable/delete are routinely applied to a group of related workflows.

## Non-Goals

- Shift-click range selection.
- Keyboard shortcuts (Escape to clear, etc.).
- Persisted view preference across sessions (matches modules.tsx today).
- Engine-side batch RPCs. The engine already exposes per-id endpoints; we loop server-side in the Convex action.

## Current State

`client/src/pages/workflows.tsx` renders a fixed 2-column card grid (`grid-cols-1 lg:grid-cols-2`). Each `WorkflowCard` carries an enable/disable `Switch` and a `MoreHorizontal` dropdown with **Edit** and **Delete** entries. Delete uses a confirmation `AlertDialog`. Search and a `statusFilter` ("all" | "enabled" | "disabled") sit in the controls row.

`convex/workflowActions.ts` exposes per-id actions:

- `deleteByEngineId({ instanceId, engineWorkflowId })` — single delete, mirrored locally via `internal.workflowInternal.deleteFromWebhook`.
- `setEnabled({ instanceId, engineWorkflowId, isEnabled })` — single toggle, mirrored via `internal.workflowInternal.setEnabledLocal`.

The modules page (`pages/modules.tsx`) already implements the grid/list toggle, including a `Toggle` component pair backed by `Grid3X3` and `List` icons, and a `viewMode: "grid" | "list"` state. We will mirror this pattern.

## Design

### View toggle

Add a view toggle group to the controls row in `pages/workflows.tsx`, placed to the right of the existing status `Select`. Match `modules.tsx` exactly — same `Toggle` component, same icons, same `data-testid` shape.

```tsx
const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
```

Default is `"grid"` so existing users see no behavior change.

#### Grid view

Unchanged from today: `grid grid-cols-1 lg:grid-cols-2 gap-4`, rendering `WorkflowCard` per row. Workflow cards have more content per item than module cards (description + step count + enabled state), so we do not increase column count.

#### List view

Single `<Card>` container with rows, ported directly from the modules list pattern:

```
border-b last:border-0 hover-elevate, padding p-4, flex items-center gap-4
```

Per-row layout (left → right):

1. Selection checkbox (always visible in list view).
2. Workflow icon tile (`h-10 w-10 rounded-lg bg-primary/10 text-primary` when enabled; `bg-muted text-muted-foreground` when disabled).
3. Name + description block. Name truncates; description truncates to one line.
4. Step-count chip: `<Zap />` + `{steps} steps`. Hidden below `sm`.
5. Status badge ("Active" / "Inactive"). Hidden below `md`.
6. Enable/disable `Switch` (with the same `togglingId` spinner state).
7. `MoreHorizontal` dropdown — Edit / Delete, identical to the card menu.

Clicking the row body navigates to `/workflows/{engineWorkflowId}`. The checkbox, switch, and dropdown trigger zones use `onClick={(e) => e.stopPropagation()}`.

### Selection state

```tsx
const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
```

Selection is keyed by `engineWorkflowId` (stable, engine-authoritative).

#### Checkbox placement

- **Grid view:** Checkbox in the top-left of each card. Hidden via `opacity-0` by default, revealed by `group-hover:opacity-100` OR forced visible when `selectedIds.size > 0`. When the card itself is selected, it stays "checked" with a faint ring (`ring-2 ring-primary/40`) to make selected items obvious among unselected ones.
- **List view:** Checkbox at the start of each row, always visible.

Use the existing `Checkbox` component from `@/components/ui/checkbox`. (Verify it exists during implementation; if missing, add via Shadcn pattern.)

#### Selection across filters

`selectedIds` is **not** automatically pruned when search/status filters change. This lets a user search → select → search again → add to the selection. However, bulk action buttons operate only on the **intersection of `selectedIds` with currently-visible rows**. The bulk bar shows the visible-and-selected count to make this explicit.

When the reactive `workflows` query removes an id (because it was deleted server-side), prune that id from `selectedIds` in a `useEffect` keyed on the workflow list.

### Bulk action bar

Renders above the grid/list, only when `selectedIds.size > 0`. Sticks to the top of the scroll container so it remains reachable while scrolling through long lists.

Layout:

```
┌────────────────────────────────────────────────────────────────────────────┐
│ [✕] N selected · Select all visible · Clear      [Enable] [Disable] [Delete] │
└────────────────────────────────────────────────────────────────────────────┘
```

- `[✕]` — clears the selection.
- `N selected` — count of items in `selectedIds` that are also in the visible filtered list.
- `Select all visible` — adds every currently-visible `engineWorkflowId` to the selection. Toggles to `Deselect all visible` when every visible row is already selected.
- `Clear` — same as `[✕]`.
- `Enable` / `Disable` — call `setEnabledMany` (see below).
- `Delete` — opens an `AlertDialog`: *"Delete N workflows? This action cannot be undone."* Confirming calls `deleteManyByEngineIds`.

Buttons disable while any bulk action is in flight (`isBulkActing` state).

### New Convex actions

Add to `convex/workflowActions.ts`:

```ts
export const deleteManyByEngineIds = action({
  args: {
    instanceId: v.id("instances"),
    engineWorkflowIds: v.array(v.string()),
  },
  handler: async (ctx, { instanceId, engineWorkflowIds }) => {
    const bundle = await requireInstanceContext(ctx, instanceId);
    const succeeded: string[] = [];
    const failed: { engineWorkflowId: string; reason: string }[] = [];
    for (const id of engineWorkflowIds) {
      try {
        const rpc = createEngineRpcSession<EngineApi>(bundle.url, bundle.clientId, bundle.clientSecret);
        const ok = await rpc.deleteWorkflow(id);
        if (!ok) {
          failed.push({ engineWorkflowId: id, reason: "Engine refused the delete" });
          continue;
        }
        await ctx.runMutation(internal.workflowInternal.deleteFromWebhook, {
          instanceId,
          engineWorkflowId: id,
        });
        succeeded.push(id);
      } catch (err) {
        failed.push({
          engineWorkflowId: id,
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return { succeeded, failed };
  },
});

export const setEnabledMany = action({
  args: {
    instanceId: v.id("instances"),
    engineWorkflowIds: v.array(v.string()),
    isEnabled: v.boolean(),
  },
  handler: async (ctx, { instanceId, engineWorkflowIds, isEnabled }) => {
    const bundle = await requireInstanceContext(ctx, instanceId);
    const succeeded: string[] = [];
    const failed: { engineWorkflowId: string; reason: string }[] = [];
    for (const id of engineWorkflowIds) {
      try {
        const rpc = createEngineRpcSession<EngineApi>(bundle.url, bundle.clientId, bundle.clientSecret);
        const result = await rpc.setWorkflowEnabled(id, isEnabled);
        await ctx.runMutation(internal.workflowInternal.setEnabledLocal, {
          instanceId,
          engineWorkflowId: id,
          isEnabled: result.isEnabled,
        });
        succeeded.push(id);
      } catch (err) {
        failed.push({
          engineWorkflowId: id,
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return { succeeded, failed };
  },
});
```

Both follow the structure of the existing `deleteByEngineId` and `setEnabled` actions exactly. Each iteration opens a fresh capnweb HTTP batch session because sessions are single-use.

#### Why server-side looping (and not engine-batch)

- The capnweb HTTP batch session is single-use, so a per-id RPC pattern is unavoidable until the engine grows a real batch RPC.
- Looping inside one Convex action means one client→Convex round trip regardless of selection size.
- Mirror mutations stay co-located with the engine call inside the same action context.
- Failures are partitioned per-id, so partial-success is reportable.

### Result feedback

After a bulk action returns `{ succeeded, failed }`, the page emits a toast:

| Outcome | Variant | Title | Description |
|---|---|---|---|
| All success | default | `N workflows {deleted/enabled/disabled}.` | — |
| Partial | default | `M of N workflows {deleted/enabled/disabled}.` | First 3 failure reasons, joined; `… +K more` if more. |
| All fail | destructive | `Failed to {delete/enable/disable} workflows.` | First failure reason; `… +K more` if applicable. |

The `workflows` Convex query is reactive, so the grid/list updates without a manual refetch.

After a bulk action completes, prune `selectedIds` to ids that are still present in the workflow list (delete removes; enable/disable preserves). Done in a `useEffect` keyed on `workflows`.

## Test Plan

Manual:

1. Toggle between grid and list view; both should render the same workflows with the same actions.
2. In list view, click a row body — should navigate to detail. Click the row's checkbox — should select without navigating.
3. In grid view, hover a card — checkbox appears. Click it — card stays "selected" (ring), checkbox stays visible after pointer leaves.
4. Search filters items. Selected items that fall out of view stay selected; bulk bar count drops to "visible-and-selected".
5. Bulk **Enable** on a mixed set of enabled+disabled — all become enabled; reactive UI updates; toast confirms count.
6. Bulk **Disable** — same.
7. Bulk **Delete** — confirmation dialog; on confirm, workflows disappear; selection is pruned; toast confirms count.
8. Force a partial failure (point one engine deletion at a non-existent id by manual edit during testing, or stop the engine mid-batch) — toast shows mixed counts and reasons.

Automated: none required for this scope (no testing scaffold for pages/Convex actions in this repo today).

## Risks

- **Selection bar layout on narrow widths.** Bulk bar contents must wrap or condense on small viewports. Use `flex flex-wrap gap-2` and consider stacking the buttons.
- **Reactive pruning races.** If a user kicks off a bulk delete and a webhook arrives for an unrelated workflow change mid-flight, the `useEffect` prune step must not drop ids that are still in flight. Mitigation: prune only ids that are no longer present in the latest `workflows` array; do not pre-emptively remove ids the user just clicked Delete on.
- **`Checkbox` component existence.** If `client/src/components/ui/checkbox.tsx` is missing, add via the Shadcn pattern before wiring selection.
