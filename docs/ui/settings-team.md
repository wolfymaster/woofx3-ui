# Settings and team

**Routes:** `/settings`, `/team`  
**Primary files:** `client/src/pages/settings.tsx`, `client/src/pages/team.tsx`

## Settings (`/settings`)

- Tabbed **account / profile / notifications / appearance / engine** style settings.
- **Theme** integrates with `useTheme` and Nanostores where applicable.
- **Engine** tab uses a Convex **`useAction`** (e.g. `engineHealth.testConnection`) to **ping** the configured engine URL from the server, avoiding CORS and keeping checks authoritative.
- Other tabs mix **local state**, **Nanostores** (`$engineUrl`, `$apiKey`), and Convex where user or instance settings are persisted — inspect the file for the exact mutations per tab.

## Team (`/team`)

- UI for **members** and **accounts** with invites and role badges (owner, admin, member, viewer).
- Data is loaded via **TanStack Query** with **`queryFn`s that currently resolve to empty arrays** and a hard-coded `teamId` placeholder — the screen is **presentational / in progress** relative to Convex account sharing (`accounts`, membership APIs).

For production behavior, Team should eventually use the same **account membership model** documented in `CLAUDE.md` (Convex-only; no engine changes for sharing).
