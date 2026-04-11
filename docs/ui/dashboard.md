# Dashboard

**Route:** `/`  
**Primary files:** `client/src/pages/dashboard.tsx`, modules under `client/src/components/dashboard/`

## Purpose

A **configurable workspace** of resizable panels. Users add, remove, reorder, and resize “dashboard modules” (chat, workflow runs, event feed, macro pad). Layout is persisted per instance via Convex (`dashboardLayouts` API).

## Behavior

- **Module registry** maps string types (`chat`, `workflow-runs`, `event-feed`, `macro-pad`) to React components. Unknown types render a fallback message.
- **Persistence:** layout is loaded with `useQuery` and updated with `useMutation` when the user changes modules or panel sizes.
- **Stream status** in the shell header is still a **TODO** in `broadcast-shell.tsx` (placeholder offline/live UI); the comment points to `transport.getStreamStatus` as the intended source.

## Data sources

| Concern | Mechanism |
|---------|-----------|
| Layout | Convex |
| Chat / runs / events / macros inside panels | Mix of TanStack Query and transport-oriented components (see each module file) |

Use this area when you need a **live operations** view without leaving the main shell.
