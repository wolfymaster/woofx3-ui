# Engine entitlements

## Context

An engine release can ship a feature that managed engines should get only on a plan, or only as a rollout reaches them, while a self-hosted engine of the same release has it outright. The engine enforces this itself (woofx3 `docs/services/engine-entitlements.md`): a governed engine, one started with `WOOFX3_ENTITLEMENT_PUBLIC_KEYS`, withholds each gateable capability unless a grant signed by this deployment lists it. The dashboard decides what each managed engine is granted, signs it, and keeps it fresh. The end-to-end picture, including maintenance's part, is in woofx3 `docs/services/feature-gating.md`.

## Decision

- **Targeting** lives in `engineEntitlements`, one row per capability id, with the same `state` and `rules` as a [feature flag](./feature-flags.md), evaluated per instance (`hosting` is always `managed`). A capability with no row is granted to no governed engine. Operators change rows from the CLI; each change re-grants every managed engine.
- **Grants** live in `entitlementGrants`, one row per managed instance: the last `seq` issued, the granted ids, and when to push next. `seq` is `max(previous + 1, now in ms)`, because the engine refuses a lower one and a rebuilt table must not start below what engines hold.
- **Pushing:** `entitlementGrantActions.push` signs the grant with `ENTITLEMENT_SIGNING_KEY` (an Ed25519 seed that never leaves Convex) and calls the engine's `setEntitlementGrant`. A grant is addressed to `eng-<first 8 hex digits of the maintenance engine id>`, which must match the name woofx3-maintenance gives the engine.
- **When:** at registration, after any targeting change, daily (`GRANT_RENEW_AFTER_MS`), and an hour after a failed push. Grants last 7 days, so a week of failed pushes passes before an engine loses anything.
- A deployment without `ENTITLEMENT_SIGNING_KEY` makes no grant rows and schedules nothing.

```bash
bunx convex env set ENTITLEMENT_SIGNING_KEY "$(openssl rand 32 | basenc --base64url | tr -d =)"
bunx convex env set ENTITLEMENT_SIGNING_KEY_ID k1
bunx convex run entitlementGrantActions:publicKey     # the engines' WOOFX3_ENTITLEMENT_PUBLIC_KEYS entry
bunx convex run engineEntitlements:backfill           # once: grants for engines registered before this
bunx convex run engineEntitlements:set '{"capability": "obs.control", "state": "rules", "rules": {"licenseFeature": "pro"}}'
```

## Consequences

- Granting a capability before any engine release has it is safe: an engine ignores ids it does not know, and the feature turns on when the engine is upgraded.
- The engine reports withheld ids in `getEngineCapabilities().withheld`, and `engineCapabilities.get` labels each one from its targeting: a rule with `licenseFeature` is a plan, anything else a rollout. `capabilitySupport` answers `withheld`, and `EngineFeatureGate` shows a plan-withheld feature as not included in the plan and hides a rollout-withheld one entirely.
- Rotating the signing key means adding the new public key to every managed engine before Convex signs with it.
