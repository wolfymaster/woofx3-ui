# Ops API

## Context

The internal backoffice (woofx3-maintenance `backoffice/`) shows operators managed engines from the maintenance API. It also needs the users, accounts and engines behind them, and later has to change plans and act on customer engines. None of that is reachable from outside Convex:

- Public functions are gated by Convex Auth and per-tenant roles. Adding a staff role to `users` would let a bug or a role change in this app turn a customer into an operator.
- A deploy key can push code and read or write every table. That is far too much for a web app to hold.
- Internal functions cannot be reached without one of the two.

## Decision

A narrow HTTP API under `/api/ops/`, served by `convex/ops/http.ts`, that only the backoffice server calls.

- **Authentication:**
    - The caller sends `Authorization: Bearer <OPS_API_SECRET>`, compared in constant time.
    - `OPS_API_SECRET_NEXT` is also accepted, so the secret can rotate.
    - A secret shorter than 32 bytes counts as unset. With no secret configured, as on preview deployments, every route answers `401`; the API never fails open.
    - Routes authenticate before anything else, so an unauthenticated caller cannot tell which routes exist.
- **Who is acting:**
    - Every request names the operator in `X-Woofx3-Actor`, or gets `400`.
    - Every write also says why in `X-Woofx3-Reason`, percent-encoded UTF-8 (`encodeURIComponent`), as the maintenance API expects it too.
    - Convex records both as given; the backoffice has already authenticated the operator.
- **Responses:**
    - Responses are `{ data }` or `{ error: { code, message } }`, with no CORS headers.
    - Each is built field by field from `convex/lib/ops/dto.ts`. They never contain registration tokens, instance client ids or secrets, invitation tokens, OAuth or platform tokens, or session tokens.
    - A test walks every DTO for forbidden keys and for secret values.
- **Audit:** `opsAuditLog` records every write, in the same mutation as the change, and every read of a single user or account. It is indexed by time, operator and target.

| Route | Returns |
|---|---|
| `GET /api/ops/users?q=&cursor=` | Users, newest first. `q` is an email address exactly, a Twitch user id exactly, or words of the name. |
| `GET /api/ops/users/:id` | A user, their account and instance memberships, and how many sessions are active. |
| `GET /api/ops/accounts?q=&cursor=` | Accounts with owner, member count, plan and managed engine count; `q` searches the name. |
| `GET /api/ops/accounts/:id` | An account, its members, pending invitations, resolved entitlements, instances, each instance's provisioning, its subscription and its last 20 subscription transitions. |
| `GET /api/ops/engines?status=&cursor=` | Every `engineProvisioning` row, or those in one status, for drift checks against the maintenance API. |
| `GET /api/ops/engines/module-storage-limits?cursor=` | Each managed engine's module storage limit (`storage.moduleStorageBytes` after its override), by maintenance engine id, a page at a time; `null` is unlimited. A page may hold fewer rows than its size: rows without a maintenance engine are skipped. The backoffice compares these with maintenance's replica sizes to flag engines over their limit. |
| `GET /api/ops/engines/by-maintenance-id/:engineId` | One managed engine's provisioning row, instance, account, and hosted storage limits (inherited from the account, its override, and the limits that apply). |
| `GET /api/ops/instances/:id/health` | Live state, sync state, recent alerts and failing workflows. |
| `GET /api/ops/audit?actor=&target=&cursor=` | The audit log, newest first, for one operator or one target. |
| `GET /api/ops/plans` | Every plan with how many accounts are on it, resolved as entitlements are: an active assignment's plan, else the default. Walks every account and assignment a page per query, so it is not a single snapshot; the backoffice prices it for expected revenue. |
| `GET /api/ops/payments/strays?cursor=&limit=` | Stray payments, newest first: live provider subscriptions an organization's row doesn't follow, such as a second checkout that was also paid. Each gives the event, the organization (id and name; `null` once it is deleted), the provider subscription and customer refs, the amount in cents when it came through one of our checkouts (else `null`), and when it arrived. `limit` is 1 to 100 (default 25); any other value answers `400 invalid_limit`. Nothing cancels or refunds a stray: an operator settles it at the provider. |

List routes are cursor-paginated: pass back `cursor` until it is `null`.

Operators act on a customer's managed engine exactly as the customer could:

| Route | Does |
|---|---|
| `POST /api/ops/engines/:instanceId/upgrade` | The customer's upgrade, to the offered release. |
| `POST /api/ops/engines/:instanceId/retry` | The customer's retry of a failed run or registration. |
| `POST /api/ops/engines/:instanceId/delete` | The customer's delete: the engine is torn down, and the instance stays. |

Operators also set what only an operator may:

| Route | Does |
|---|---|
| `POST /api/ops/instances/:instanceId/storage-limits` | Replaces a managed engine's hosted storage override, `{ totalBytes?, fileBytes?, moduleStorageBytes? }` in bytes. A field left out inherits the account's entitlement, `null` is unlimited, and `{}` clears the override. An engine someone else hosts answers `409 not_managed`. |
| `POST /api/ops/accounts/:id/plan` | `{ plan: "starter" \| "pro" }`: the tier of an organization no provider bills, such as an exempt one. A provider-billed one answers `409 provider_managed` (its plan changes in the customer portal or Stripe), a trial asked for Pro answers `409 trial_is_starter`, and an organization with no subscription `409 no_subscription`. |
| `POST /api/ops/accounts/:id/exemption` | `{ plan, until? }` grants or changes an exemption: free access on `plan`, never billed, until `until` (epoch ms) or indefinitely. `{ revoke: true }` ends it, and the organization is evaluated at once: active with a provider subscription in good standing, otherwise past due. |
| `POST /api/ops/accounts/:id/suspend` | `{ reason }`: suspends the organization now. Its managed engines stop after the usual spin-down grace. |
| `POST /api/ops/accounts/:id/discount` | `{ key, spec }`: attaches a discount to the organization's provider subscription, creating the provider's coupon for `key` if it is missing. `spec` is `{ kind: "percent_off", percent, duration }` or `{ kind: "amount_off", amountCents, currency: "usd", duration }`, with `duration` `{ kind: "once" }`, `{ kind: "forever" }` or `{ kind: "months", months }`. Without a provider subscription it answers `409 no_subscription`; a provider failure answers `502`. |

- **Idempotency keys:** the four `/api/ops/accounts/:id/...` writes run once per key, so the backoffice can retry after a timeout or a `5xx`.
    - Each takes an `Idempotency-Key` header: 8 to 100 letters, digits, `.`, `:`, `-` or `_`. Missing or malformed, it answers `400 invalid_idempotency_key`.
    - A key belongs to one route and one organization, and to the validated body it first came with. The `X-Woofx3-Reason` header is not part of it.
    - A repeat of a success answers the first `200` and its body again and changes nothing; it writes no audit row either. The same key with another body answers `409 idempotency_mismatch`.
    - A refusal (`400`, `404`, `409`) or a provider failure (`502`) does not use the key up: the same request can be sent again with it, and is decided afresh.
    - The key is claimed and settled in `opsRequests`, in the same mutation as the write and its audit row. A discount calls the provider between its mutations, so its key is claimed first: until the call settles, a repeat answers `409 in_progress`. A claim left by a call that died is taken over after 15 minutes (Convex ends an action after 10), and the provider is asked again with the same provider idempotency key, so the discount is not applied twice.
- **Subscription writes** go through the billing lifecycle (`convex/lib/subscriptions.ts` `applyTransition`), the same path the evaluator and provider webhooks use, so an operator can't put a subscription into a state the lifecycle can't reach. A write the lifecycle has no transition for answers `409 illegal_transition`. Each one is audited with its outcome, refusals included.
- **One implementation:** both paths run `convex/lib/managedEngineActions.ts`. The provisioning row, the runs, the callbacks and a rollback are identical; only `upgrade.requestedBy` names the operator, as `{ operator: email }`.
- **Not shown to the customer:** `provisioning.forInstance` strips `requestedBy`, and the customer sees the run like any other.
- **No duplicates:** the maintenance API's idempotency keys come from the row's state, so a repeated request is answered by the run already started.
- **Errors:** a refusal, such as an engine that isn't running, answers `409 refused`. A maintenance API failure answers `502 maintenance_error`.
- **Audit:** the action calls the maintenance API between its own mutations, so its audit row is written when it finishes, success or failure, rather than in one mutation with the change.
- **The maintenance API's own audit names the Convex client, not the operator.** Only admin keys may name an operator there, and Convex does not hold one. The operator is in `opsAuditLog` and the backoffice's audit.

## Consequences

- Each new operator capability is a deliberate ops route with its own DTO and audit row, never a generic table read.
- Sign-in keeps a Twitch user's display name and id, not their login, so users are found by Twitch id rather than login.
- Email addresses and Twitch identities are returned in full to every backoffice role.

```bash
bunx convex env set OPS_API_SECRET "$(openssl rand 32 | basenc --base64url | tr -d =)"
```
