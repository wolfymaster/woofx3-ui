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
      | `billing` | `OPS_API_SECRET_BILLING` | `users.get`, `accounts.get`, `accounts.referral`, `accounts.billingProjection`, `notifications.create` |
      | `backoffice` | `OPS_API_SECRET_BACKOFFICE` | every read, `engines.act`, `instances.setStorageLimits`, `notifications.*`, `featureFlags.*`, `referralCodes.*`, `accounts.billingProjectionReset` |
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

## The contract

The routes, query parameters, request bodies, response shapes and error codes are one source: `convex/lib/ops/contract.ts`. It holds a Zod schema for every body, query and DTO, and a route table of name, method, path template, query, body, response and error codes. A route's name (`users.list`) is its OpenAPI `operationId` and the key in a caller's scope.

Everything else derives from it, and nothing is copied by hand:

- **The route matcher** (`convex/lib/ops/routes.ts`) is built from the table's path templates. The table is checked when the module loads: duplicate names or endpoints, a path outside `/api/ops/` or a parameter with no name throw at import.
- **Request bodies** are parsed with the contract's schemas (`parseRequestBody`), so what the document says is what the handler enforces. A refused body answers `400` with the route's error code (`invalid_notification`, `invalid_feature_flag`, `invalid_storage_limits`, `invalid_billing_projection`) and the first problem as its message. The storage-limits and billing-projection bodies refuse unknown fields; the notification and feature-flag bodies ignore them.
- **DTO types** (`convex/lib/ops/dto.ts`) are `z.infer` of the contract's schemas, and each mapper is typed to return one.
- **The OpenAPI 3.1 document** is `openapi/ops.json`, written by `bun run ops:openapi` with sorted keys. A test fails when the committed file differs from what the contract generates, so a contract change and its regenerated document land together. Read the document, not this page, for the list of routes, parameters and error codes.

How the contract is checked:

- A test calls every route over HTTP against seeded data and parses each answer with that route's response schema, so a handler cannot drift from the document. `engines.act` is the one route it does not call, because the maintenance API answers it.
- The DTO test walks every response for forbidden keys and for secret values.
- A test checks that every caller scope names a real route and that every route is in some caller's scope.

A consumer types its client from `openapi/ops.json` and validates what it receives: a response is `{ data }` and an error is `{ error: { code, message } }`, so parse `data` with the schema of the operation's `200` response before using it, and treat an answer that fails it as an error. Send `X-Woofx3-Actor` always, and `X-Woofx3-Reason` on every write. List routes are cursor-paginated: pass back `cursor` until it is `null`.

Operators act on a customer's managed engine (`engines.act`: upgrade, retry, delete) exactly as the customer could, and set what only an operator may: a managed engine's hosted storage override, feature flags, notifications, and the billing projection reset.

- **Hosted storage override:** `instances.setStorageLimits` replaces the whole override. A field left out inherits the account's entitlement, `null` is unlimited, and `{}` clears it. An engine someone else hosts answers `409 not_managed`.
- **Feature flags:** a create and an update carry the same whole definition. Under `state: "rules"` at least one rule is required, and a target id that names no user, account or instance answers `400 unknown_target`. A flag's key travels in the body of a removal because keys contain dots and a path segment cannot.
- **Billing projection:** `accounts.billingProjection` stores the management plane's projection in `orgBilling` unless an equal or newer version is held (`{ applied: false, version }`). The same version with different contents answers `409 version_conflict`, which the plane must not retry. Unknown fields, unknown override keys, a feature both added and removed, a `trialing` standing with no `trialEndsAt`, a `past_due` standing with no `graceEndsAt`, a `suspended` standing with no reason and an add-on code does not list answer `400 invalid_billing_projection`, so Convex must learn a field before the plane sends it. A `version` above 2^31 - 1 (the plane's counter is a Postgres `integer`) is refused too. Once an org has a projection it drives its entitlements. An applied push is audited with the actor and reason.
- **Billing projection reset:** operator-only. Sets the stored version back to 0 so the plane's next push is applied, for a stuck version or a rebuilt plane counter. Every other stored field stays, so entitlements do not change until a push arrives. `404 no_projection` when none is stored.

- **One implementation:** both paths run `convex/lib/managedEngineActions.ts`. The provisioning row, the runs, the callbacks and a rollback are identical; only `upgrade.requestedBy` names the operator, as `{ operator: email }`.
- **Not shown to the customer:** `provisioning.forInstance` strips `requestedBy`, and the customer sees the run like any other.
- **No duplicates:** the maintenance API's idempotency keys come from the row's state, so a repeated request is answered by the run already started.
- **Errors:** a refusal, such as an engine that isn't running, answers `409 refused`. A maintenance API failure answers `502 maintenance_error`.
- **Audit:** the action calls the maintenance API between its own mutations, so its audit row is written when it finishes, success or failure, rather than in one mutation with the change.
- **The maintenance API's own audit names the Convex client, not the operator.** Only admin keys may name an operator there, and Convex does not hold one. The operator is in `opsAuditLog` and the backoffice's audit.

## Referral attribution

- A user's sign-up code is random and lives in `referralCodes`, made the first time they ask. A sign-up link carries it as `?ref=`; the client keeps it through sign-in and sends it once from onboarding to `referrals.capture`.
- `capture` writes one immutable `referrals` row per referred user, and the first capture wins. An unknown code, a self-referral, a user more than a day old and a repeat all answer success and write nothing, so the call does not reveal which codes exist.
- The row names the org once it exists; that status change is the only edit a row ever gets.
- The plane learns of an org through `ensure`, then reads its referral with `accounts.referral`. The `ensure` contract carries no body, so the referral is not sent with it. If the plane later wants it pushed at creation, the contract must accept it first; `ensureOrgBilling` in `convex/billingCommands.ts` is where it would be passed.
- No reward exists in this app. Rewards are the plane's.

## Consequences

- Each new operator capability is a deliberate ops route with its own DTO and audit row, never a generic table read.
- Sign-in keeps a Twitch user's display name and id, not their login, so users are found by Twitch id rather than login.
- Email addresses and Twitch identities are returned in full to every backoffice role.

```bash
bunx convex env set OPS_API_SECRET_BACKOFFICE "$(openssl rand 32 | basenc --base64url | tr -d =)"
```
