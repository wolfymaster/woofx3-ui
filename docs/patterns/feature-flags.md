# Feature flags

## Context

A new UI feature often needs to reach a few accounts before everyone: an operator's own instance, then a share of accounts, then all of them. That is a rollout, and it is different from two neighbouring questions:

| Question | Answered by |
|---|---|
| Can this engine build do X? | [Engine capabilities](./engine-capabilities.md) (`useEngineCapabilities`) |
| Does this account's plan include X? | An [entitlement](./entitlements.md) |
| Should this viewer see new UI Y yet? | A feature flag (this page) |

A flag is temporary. When its feature is on for everyone, the flag and its row are deleted. A flag is never a plan gate: a paid feature is an entitlement, which outlives any rollout.

## Decision

Flags are built on Convex, not bought. A query is already reactive and evaluated on the server, which is what a flag service sells.

- **Definitions live in code.** `FEATURE_FLAGS` in `convex/lib/featureFlags.ts` lists each key with a description, an owner and a `removeBy` date. A key must be listed before it can be targeted, so a typo cannot turn a flag on, and the hook only accepts listed keys.
- **Targeting lives in the `featureFlags` table**, one row per key, written only by operators with the internal `featureFlags:set` mutation. A flag with no row is off.
- **State** is `off`, `on` or `rules`. Under `rules`:
  - An allowlisted user, account or instance always gets the flag, whatever else is set, so an operator can try a feature anywhere.
  - Otherwise every condition that is set must hold: `hosting` (`managed` or `external`), `entitlement` (the account's plan must include it), and `percent`.
  - `percent` admits a stable share, bucketed by account (by user when no instance is selected), hashed with the flag key so each flag's first 10% is a different set of accounts.
  - Rules with nothing set are off.
- **Reading:** `useFeatureFlag(key)` in the browser (undefined while loading). Every caller shares the `featureFlags.forViewer` subscription.
- **Enforcing:** a mutation or action behind a flag calls `requireFeatureFlag` with the caller's `featureFlagSubject`, so a hidden button is not the only gate.

```bash
bunx convex run featureFlags:set '{"key": "scenes.newToolbar", "state": "rules", "rules": {"instances": ["…"]}}'
bunx convex run featureFlags:set '{"key": "scenes.newToolbar", "state": "rules", "rules": {"percent": 10}}'
bunx convex run featureFlags:set '{"key": "scenes.newToolbar", "state": "on"}'
bunx convex run featureFlags:list   # overdue flags and orphaned rows
```

## Consequences

- Adding a flag is a code change; turning it on is not.
- An instance's account, hosting and entitlements count only when the viewer is a member of it, so a non-member cannot borrow another account's rollout.
- `featureFlags:list` reports flags past `removeBy` and rows whose key was removed from `FEATURE_FLAGS`. Removing a flag means deleting the key and its checks, then `featureFlags:remove` for the row.
- There are no experiments or statistics. If the product needs A/B tests with analysis, revisit a hosted service then.
