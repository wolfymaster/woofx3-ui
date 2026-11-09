# Organization migration runbook

What to do with each violation that `migrations/organizations:checkOrgInvariantsAll` (M5) reports after the organization migrations ran (order and commands: [Data migrations](./deploy.md#data-migrations)). The migrations only insert and patch, so the cases below are left for an operator on purpose: each needs a judgement about which data is right.

Rows are fixed on the Convex dashboard's **Data** page for the deployment (production: add `--prod` to every command). After a fix, run the migration named in the step again. It has already finished, so run it with `"reset": true` once `lib:getStatus` shows it is not `inProgress`:

```bash
bunx convex run migrations/index:run '{"fn": "migrations/organizations:orgOwnerRows", "reset": true}'
```

Then run M5 again. Violations that are not listed here (`I1` to `I4`, `managed_engine_without_subscription`) mean M1, M2 or M3 has not run to `success` yet: check `lib:getStatus` and finish or resume it.

## `duplicate_membership`

```json
{ "invariant": "duplicate_membership", "accountId": "...", "userId": "...", "rows": 2 }
```

The user has several `accountMembers` rows in the org. Every membership lookup reads the first one, so the others are dead weight that can come back if the first is removed. When the user is the org's owner, M1 logged `org has several membership rows for its owner; left for an operator`, left those rows as they were and still migrated the org's other members.

1. Open `accountMembers`, filter by `accountId`, and find the user's rows.
2. Keep one: for the owner, the row with `role: "owner"` (or the oldest when none has it); for anyone else, the row with the highest role. Delete the others.
3. Run M1 again (`migrations/organizations:orgOwnerRows`), which sets the kept owner row to `owner` and grants the owner its engines.

## `owner_user_missing`

```json
{ "invariant": "owner_user_missing", "accountId": "...", "userId": "..." }
```

The org's `ownerId` names a user that no longer exists. M1 migrated the org's other members but could not give the owner a row or its engines. M3 still started the org's trial if it has a managed engine, so billing runs, but its warnings go to nobody.

1. Decide who owns the org now, usually its longest-standing admin. If nobody is left, the org is abandoned: leave it, and stop its managed engines when its trial lapses.
2. On `accounts`, set the org's `ownerId` to that user.
3. Run M1 again, then M5.

## `member_user_missing`

```json
{ "invariant": "member_user_missing", "accountId": "...", "userId": "...", "instanceId": "..." }
```

A membership row belongs to a user that no longer exists: an `accountMembers` row, or an `instanceMembers` row when `instanceId` is present. M1 and M2 skipped it and logged `user is gone; skipped`, so no access was granted from it. The row grants nothing to anyone, but it still counts against the org's seats.

1. Delete the row named by `accountId` and `userId` (in `instanceMembers`, by `instanceId` and `userId`).
2. Run M5 again. No migration needs to run.

## `orphan_engine`

```json
{ "invariant": "orphan_engine", "accountId": "...", "instanceId": "..." }
```

The `instances` row points at an org that no longer exists. Nobody can reach the engine from the dashboard, and M2 logged its memberships as `engine membership without an engine or org`.

1. Check `engineProvisioning` for the `instanceId`. A managed engine still running costs money: deprovision it first.
2. Delete the `instances` row and its `instanceMembers` rows.

## `comped_not_exempt`

```json
{ "invariant": "subscription", "accountId": "...", "detail": "comped_not_exempt" }
```

The org has an active operator plan assignment on a tier plan (`starter` or `pro`) but its subscription is not `exempt`.

- If M6 (`migrations/subscriptions:exemptionsFromPlanAssignments`) has not run yet, run it: it also converts a trial that M3 started.
- If it has run, the subscription was changed since (the org paid, or an operator moved it). M6 leaves those alone. Decide whether the comp still applies: grant the exemption through the ops API (`POST /api/ops/accounts/:id/exemption`, see [Ops API](../patterns/ops-api.md)), or remove the plan assignment.
