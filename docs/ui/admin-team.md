# Admin and team

**Routes:** `/admin/engine`, `/admin/integrations`, `/admin/storage`, `/admin/appearance`, `/team`
**Primary files:** `client/src/pages/admin/*.tsx`, `client/src/pages/team.tsx`

## Admin (`/admin`)

Reached from the gear icon in the header's utility cluster. It is a section like Stream and Help: the shell renders the sidebar from `ADMIN_ITEMS` in `nav-config.ts`, and `/admin` redirects to `/admin/engine`.

- **Engine** (`admin/engine.tsx`) — engine URL for the selected instance (persisted on the instance record and mirrored into the `$engineUrl` Nanostore), a connection test via the Convex action `engineHealth.testConnection` (server-side, so no CORS), registration status, `EngineSyncCard`, and the Danger Zone that deletes the instance.
- **Integrations** (`admin/integrations.tsx`) — `TwitchIntegrationCard` plus placeholder YouTube/Discord cards and an API-keys card. The Twitch OAuth flow returns to `/admin/integrations`.
- **Storage** (`admin/storage.tsx`) — per-instance storage provider config, via `storage.getConfig` / `storage.setConfig` actions.
- **Appearance** (`admin/appearance.tsx`) — theme mode and color preset through `useTheme`.

The old `/settings` page also had Profile, Notifications, and Security tabs. Those were unwired mockups and were removed; `/settings` and `/settings/:tab` now redirect into `/admin`.

## Team (`/team`)

- UI for **members** and **accounts** with invites and role badges (owner, admin, member, viewer).
- Data is loaded via **TanStack Query** with **`queryFn`s that currently resolve to empty arrays** and a hard-coded `teamId` placeholder — the screen is **presentational / in progress** relative to Convex account sharing (`accounts`, membership APIs).

For production behavior, Team should eventually use the same **account membership model** documented in `CLAUDE.md` (Convex-only; no engine changes for sharing).
