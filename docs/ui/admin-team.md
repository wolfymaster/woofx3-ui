# Admin and team

**Routes:** `/admin/engine`, `/admin/integrations`, `/admin/storage`, `/admin/backup`, `/admin/appearance`, `/team`
**Primary files:** `client/src/pages/admin/*.tsx`, `client/src/pages/team.tsx`

## Admin (`/admin`)

Reached from the gear icon in the header's utility cluster. It is a section like Stream and Help: the shell renders the sidebar from `ADMIN_ITEMS` in `nav-config.ts`, and `/admin` redirects to `/admin/engine`.

- **Engine** (`admin/engine.tsx`) — engine URL for the selected instance (persisted on the instance record and mirrored into the `$engineUrl` Nanostore), a connection test via the Convex action `engineHealth.testConnection` (server-side, so no CORS), registration status, `EngineSyncCard`, and the Danger Zone that deletes the instance. A managed instance shows `ManagedEngineCard` instead of the URL form; see [Upgrading a managed engine](#upgrading-a-managed-engine).
- **Integrations** (`admin/integrations.tsx`) — `TwitchIntegrationCard` plus placeholder YouTube/Discord cards and an API-keys card. The Twitch OAuth flow returns to `/admin/integrations`. Under the Twitch card, `TwitchScopeStatus` compares the link's granted scopes with `TWITCH_INTEGRATION_SCOPES` through `twitchScopeHealth` (`convex/lib/twitchScopeHealth.ts`) and names the missing capabilities, or says Twitch refused the token (`platformLinks.authFailedAt`, set when Twitch answers a refresh with "Invalid refresh token" and cleared by a relink or a successful refresh; a refresh outcome is only written while the link still holds the refresh token that was exchanged, so a late answer cannot overwrite a newer relink). The same health drives `TwitchReconnectBanner` under the shell header on every page, dismissible for the browser session per instance and gap. Both offer "Reconnect as @account" through the existing connect flow, which replaces the link, and only to owners and admins (`viewerCanRelink` on `instances.getPlatformLinks`); members are told to ask an admin.
- **Storage** (`admin/storage.tsx`) — per-instance storage provider config, via `storage.getConfig` / `storage.setConfig` actions. A managed engine has no storage settings, so the entry is marked `selfHostedOnly` in `nav-config.ts`: `navItemsFor` drops it from the sidebar and the command palette while the selected instance is managed, and the page itself redirects to `/admin/engine`.
- **Backup** (`admin/backup.tsx`) — export the instance's configuration (workflows, chat commands, command groups, module resources) as a config bundle file, and import one with a preview first. Backed by the engine's `exportConfig` / `previewImport` / `importConfig` (woofx3 `docs/services/config-bundles.md`) through `convex/configBackup.ts`.
  - Access (`configBackupAccess` in `convex/lib/configBundle.ts`): any instance member may export, since a bundle holds no secrets, tokens, module settings or live values, only configuration every member can already read. Exporting group members and per-user grants (usernames, personal data) and importing are owner/admin only.
  - The bundle never becomes a Convex value: workflow definitions can carry `$`-prefixed keys Convex rejects. It crosses the boundary as the file's raw text, split by `chunkText` into strings below Convex's 1 MB per-string limit. The actions stay in the default runtime, whose 16 MiB argument limit covers the engine's 5 MiB bundle limit; a `"use node"` action allows only 5 MiB in total.
  - The browser refuses a file over 5 MiB before reading it; the action checks again. Import re-plans on the engine, so the preview is advisory, and it is best-effort per item: the results table reports each item's outcome.
  - Group members and per-user command grants in a file are applied only when "Also apply group members…" is checked (`applyMembers`, off by default), so a shared file cannot quietly grant access. With it on, the preview's `grants_access` reasons are gathered into a warning above the plan; `privileged_action` reasons (moderation or stream-editing workflows) are highlighted the same way. Unknown reason codes fall back to the code and the engine's message.
- **Appearance** (`admin/appearance.tsx`) — theme mode and color preset through `useTheme`.

The old `/settings` page also had Profile, Notifications, and Security tabs. Those were unwired mockups and were removed; `/settings` and `/settings/:tab` now redirect into `/admin`.

### Upgrading a managed engine

A managed engine runs the release it was built with until its owner or an admin upgrades it from `ManagedEngineCard`. The user picks when, never which release: the target is always the one release the maintenance API offers. The engine is offline for a few minutes, so the card always asks for confirmation; while the channel is live it asks a second time, warning that alerts stay offline until the engine is back. Offered only when the Convex variable `ENGINE_UPGRADES_ENABLED` is `"true"`.

- **Update available.** `provisioning.upgradeInfo` reads the offered release from the maintenance API when the card opens and again whenever the engine's reported release changes. Nothing pushes it.
- **Starting.** `provisioning.upgradeManagedEngine` marks the row `upgrading` and records `upgrade` on it (`beginUpgrade`) before asking the maintenance API for the run, so a report from the run that arrives before the run's id is stored still finds a row expecting it. The `Idempotency-Key` is `<rowId>:upgrade:<toVersion>:<attempt>`. If the maintenance API declines, the row returns to `registered` with the reason in `upgrade.error`; declining is an outcome of the action, not a thrown error. A row still without a run after 15 minutes is returned the same way.
- **Following.** The run's callbacks arrive on `/api/webhooks/maintenance` like provisioning's. Every event of a `redeploy` run goes through `decideRedeployEvent` (`convex/lib/maintenanceUpgrade.ts`), a pure function from row and event to patch:
  - a step report is applied only when it belongs to the row's run; a running step carries the reason it is still waiting, shown under it;
  - `engine.failed` with a `rollbackRunId` switches the row to the rollback run, and the card reads "Restoring" instead of "Upgrading";
  - `engine.failed` that left the engine `ready` returns the row to `registered`: the run failed before it stopped anything;
  - any other `engine.failed` leaves the row `failed`, and **Retry** resumes that run;
  - `engine.ready` returns the row to `registered` with the reported release. The engine is not registered again: its database and credentials survive an upgrade.
- **Result.** The card shows how the last upgrade ended (upgraded, rolled back, or never started) until it is dismissed with `provisioning.acknowledgeUpgrade`.
- **Rest of the app.** While the row is `upgrading`, `EngineUpgradingBanner` shows under the shell header and the status bar reads "Upgrading" rather than "Disconnected" (`useEngineUpgrading`). When the row leaves `upgrading`, the transport reconnects at once instead of waiting out its backoff (`useReconnectAfterUpgrade`).

## Team (`/team`)

- Members and pending invitations for the selected instance's account, from `convex/accountMembers.ts` and `convex/invitations.ts`. Sharing is Convex-only; the engine is never involved.
- **Invite** (`/team/invite`, `client/src/pages/team-invite.tsx`) invites one person by **Twitch username** (the default) or by **email**, and returns a link for the inviter to share.
  - Twitch: `invitations.lookupTwitchUser` (team managers only) looks the login up on Helix and returns a confirmation card, with partner/affiliate badges, plus moderator/VIP when the account's Twitch link already has a scope that can read them. `invitations.create` takes only the Twitch user id and looks the profile up again on the server, so the stored name and avatar never come from the client. The lookup uses the account's Twitch link token when there is one, and an app token (client credentials) otherwise.
  - An invitation targets exactly one of an email or a platform account (`convex/lib/invitationTarget.ts`). A Twitch invite is accepted only by a user whose `twitch` auth account has the same Twitch user id. Logins can change, so they are only used for display.
- **Accept** (`/auth/accept-invite?token=…`): for a Twitch invite, the page shows whose Twitch account the link is for (`invitations.previewByToken`) and offers Twitch sign-in directly.
