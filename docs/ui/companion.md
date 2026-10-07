# Companion app

**Primary files:** `convex/companionPairing.ts`, `convex/companions.ts`, `convex/lib/companionCodes.ts`, `convex/lib/companionRecords.ts`

## What it is

The woofx3 companion is a small tray app (Tauri 2) for the streamer's PC. It holds outbound connections from that PC to woofx3, so that later it can carry work a cloud service cannot do on its own, such as reaching OBS on the streamer's own machine or an engine running on that PC.

It is **not** a desktop UI for woofx3. The browser is the only place woofx3 is managed.

This page covers what Convex does for it: pairing a companion with an instance, and the token the companion then authenticates with.

## Pairing

Pairing follows the OAuth device authorization shape (RFC 8628): the companion shows a short code, and a signed-in person approves it in the browser.

1. The companion generates its own token: 32 bytes from the OS RNG, base64url, prefixed `wfxc_`. It stores it in the OS credential store (Credential Manager on Windows) marked unconfirmed.
2. It calls the action `companionPairing.start` with its device name, version, installation id and the token's SHA-256 hash. Convex draws a device code and an 8-character user code (`XXXX-XXXX`, from an alphabet with no vowels or look-alike characters), and returns them with the verification URL `<SITE_URL>/companion/pair?code=…` and how long the code is good for (10 minutes).
3. The companion opens that URL and shows the code. It subscribes to `companions.self` with its token, and to `companionPairing.status` with the device code to hear about a decline.
4. On the approval page the person checks that the code matches, picks an instance where they are an admin or owner, and approves. `companionPairing.approve` writes the `companions` row with the stored token hash and marks the pairing approved, in one transaction. If the instance already has a companion from another installation, the same transaction deletes it (see [One companion per instance](#one-companion-per-instance)).
5. `companions.self` turns non-null for the token, returning the instance name and the approver's name. The companion asks the person at the PC to **Confirm** or **Reject** "Approved for {instance} by {person}". A code shown on stream could be approved by anyone who saw it, so the token counts only once confirmed. Confirm calls `companions.confirm`, which sets `confirmedAt` on the row; Reject calls `companions.unpair`. `self` reports `confirmed`, and the server's value wins after a restart. Re-pairing the same installation clears `confirmedAt`.

Whenever the companion gives up a token before it is paired (Cancel, the code expiring, a failure, or a restart that finds an unconfirmed token Convex no longer answers for), it forgets the token locally and then, in the background, calls `companionPairing.cancel` with the device code and `companions.unpair` with the token. `cancel` moves a pending pairing to `cancelled`, and `unpair` also cancels any pending pairing started with that token, since a restart loses the device code. Both are idempotent. Without this, an approval arriving after the companion gave up would write a `companions` row nobody holds.

Because the companion makes its own token and sends only its hash, no secret ever travels back to it, and a lost response cannot strand a pairing.

The **installation id** is a UUID the companion generates once and keeps in its app data directory. Approving a pairing from an installation that already has a row on that instance replaces that row's token, keeping its id, so pairing the same PC again does not leave a duplicate.

### One companion per instance

An instance has at most one companion. Approving a pairing from a different installation **replaces** the current companion: `approve` deletes its row and presence row in the same transaction, and the old companion's `companions.self` subscription turns null, so it drops to Unpaired at once. Pairing the same installation again updates the row in place and keeps its id, with no warning.

Before Approve is enabled, the approval page asks `companionPairing.replacementForApproval` with the user code and the chosen instance. It answers with the device name and last-seen time of the companion that approving would replace, or null. It compares installation ids on the server, so they never reach the browser, and it answers only an admin of the instance, with no token data.

Because there is only one companion, holding a confirmed companion row is the privilege. A phished approval can only replace the streamer's own companion, and that is visible: the real companion drops to Unpaired, and `companions.forInstance` names the new device. The rule that picks which rows an approval replaces is `companionsReplacedBy` in `convex/lib/companionCodes.ts`, which is unit tested.

### Who may approve

The user code is a short-lived capability: whoever holds it may see the pairing's device details (`getForApproval`) and decline it (`deny`), so those need only a sign-in. Approving binds a device that will act on the instance, which is an admin concern, so `approve` requires the admin role on the chosen instance.

### Expiry and rate limits

Expiry is stored as `expiresAt`, never as a status. Mutations compare it with the clock; queries never read it, since a query does not re-run as time passes. The companion waits for the duration `start` returned (`expiresInMs`), and the action `companionPairing.timeLeft` answers how long a code has left by the server's clock, so neither a skewed PC clock nor a skewed browser clock shows a live code as expired. The server still enforces expiry on approve and decline. An hourly cron (`companionPairing.cleanupExpired`) deletes pairings an hour after they expire.

`start` is public and unauthenticated, so it is rate limited per installation and then globally (`@convex-dev/rate-limiter`). The caller chooses its own installation id, so the global bucket (3000 an hour, bursts of 300) is the real ceiling; checking the per-installation bucket first means refused calls do not spend it. `deny` is rate limited per user, and answers a wrong or used-up code with a result rather than an error so that failed attempts count against the limit too.

## Tokens and revocation

Only the token's hash is stored. The `companions` row is the credential: a token whose hash has no row is not paired, and every function that takes a token fails closed.

- `companions.self` — what the companion subscribes to. Null means unpaired; the companion forgets its token. A query error is not a revocation.
- `companions.heartbeat` — every 60 seconds once confirmed. It writes `companionPresence`, a separate table, so the heartbeat does not re-run subscriptions that read the companion itself.
- `companions.confirm` — the person at the PC confirmed the pairing; sets `confirmedAt`.
- `companions.unpair` — the companion removing itself. It clears its local token first, so an offline Convex never keeps it.
- `companions.revoke` — an admin removing the companion. Deleting the row is the revocation.
- `companions.forInstance` — the instance's companion for its members (null when there is none), with device, version, pairing date, last heartbeat and whether the device confirmed it.

A companion acts with its approver's authority, so it stays paired only while the person who approved it is still an admin or owner of the instance. Removing them, or lowering them to member, unpairs it, the same rule as remote macro triggers. Deleting the instance deletes its companion, its presence row and the instance's pairings.
