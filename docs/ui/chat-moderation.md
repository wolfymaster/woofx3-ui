# Chat moderation

| Route | Page | Purpose |
|---|---|---|
| `/stream/moderation` | `pages/moderation.tsx` | The filters the engine runs on chat, and what each does on a hit |

The engine holds the config (engine setting `moderation.config`) and runs it on
every chat line, hosted or local; the page only edits it. It reads and saves
through the `chatModeration` gateway namespace (`useModerationConfig` in
`client/src/engine/hooks/use-chat-moderation.ts`): over Convex, the thin
actions in `convex/chatModerationActions.ts` relay to the engine's
`getModerationConfig` and `setModerationConfig`; the direct gateway calls them
itself. Nothing is stored in Convex.

An engine that does not advertise the `moderation.config` capability reads as
`unsupported`, and the page asks for an engine update instead of a form.

Validation runs live with the engine's own parser, `parseModerationConfig`
from `@woofx3/api/moderation-config`, so the page and the engine cannot
disagree; the engine checks again on save. Banned phrases are checked with
`parsePattern` from `@woofx3/api/moderation-pattern` as they are typed. The
form's helpers (default rules, action toggles with timeout and ban mutually
exclusive, the ban confirmation) are in `client/src/lib/chat-moderation-form.ts`.

The separate Moderation dashboard widget (blocked terms, manual timeouts and
bans, chat modes) is unrelated: it acts on Twitch directly and keeps the
`moderation` namespace.
