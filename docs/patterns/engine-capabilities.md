# Engine capabilities

## Context

Engines are upgraded on their own schedule: managed engines when their owner or an operator upgrades them, self-hosted engines whenever their owner gets round to it. So the dashboard cannot assume a feature exists because the code for it has shipped. Each engine lists the features its build supports through `getEngineCapabilities()`, and Convex and the browser gate newer paths on those ids. The ids are listed in `ENGINE_CAPABILITY_IDS` (`convex/lib/engineCapabilities.ts`), which mirrors woofx3 `shared/clients/typescript/api/capabilities.ts`. woofx3 `docs/services/engine-capabilities.md` records the release each id first shipped in (its **Since**).

A capability check is temporary. Each one keeps an old fallback path alive, so it is removed once every engine still in use has the capability.

## Decision

- **Gating always asks the engine.** Nothing below changes how a check decides; recorded data is for operators only.
- **Convex records what engines report** on the instance, as a side effect of calls the dashboard already makes (`convex/lib/engineReport.ts`):
    - `engineVersion`: the release `getEngineInfo()` last returned, as returned (`"dev"` for an unstamped build). Written when the status bar connects.
    - `engineCapabilityIds`: every id `getEngineCapabilities()` last listed, including ids this dashboard does not know, sorted. Empty for an engine older than the method. Written when a screen that gates on a capability opens, with `engineCapabilitiesSeenAt`.
    - `engineSeenAt`: the last time the engine answered either call. This is what "recently active" means below.
    - An unchanged answer is written at most once an hour, since each write to an instance re-runs the queries that read it.
- **A minimum supported engine version**, `MIN_SUPPORTED_ENGINE_VERSION` in `convex/lib/engineVersion.ts`, is `null` (no minimum) until set. `engineBelowMinimum(instance)` and the `engineReports.versionStatus` query report an engine older than it. A version outside the release order (`"dev"`, a preview tag such as `pr-12-abc1234`) or no recorded version is **unknown, not below**. The minimum is a code constant, not an env var, so it changes in the same reviewed change as a removed fallback and cannot drift per deployment afterwards.
- **The ops API reports the fleet**, `GET /api/ops/engines/capabilities?days=30` (see [Ops API](./ops-api.md)): for each id, how many recently active instances have it and lack it, by hosting, plus the versions they run.

## Retiring a capability check

Remove a check, and the fallback it guards, when both hold:

1. **The minimum supported version is at least the id's Since.** Raise `MIN_SUPPORTED_ENGINE_VERSION` first, in its own change, once the fleet allows it. That is a decision to stop supporting older engines, so make it deliberately.
2. **No recently active instance lacks the id.** In `GET /api/ops/engines/capabilities`, the id's `lack` is `0` for both `managed` and `external`. Also check `unreported` (active instances that never had a capability list recorded) and `versions` for releases older than Since. Use a window long enough to cover streamers who go quiet between streams; 30 days is the default, 90 is safer for self-hosted engines.

Then, in one change:

- Delete the check and the fallback path, in Convex and in the browser (`useEngineCapabilities`, `EngineFeatureGate`, `hasEngineCapability`).
- Leave the id in `ENGINE_CAPABILITY_IDS` until nothing gates on it, then remove it. Engines keep listing it, and the ops read still counts it as an unknown id.

## Consequences

- Recording happens only where the dashboard already asks, so an instance nobody opens is never recorded and does not count as recently active. That instance's owner has not used the dashboard in that window either.
- A capability list is as old as `engineCapabilitiesSeenAt`. An engine upgraded since then may still be counted as lacking an id until someone opens a gated screen. That errs towards keeping a check.
- Server-side checks inside other actions (workflow health, starter packs, alert compositions) do not record, so they add no writes to those paths.
- Local mode, where the browser asks the engine directly, records nothing in Convex.
