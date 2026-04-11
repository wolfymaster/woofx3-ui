# Modules

**Routes:** `/modules`, `/modules/installed`, `/modules/install`  
**Primary files:** `client/src/pages/modules.tsx`, `client/src/pages/module-install.tsx`

## Catalog and install UI (`/modules`)

- **Convex** holds the **module repository** (published zips, manifests, tags). The page lists catalog entries and merges in **installation state** from the engine via **`WoofxTransport`** (`transport` from `@/lib/transport`) — e.g. which modules are installed or enabled on the connected instance.
- Tabs / filters support browsing by category, search, and grid vs list views.
- **Install** flows navigate to `/modules/install` or trigger engine operations depending on the action.

## Custom upload (`/modules/install`)

- Users can upload a **ZIP**, inspect a **manifest**, browse virtual file trees (Monaco for file contents), and run validation checks before confirming install.
- Uses Convex mutations tied to the current **instance** for repository or install orchestration (see page imports for the exact `api.*` calls).

## Mental model

- **Catalog & metadata** → Convex (multi-tenant, shared across users where appropriate).
- **Runtime modules on the engine** → transport / engine API; the UI reflects engine state in addition to Convex rows.

When adding features, keep **engine truth** (what is actually running) separate from **UI/catalog truth** (what is published or pending).
