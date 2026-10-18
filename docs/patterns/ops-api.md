# Ops API

## Context

The internal backoffice (woofx3-maintenance `backoffice/`) shows operators managed engines from the maintenance API. It also needs the users, accounts and instances behind them, and later has to change plans and act on customer engines. None of that is reachable from outside Convex:

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
| `GET /api/ops/accounts/:id` | An account, its members, pending invitations, resolved entitlements, instances, and each instance's provisioning. |
| `GET /api/ops/engines?status=&cursor=` | Every `engineProvisioning` row, or those in one status, for drift checks against the maintenance API. |
| `GET /api/ops/engines/capabilities?days=` | For each capability id, how many recently active instances have and lack it, by hosting, and the engine versions they run. See below. |
| `GET /api/ops/engines/by-maintenance-id/:engineId` | One managed engine's provisioning row, instance and account. |
| `GET /api/ops/instances/:id/health` | Live state, sync state, recent alerts and failing workflows. |
| `GET /api/ops/audit?actor=&target=&cursor=` | The audit log, newest first, for one operator or one target. |
| `GET /api/ops/plans` | Every plan with how many accounts are on it, resolved as entitlements are: an active assignment's plan, else the default. Walks every account and assignment a page per query, so it is not a single snapshot; the backoffice prices it for expected revenue. |

List routes are cursor-paginated: pass back `cursor` until it is `null`.

`GET /api/ops/engines/capabilities` is what an operator checks before [retiring a capability check](./engine-capabilities.md#retiring-a-capability-check). An instance counts as recently active when its engine answered Convex within `days` (a whole number from 1 to 365, default 30; anything else answers `400 invalid_days`). Like `plans`, it reads a page per query, so it is not a single snapshot. Every count is `{ managed, external }`; an instance with no `hosting` is external.

```ts
{
  days: number;
  activeSince: number;        // ms epoch: engineSeenAt at or after this counts
  countedAt: number;
  minimumSupportedVersion: string | null;
  instances: { managed: number; external: number };    // recently active
  unreported: { managed: number; external: number };   // active, no capability list recorded yet
  belowMinimum: { managed: number; external: number }; // 0 while no minimum is set; "dev" and other non-releases never count
  capabilities: {
    id: string;
    known: boolean;           // whether this dashboard gates on it
    have: { managed: number; external: number };
    lack: { managed: number; external: number };       // listed capabilities without this id; excludes `unreported`
  }[];                        // every known id plus every reported id, sorted by id
  versions: {
    version: string | null;   // as reported; null when none was
    count: { managed: number; external: number };
    belowMinimum: boolean;
  }[];                        // newest release first, then non-release versions, then null
}
```

Operators act on a customer's managed engine exactly as the customer could:

| Route | Does |
|---|---|
| `POST /api/ops/engines/:instanceId/upgrade` | The customer's upgrade, to the offered release. |
| `POST /api/ops/engines/:instanceId/retry` | The customer's retry of a failed run or registration. |
| `POST /api/ops/engines/:instanceId/delete` | The customer's delete: the engine is torn down, and the instance stays. |

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
