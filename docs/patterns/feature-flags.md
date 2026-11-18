# Feature flags

## Context

A new UI feature often needs to reach a few accounts before everyone: an operator's own engine, then a share of accounts, then all of them. That is a rollout, and it is different from two neighbouring questions:

| Question | Answered by |
|---|---|
| Does this account's plan include X? | An [entitlement](./entitlements.md) |
| Should this viewer see new UI Y yet? | A feature flag (this page) |

A flag is temporary. When its feature is on for everyone, the flag and its row are deleted. A flag is never a plan gate: a paid feature is an entitlement, which outlives any rollout.

## Decision

Flags are built on Convex, not bought. A query is already reactive and evaluated on the server, which is what a flag service sells. Operators create and target them in the backoffice's **Feature flags** page, through the [ops API](./ops-api.md); there is no CLI and no dashboard.

- **A flag is a row** in the `featureFlags` table: `key`, `description`, `owner`, `removeBy`, `state`, `rules`, and who last changed it. No row means no flag, and code reading that key sees off.
- **Keys are code's.** A key is a lowercase word, then dot- or dash-separated words, up to 64 characters (`scenes.newToolbar`). A developer reads the key operators created; until code reads it, the flag does nothing. Renaming a key is deleting a flag and making another.
- **State** is `off`, `on` or `rules`. Under `rules`:
  - An allowlisted user, account or engine always gets the flag, whatever else is set, so an operator can try a feature anywhere.
  - Otherwise every condition that is set must hold: `hosting` (`managed` or `external`), `entitlement` (the account's plan must include it), and `percent`.
  - `percent` admits a stable share, bucketed by account (by user when no engine is selected), hashed with the flag key so each flag's first 10% is a different set of accounts.
  - Rules with nothing set are off, so the backoffice refuses to save a rule set with nothing in it.
- **Target ids are checked** when a flag is saved: a user, account or engine that does not exist is a refusal, not a rule that silently admits nobody.
- **Reading:** `useFeatureFlag(key)` in the browser (undefined while loading) takes the key as a string. Every caller shares the `featureFlags.forViewer` subscription, so an operator's change appears without a reload.
- **Enforcing:** a mutation or action behind a flag calls `requireFeatureFlag` with the caller's `featureFlagSubject`, so a hidden button is not the only gate.

Operators change flags in the backoffice, which calls:

```text
GET  /api/ops/feature-flags           every flag, plus the entitlements a rule may name
POST /api/ops/feature-flags           create one
PUT  /api/ops/feature-flags           retarget the flag its body names
POST /api/ops/feature-flags/delete    delete it
```

Every write carries `X-Woofx3-Actor` and `X-Woofx3-Reason`, and is recorded in `opsAuditLog`. Reads are open to every backoffice role; writes need `operator` or `admin`.

## Consequences

- Adding a flag is not a code change; wiring one into the product still is. The backoffice can create a flag no code reads, and that is harmless.
- A typo in `useFeatureFlag` or `requireFeatureFlag` reads as off rather than failing the build. The build no longer knows keys; the backoffice page is the list.
- An engine's account, hosting and entitlements count only when the viewer is a member of it, so a non-member cannot borrow another account's rollout.
- Removing a flag: turn it `on`, ship the code without its checks, then delete the row. Deleting first switches the feature off for everyone still gated by it.
- The page marks a flag past its `removeBy` date, so a rollout that ended gets cleaned up.
- There are no experiments or statistics. If the product needs A/B tests with analysis, revisit a hosted service then.
