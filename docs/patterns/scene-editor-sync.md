# Scene editor sync

## Context

Several people can edit one scene at once, in several tabs, while the engine itself changes the scene (a workflow shows or hides a widget). Each scene has two documents in sceneManager: the **published** scene that OBS shows and the **draft** the editor stages. Edits travel over a socket that drops, to an engine that restarts. An editor must never lose an edit it showed as saved, never apply one twice, and say exactly what happened to anything it could not deliver.

The sync code is shared with the engine and lives in the engine's api package, `@woofx3/api/scene-editor` (woofx3 `shared/clients/typescript/api/scene-editor/`):

| Module | What it holds |
|---|---|
| `document.ts` | The scene document, json0 ops, op validation, diff, size limits. `client/src/lib/scene-document.ts` re-exports it. |
| `protocol.ts` | Protocol 2 messages, close codes, nack codes. |
| `sequencer.ts` | The server's pure decision step: transform, validate, commit. sceneManager runs it; UI tests run it too. |
| `rebase.ts` | Moving pending edits onto a snapshot field by field. |
| `client.ts` | `SceneSyncClient`, framework-free: socket, clock, ids and session opening are injected. |

## Decision

ShareDB's protocol semantics, not the `sharedb` library: one ordered queue per editor across both versions, one item in flight at a time (stop-and-wait), and the server deciding every item exactly once.

- **One queue, both versions.** Edits to the draft, live edits to the published scene, **Publish** and **Discard** are all items in one FIFO queue. Publish includes every edit queued before the click because it is behind them in the queue, not because anything waits or locks.
- **Commands have no local effect.** Publish and Discard show a spinner until their result arrives as an entry like anyone else's change; edits queued behind them are transformed against it. Edits made after a Discard survive on the reset draft where the widget they touch still exists.
- **Every item has an identity.** An item carries `(clientId, seq)`. The server keeps a per-editor watermark (the last seq it decided and how) in the same write as the documents, so a resend after a dropped socket or an engine restart is answered from the watermark instead of being applied again.
- **Exactly one terminal answer per item.** The server prepares a change purely, then commits it in a synchronous step that cannot throw. A refusal (`nack`) guarantees nothing changed. A committed item's answer is its own entry, broadcast to every editor.
- **Reconnect resolves everything.** `hello` names the last entry the editor applied; `welcome` answers with the entries it missed (catch-up) or a snapshot, plus the editor's watermark, which settles the item that was in flight when the socket dropped.
- **Edits are functions of the current document.** `client.edit(version, doc => nextDoc)` diffs the result against the document the client holds at that moment, so an edit never carries a stale copy of the scene back over someone else's change.

Rejected: the `sharedb` library (it wants to own storage, has no cross-document commands, and its Node stream transport is a risk under Bun); CRDTs (more machinery than two JSON documents need); per-field last-writer-wins everywhere (loses concurrent typing in one field, so it is used only when rebasing onto a snapshot).

## How the client works

The client keeps:

- `server`: the documents exactly as the server confirmed them, with the head entry `{v, id}`.
- `inflight`: at most one sent item, with its frozen `seq` and the `base` it was sent against.
- `queue`: items not sent yet. Consecutive edits of one version compose into one item.
- `local`: what the editor shows, always `server.docs` with every pending edit applied in order.

An entry from someone else is transformed against the in-flight item and the queue (the ShareDB double transform) and applied to `local`. A `nack invalid` rolls the edit back by applying its inverse as a remote op and is reported. `unavailable` resends the same seq with backoff while editing goes on. A snapshot welcome rebases pending edits field by field and, if the server lost history it had confirmed (an engine crash), reports that.

`stop()` keeps delivering for up to ten seconds, reconnecting as needed, then reports whatever is left: edits never sent, edits sent but not confirmed, a command that may have run. `abandon()` closes at once and reports nothing; it is for a scene deleted on purpose.

### Invariants

Checked by `assertSyncInvariants` in the engine's tests and simulation:

- **I1** At most one item is in flight, and only it has a seq. A resend keeps its seq and never merges anything into it.
- **I2** `local[v]` is `server.docs[v]` with the edit ops of the in-flight item and the queue applied in order. Commands contribute no ops.
- **I3** Every item leaves exactly once: confirmed, rejected and reported, or reported when the client closes or the scene is gone.
- **I4** A reply whose seq is not the in-flight item's is ignored.
- **I5** An edit is a function of the current local document.

The server side keeps its own: all changes to a scene are serialized; commit is synchronous and cannot throw; the reply is decided and sent inside the scene's serial section; the watermark changes in the same step as the decision; documents and editor state persist in one write; welcome and listener registration are atomic.

## Protocol 2 in brief

The editor socket is `GET /scene/{sceneId}/edit?token=…&protocol=2`, at sceneManager's public origin. The token comes from `getSceneEditorSession` (through `sceneActions.getSceneEditorSession`). An engine that speaks protocol 2 answers a socket without `protocol=2` with HTTP 426, and advertises capability `scenes.editorSync`.

| Direction | Message | Meaning |
|---|---|---|
| client → server | `hello {protocol, clientId, have, name}` | First message on every socket. `have` is the last entry applied, or null. |
| client → server | `item {seq, base, body}` | `body` is an edit `{version, ops}`, `publish` or `discard`. |
| client → server | `presence` | Selection and version, or `away` while draining. Not sequenced. |
| server → client | `welcome {last, catchup \| snapshot, diverged}` | `last` is the client's watermark. |
| server → client | `entry {v, id, src, kind, changes, meta, hasDraft}` | Every committed change, to every editor. The submitter's own `src` is its ack. |
| server → client | `ack {seq, v}` | The item changed nothing (transformed away, or already applied). |
| server → client | `nack {seq, code, retryable, detail}` | Nothing changed. `invalid` is final; `stale_base` and `unavailable` are retried. |
| server → client | `error {code}` then close | `not_found` (the scene is gone), `unsupported_protocol`, `protocol`. |

## In the dashboard

- `client/src/lib/scene-editor-sessions.ts` keeps **one client per scene per tab**. `acquire(sceneKey, factory)` returns the scene's client, resuming one that is still draining after its editor closed; `release` stops it once no editor holds it. A client is forgotten once it has ended. The registry holds the tab's one `beforeunload` listener, which asks while any client `hasPending()` or an editor has its name or description unsaved. `abandonScene` closes a deleted scene's client.
- `client/src/hooks/use-scene-editor-session.ts` acquires the client and reads it with `useSyncExternalStore(client.subscribe, client.getState)`. `client/src/lib/scene-sync-browser.ts` supplies the WebSocket, the clock and the socket URL. A client's `open` is a `SceneSocketOpener` that reads the session grant and preview URL from the editor that took the client last, through a ref that editor updates on every render: a client handed to a remounted editor (for a Convex scene row recreated under a new id, say) reconnects with that editor's arguments, not those of the editor that made it.
- `SceneCanvasEditor` keeps no copy of the document. It renders `canvasOfDocument(state.local[version])` and sends every canvas change as `client.edit(version, canvasEdit(update))`. The Live switch only chooses which version the canvas shows and edits.
- Reports become toasts through `syncReportToast` (`client/src/lib/scene-sync-report.ts`), a pure function of the typed `SyncReport`.
- The editor uses session mode only when the engine reports `scenes.editorSync`. Otherwise it is the Save-button editor, and an engine that reports only `scenes.editorSessions` (protocol 1, which this dashboard no longer speaks) gets a notice to upgrade. Until the capabilities have answered, or when asking for them failed, the editor is read-only and Save is off: the Save-button editor shows the published scene from the cache, and a save from it on an engine with editor sync would change what is on stream without a publish.

## Consequences

- **Cross-tab Publish** includes at least everything the clicking editor showed at the click; another tab's edits are included if they reached the server first.
- **The log window is finite.** An editor that misses more than the server's log (1000 entries or 512 KB) gets a snapshot, and its pending text edits merge field by field instead of character by character.
- **Acks follow the in-memory commit.** The engine writes documents and editor state together about two seconds later; a crash in that window loses those commits, and every affected editor is told (`history_lost`) rather than silently diverging.
- **No queue survives a page reload.** Closing the tab while anything is pending asks first; there is no local persistence of unsent edits.
- **Tests run the real thing.** UI tests that need a server use the engine's sequencer behind an in-memory socket (`client/src/lib/scene-sync-test-server.ts`), not a model of it. A test that drops a socket right after a welcome must advance the clock by at least `BACKOFF_BASE_MS` before expecting the reconnect.
