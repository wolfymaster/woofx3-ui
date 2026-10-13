# Entitlements

## Context

A paid plan sells features ("advanced reports", a dashboard tool) and amounts ("asset storage"). These answer a different question from the dashboard's other gates:

| Question | Answered by | Lifetime |
|---|---|---|
| Can this engine build do X? | Engine capabilities (`useEngineCapabilities`, `EngineFeatureGate`) | Permanent |
| Does this account's plan include X, and how much? | An entitlement (this page) | As long as the plan |
| Should this viewer see new UI Y yet? | A [feature flag](./feature-flags.md) | Until the rollout ends |

The engine never enforces a plan. A self-hosted engine has every capability its build has, and anyone can run one, so a plan gate inside the engine would only bind the managed engines we host, and only against their own owners. What a plan sells instead lives where the engine is not: the dashboard, cloud services, and the resources a managed engine is provisioned with.

## Decision

- **Definitions live in code.** `ENTITLEMENT_FEATURES` and `ENTITLEMENT_LIMITS` in `convex/lib/entitlements.ts` list every feature and limit, and `PLANS` says what each tier includes. Every plan sets every limit, `null` meaning unlimited, so a new limit cannot be left out of a plan by accident.
- **An account's plan is its license:** at most one `licenses` row, holding a `tier`, any `features` beyond the tier's, and an optional `expiresAt`. No license, or an expired one, is the free plan. Until billing writes licenses, operators set them with the internal `entitlements:setLicense`.
- **Entitlements belong to the account,** whatever hosts its engines. A feature for every self-hosting account belongs in the free plan, or stays ungated.
- **Enforcing:** a Convex function that serves a paid feature calls `requireEntitlement(ctx, accountId, feature)`. A limit is checked with `isWithinLimit(await accountEntitlements(ctx, accountId), key, usage)` where the usage is known.
- **Reading:** `useEntitlements()` and `useEntitlement(feature)` in the browser, both over `entitlements.forViewer` for the current instance's account. `PlanGate` renders its children only when the plan includes a feature, and otherwise says it is not on the plan. For an engine feature on a plan, nest an `EngineFeatureGate` inside a `PlanGate`: the engine must have the capability and the account must be entitled.
- **Rollouts can follow plans:** a feature flag's `entitlement` rule admits only accounts whose plan includes a feature, which is how early access becomes a plan benefit.

```bash
bunx convex run entitlements:get '{"accountId": "…"}'
bunx convex run entitlements:setLicense '{"accountId": "…", "tier": "pro", "features": []}'
```

## Consequences

- Adding a feature or limit, or changing what a plan includes, is a code change. Moving an account between plans is not.
- A plan change takes effect on the next query: there is nothing to push or renew.
- A limit that bounds a hosted resource, such as a managed engine's storage, is also applied where the resource is provisioned. Convex checks it to explain a refusal; the provisioned size is what holds.
- Removing a feature from `ENTITLEMENT_FEATURES` silently drops it from licenses that list it. Remove its checks first.
- The catalog is empty until plans are priced.
