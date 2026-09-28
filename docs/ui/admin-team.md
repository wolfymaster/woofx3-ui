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

- Members and pending invitations for the selected instance's account, from `convex/accountMembers.ts` and `convex/invitations.ts`. Sharing is Convex-only; the engine is never involved.
- **Invite** (`/team/invite`, `client/src/pages/team-invite.tsx`) invites one person by **Twitch username** (the default) or by **email**, and returns a link for the inviter to share.
  - Twitch: `invitations.lookupTwitchUser` (team managers only) looks the login up on Helix and returns a confirmation card, with partner/affiliate badges, plus moderator/VIP when the account's Twitch link already has a scope that can read them. `invitations.create` takes only the Twitch user id and looks the profile up again on the server, so the stored name and avatar never come from the client. The lookup uses the account's Twitch link token when there is one, and an app token (client credentials) otherwise.
  - An invitation targets exactly one of an email or a platform account (`convex/lib/invitationTarget.ts`). A Twitch invite is accepted only by a user whose `twitch` auth account has the same Twitch user id. Logins can change, so they are only used for display.
- **Accept** (`/auth/accept-invite?token=…`): for a Twitch invite, the page shows whose Twitch account the link is for (`invitations.previewByToken`) and offers Twitch sign-in directly.
