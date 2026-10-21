# Entitlements

## Context

A paid plan sells features ("advanced reports", a dashboard tool) and amounts ("asset storage"). These answer a different question from the dashboard's other gates:

| Question | Answered by | Lifetime |
|---|---|---|
| Can this engine build do X? | [Engine capabilities](./engine-capabilities.md) (`useEngineCapabilities`, `EngineFeatureGate`) | Until every engine in use has it |
| Does this account's plan include X, and how much? | An entitlement (this page) | As long as the plan |
| Should this viewer see new UI Y yet? | A [feature flag](./feature-flags.md) | Until the rollout ends |

The engine never enforces a plan. A self-hosted engine has every capability its build has, and anyone can run one, so a plan gate inside the engine would only bind the managed engines we host, and only against their own owners. What a plan sells instead lives where the engine is not: the dashboard, cloud services, and the resources a managed engine is provisioned with.

## Decision

- **What exists is code; who gets it is data.** `ENTITLEMENT_FEATURES` and `ENTITLEMENT_LIMITS` in `convex/lib/entitlements.ts` list every feature and limit, because a feature means nothing until code checks it. Which plans include them, and which plan each account is on, are rows operators edit, so pricing and packaging change without a deploy.
- **Plans** (`plans`): a key, a name, the features they include, limit values, and whether they are offered. Exactly one plan may be the default, which applies to every account without an active assignment.
- **Account assignments** (`accountPlans`, at most one per account): a plan (absent means the default), features added or removed for this account alone, limit overrides, and an optional `expiresAt`. An expired assignment is ignored entirely: the account falls back to the default plan with no overrides.
- **Limits resolve** to the account's override, else the plan's value, else the limit's `default` in code, so a limit added later never grants more than intended to plans written before it. `null` is unlimited.
- **Writes are validated** in `convex/lib/plans.ts`, the one path the CLI and the operator backoffice both use: unknown keys, a feature both added and removed, a limit set twice, or an amount that is not a whole number of at least 0 is refused. Keys code no longer lists are ignored when read.
- **Entitlements belong to the account,** whatever hosts its engines. A feature every self-hosting account should have belongs in the default plan, or stays ungated.
- **Enforcing:** a Convex function that serves a paid feature calls `requireEntitlement(ctx, accountId, feature)`. A limit is checked with `isWithinLimit(await accountEntitlements(ctx, accountId), key, usage)` where the usage is known.
- **Reading:** `useEntitlements()` and `useEntitlement(feature)` in the browser, both over `entitlements.forViewer` for the current instance's account. `PlanGate` renders its children only when the plan includes a feature, and otherwise says it is not on the plan. For an engine feature on a plan, nest an `EngineFeatureGate` inside a `PlanGate`.
- **Rollouts can follow plans:** a feature flag's `entitlement` rule admits only accounts whose plan includes a feature, which is how early access becomes a plan benefit.

```bash
bunx convex run plans:list
bunx convex run plans:upsert '{"key": "free", "name": "Free", "features": [], "limits": [], "offered": true}'
bunx convex run plans:setDefault '{"key": "free"}'
bunx convex run plans:setAccount '{"accountId": "…", "planKey": "pro", "addFeatures": [], "removeFeatures": [], "limits": []}'
bunx convex run entitlements:get '{"accountId": "…"}'
```

## Consequences

- Adding a feature or limit is a code change. Changing what a plan includes, or which plan an account is on, is not, and takes effect on the next query.
- Editing a plan changes it for every account on it. To keep existing accounts on the old terms, copy the plan, change the copy, stop offering the old one, and move accounts deliberately.
- A plan cannot be deleted while it is the default or any account is on it.
- A limit that bounds a hosted resource is enforced where it is granted, never in the engine. Hosted asset storage (`storage.hostedAssetBytes`, `storage.hostedFileBytes`) is checked by `resources.requestUpload` before the engine issues a size-bound upload grant; see [Media](../ui/assets.md#hosted-storage-limits).
- A limit can be soft: tracked and warned about, never refused. Module storage (`storage.moduleStorageBytes`, default 500 MiB) is one: no write is ever refused, the dashboard warns the owner of an engine over it, and the backoffice flags it; see [Modules](../ui/modules.md#module-storage-limit).
- Prices live in billing, not here: a plan says what is included, not what it costs.
- Before plans existed, account creation wrote a `licenses` row per account; `migrations/dropLegacyLicenses` deletes them, and the table goes after that has run.
