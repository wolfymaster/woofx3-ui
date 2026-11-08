# Entitlements

## Context

A paid plan sells features ("advanced reports", a dashboard tool) and amounts ("asset storage"). These answer a different question from the dashboard's other gates:

| Question | Answered by | Lifetime |
|---|---|---|
| Does this account's plan include X, and how much? | An entitlement (this page) | As long as the plan |
| Should this viewer see new UI Y yet? | A [feature flag](./feature-flags.md) | Until the rollout ends |

The engine never enforces a plan. A self-hosted engine has every capability its build has, and anyone can run one, so a plan gate inside the engine would only bind the managed engines we host, and only against their own owners. What a plan sells instead lives where the engine is not: the dashboard, cloud services, and the resources a managed engine is provisioned with.

**Availability comes before the plan.** Paid features exist only on hosted (managed) engines. A self-hosted engine, whether an external engine on the hosted dashboard or the desktop app's local mode, needs no subscription and never offers a paid feature, whatever its organization pays for.

## Decision

- **What exists is code; who gets it is data.** `ENTITLEMENT_FEATURES` and `ENTITLEMENT_LIMITS` in `convex/lib/entitlements.ts` list every feature and limit, because a feature means nothing until code checks it. Which plans include them, and which plan each account is on, are rows operators edit, so pricing and packaging change without a deploy.
- **Plans** (`plans`): a key, a name, the features they include, limit values, and whether they are offered. The tiers `starter` and `pro` must have a row: an org's subscription names its tier, and reading entitlements for a tier with no row fails.
- **The subscription decides the plan.** An org's `subscriptions` row (see the billing lifecycle in `convex/lib/billingLifecycle.ts`) names its tier. In a usable state (`trialing`, `active`, `past_due`, `exempt`) that tier's plan applies; while `suspended` no plan applies and limits are the code defaults. An org with no subscription row yet keeps its assignment's plan or the default plan, until the subscription migrations have run for every org.
- **Add-ons** (`ADD_ONS`, code) grant features. Pro includes every add-on; on Starter an org has the ones in `subscriptions.addOns`.
- **Account assignments** (`accountPlans`, at most one per account): features added or removed for this account alone, limit overrides, and an optional `expiresAt`, applied on top of the plan. An expired assignment is ignored entirely.
- **Limits resolve** to the account's override, else the plan's value, else the limit's `default` in code, so a limit added later never grants more than intended to plans written before it. `null` is unlimited.
- **Writes are validated** in `convex/lib/plans.ts`, the one path the CLI and the operator backoffice both use: unknown keys, a feature both added and removed, a limit set twice, or an amount that is not a whole number of at least 0 is refused. Keys code no longer lists are ignored when read.
- **Enforcing:** `engineAvailability(ctx, instanceId, now)` in `convex/lib/entitlementAccess.ts` answers `self_hosted` or `hosted` with the org's entitlements, and `hasFeature` is false for every feature on a self-hosted engine. A Convex function that serves a paid feature checks `hasFeature` itself and refuses when it is false, so a hidden button is not the only gate. Managed-engine paths that need a live subscription call `requireUsableSubscription`. A limit is checked with `isWithinLimit(await accountEntitlements(ctx, accountId, now), key, usage)` where the usage is known. Never compare `subscription.plan` directly: that skips availability.
- **Reading:** `entitlements.forViewer(instanceId)` returns the engine's availability. In the browser, `useFeature(feature)` answers `available`, `upgrade` (a hosted plan without it) or `unavailable` (self-hosted). Each app root mounts its `FeatureSourceProvider`: the desktop app's local mode answers `unavailable` without Convex. `<PaidFeature feature>` is the one UI gate: its children when available, a note linking to Billing on `upgrade` (plain text in the desktop app), and nothing on a self-hosted engine (or "Available on hosted engines", with no link or price, when `keepSlot` is set). Billing UI shows only when `useBillingUi().visible`: a hosted engine, outside the desktop app.
- **Seats:** `org.members` counts the organization's members, owner included. Seats belong to the org, not an engine: once the org has a subscription or any managed engine, inviting someone new to any of its engines (self-hosted ones too), and anyone joining the org through an engine grant, is refused at the limit (`orgSeatsFull`, checked in `grantEngineRole`). An org with only self-hosted engines has no seat limit. The organization migration keeps everyone already on an engine, even past the limit.
- **Rollouts can follow plans:** a feature flag's `entitlement` rule admits only accounts whose plan includes a feature, which is how early access becomes a plan benefit.

```bash
bunx convex run plans:list
bunx convex run plans:setAccount '{"accountId": "…", "planKey": "pro", "addFeatures": [], "removeFeatures": [], "limits": []}'
bunx convex run entitlements:get "{\"accountId\": \"…\", \"now\": $(date +%s000)}"
```

### The tier plans

The `starter` and `pro` rows are exactly what the pricing page promises (`convex/seeds/plans.ts`, pinned against a copy of the pricing table by its test; GB read as GiB). Previews seed them from that file. In production, write them with:

```bash
bunx convex run plans:upsert '{"key":"starter","name":"Starter","features":[],"limits":[{"key":"org.members","value":5},{"key":"storage.moduleStorageBytes","value":53687091200},{"key":"storage.hostedAssetBytes","value":107374182400},{"key":"analytics.retentionDays","value":30}],"offered":true}'
bunx convex run plans:upsert '{"key":"pro","name":"Pro","features":["business","marketplace.premiumIncluded","userPages.customDomain"],"limits":[{"key":"org.members","value":null},{"key":"storage.moduleStorageBytes","value":107374182400},{"key":"storage.hostedAssetBytes","value":536870912000},{"key":"analytics.retentionDays","value":90}],"offered":true}'
```

Changing the pricing page means changing these rows and the seed file together.

## Consequences

- Adding a feature or limit is a code change. Changing what a plan includes, or which plan an account is on, is not, and takes effect on the next query.
- Editing a plan changes it for every account on it. To keep existing accounts on the old terms, copy the plan, change the copy, stop offering the old one, and move accounts deliberately.
- A plan cannot be deleted while it is the default or any account is on it.
- A limit that bounds a hosted resource is enforced where it is granted, never in the engine. Hosted asset storage (`storage.hostedAssetBytes`, `storage.hostedFileBytes`) is checked by `resources.requestUpload` before the engine issues a size-bound upload grant; see [Media](../ui/assets.md#hosted-storage-limits).
- A limit can be soft: tracked and warned about, never refused. Module storage (`storage.moduleStorageBytes`, default 500 MiB) is one: no write is ever refused, the dashboard warns the owner of an engine over it, and the backoffice flags it; see [Modules](../ui/modules.md#module-storage-limit).
- Prices live in billing, not here: a plan says what is included, not what it costs.
- User pages are a hosted feature: only managed engines may publish one (`userPagesAllowed` in `convex/lib/userPages.ts` is the one place that rule lives).
- Before plans existed, account creation wrote a `licenses` row per account; `migrations/dropLegacyLicenses` deletes them, and the table goes after that has run.
