# Workflows

**Routes:** `/workflows`, `/workflows/new`, `/workflows/:id`  
**Primary files:** `client/src/pages/workflows.tsx`, `workflows-new.tsx`, `workflow-builder.tsx`, `client/src/components/workflows/basic-editor.tsx`, `client/src/hooks/use-workflow-catalog.ts`

## List view (`/workflows`)

- Loads **workflow documents** for the current instance from **Convex** (`workflows` table).
- Cards show name, description, enabled flag, and actions: open editor, duplicate, delete, toggle enabled.
- **Templates** may be offered via Convex (`workflowTemplates` / related APIs — see page for current wiring).

## Create flow (`/workflows/new`)

- Wraps **`BasicWorkflowEditor`**: a **step-based wizard** driven by **presets** (`client/src/lib/workflow-presets.ts`) and **`useWorkflowCatalog`** for trigger/action definitions.
- Saving uses **TanStack Query** + **`apiRequest`** (`client/src/lib/queryClient.ts`) rather than a Convex mutation in the path inspected for this doc — i.e. this path targets the **engine HTTP API** style client. When consolidating on Convex, this is a likely migration point.

## Visual builder (`/workflows/:id`)

- **React Flow** canvas for nodes (triggers, actions, conditions, delays) with a **node library** sidebar.
- **`useWorkflowCatalog`** supplies trigger/action metadata (including icons resolved via `resolveLucideIcon`).
- Treat this as the **rich editor** surface; persistence details should be confirmed in the page implementation when changing save/load behavior.

## Summary

| Area | Role |
|------|------|
| Convex | List workflows, templates, catalog-backed metadata |
| Presets + catalog hook | Guided creation UX |
| React Flow builder | Graph editing experience |
| `apiRequest` (where used) | Engine-aligned HTTP calls for some writes |
