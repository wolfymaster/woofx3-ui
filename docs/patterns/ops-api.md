# Ops API

## Context

The internal backoffice (woofx3-maintenance `backoffice/`) shows operators managed engines from the maintenance API. It also needs the users, accounts and engines behind them, and has to act on customer engines. None of that is reachable from outside Convex:

- Public functions are gated by Convex Auth and per-tenant roles. Adding a staff role to `users` would let a bug or a role change in this app turn a customer into an operator.
- A deploy key can push code and read or write every table. That is far too much for a web app to hold.
- Internal functions cannot be reached without one of the two.

## Decision

A narrow HTTP API under `/api/ops/`, served by `convex/ops/http.ts`, that the backoffice server and the maintenance billing process call, each with its own secret and route scope.

- **Authentication:**
    - The caller sends `Authorization: Bearer <secret>`, compared in constant time against every configured secret. The secret that matches names the caller, and the caller is recorded in `opsAuditLog.caller`.
    - Callers are the table in `convex/lib/ops/callers.ts`. Each has `OPS_API_SECRET_<NAME>` and a `_NEXT` slot for rotation:

      | Caller | Env | Routes |
      | --- | --- | --- |
      | `billing` | `OPS_API_SECRET_BILLING` | `users.get`, `accounts.get`, `accounts.billingProjection`, `notifications.create` |
      | `backoffice` | `OPS_API_SECRET_BACKOFFICE` | every read, `engines.act`, `instances.setStorageLimits`, `notifications.*`, `accounts.billingProjectionReset` |
      | `legacy` | `OPS_API_SECRET` | every route; logged as deprecated on each request |

    - A route outside the caller's scope answers `403 forbidden_route`.
    - A secret shorter than 43 characters counts as unset. With no secret configured, as on preview deployments, every route answers `401`; the API never fails open.
    - Routes authenticate before anything else, so an unauthenticated caller cannot tell which routes exist.
- **Who is acting:**
    - Every request names the operator in `X-Woofx3-Actor`, or gets `400`.
    - Every write also says why in `X-Woofx3-Reason`, percent-encoded UTF-8 (`encodeURIComponent`), as the maintenance API expects it too.
    - Convex records both as given; the backoffice has already authenticated the operator.
- **Responses:**
    - Responses are `{ data }` or `{ error: { code, message } }`, with no CORS headers.
    - Each is built field by field from `convex/lib/ops/dto.ts`. They never contain registration tokens, instance client ids or secrets, invitation tokens, OAuth or platform tokens, or session tokens.
    - A test walks every DTO for forbidden keys and for secret values.
- **Billing is not edited here.** Subscriptions, exemptions, discounts, tier changes and suspensions are the management plane's, changed in its own operator tooling; this API only receives the projection it pushes, and offers no route to write any of it.
- **Audit:** `opsAuditLog` records every write, in the same mutation as the change, and every read of a single user or account. It is indexed by time, operator and target.

| Route | Returns |
|---|---|
| `GET /api/ops/users?q=&cursor=` | Users, newest first. `q` is an email address exactly, a Twitch user id exactly, or words of the name. |
| `GET /api/ops/users/:id` | A user, their account and instance memberships, and how many sessions are active. |
| `GET /api/ops/accounts?q=&cursor=` | Accounts with owner, member count, plan and managed engine count; `q` searches the name. |
| `GET /api/ops/accounts/:id` | An account, its members, pending invitations, resolved entitlements, instances, and each instance's provisioning. Billing is not part of it: the management plane owns it. |
| `GET /api/ops/engines?status=&cursor=` | Every `engineProvisioning` row, or those in one status, for drift checks against the maintenance API. |
| `GET /api/ops/engines/module-storage-limits?cursor=` | Each managed engine's module storage limit (`storage.moduleStorageBytes` after its override), by maintenance engine id, a page at a time; `null` is unlimited. A page may hold fewer rows than its size: rows without a maintenance engine are skipped. The backoffice compares these with maintenance's replica sizes to flag engines over their limit. |
| `GET /api/ops/engines/by-maintenance-id/:engineId` | One managed engine's provisioning row, instance, account, and hosted storage limits (inherited from the account, its override, and the limits that apply), and `isLive`, whether its stream is live now. |
| `GET /api/ops/instances/:id/health` | Live state, sync state, recent alerts and failing workflows. |
| `GET /api/ops/audit?actor=&target=&cursor=` | The audit log, newest first, for one operator or one target. |

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
| `POST /api/ops/accounts/:id/billing-projection` | The management plane's billing projection: tier (or `null`), add-ons, standing and its dates, `interval`, `exemptUntil`, `spinDownAt`, `hasProviderSubscription`, `discount` (`{ label }` or `null`) and entitlement overrides (`limits` values may be `null` for unlimited). Stored in `orgBilling` unless an equal or newer version is already held (`{ applied: false, version }`); the same version with different contents answers `409 version_conflict`, which the plane must not retry. Unknown fields, unknown override keys, a feature both added and removed, and a `trialing` standing with no `trialEndsAt`, a `past_due` standing with no `graceEndsAt`, and an add-on code does not list answer `400 invalid_billing_projection`, so Convex must learn a field before the plane sends it. Once an org has a projection it drives its entitlements; an org without one is gated as one with no subscription was before billing existed. An applied push is audited with the actor and reason. A `version` above 2^31 - 1 (the plane's counter is a Postgres `integer`) answers `400 invalid_billing_projection`. |
| `POST /api/ops/accounts/:id/billing-projection-reset` | Operator-only. Sets the org's stored projection version back to 0 so the plane's next push is applied, for a stuck version or a rebuilt plane counter; answers `{ previousVersion, version: 0 }`. Every other stored field stays, so entitlements do not change until a push arrives. `404 no_projection` when none is stored. Audited with the actor and the required reason. |

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
bunx convex env set OPS_API_SECRET_BACKOFFICE "$(openssl rand 32 | basenc --base64url | tr -d =)"
```
