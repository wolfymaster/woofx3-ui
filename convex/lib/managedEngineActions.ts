import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import {
  currentRelease,
  deleteEngine,
  getEngine,
  isMaintenanceConfigured,
  MaintenanceApiError,
  type MaintenanceRun,
  redeployEngine,
  redeployRefusal,
  retryRun,
} from "./maintenanceClient";
import { redeployRunFailed } from "./maintenanceUpgrade";
import { isUpgrade } from "./releaseVersion";

/**
 * What can be done to a managed engine once someone is allowed to: the
 * customer, through provisioning.ts after its membership check, or an
 * operator, through the ops API. Both paths run exactly this, so an
 * operator's upgrade, retry or delete leaves the same row, runs and
 * callbacks as the customer's own; only `upgrade.requestedBy` differs.
 */

/** Who asked for an upgrade: a member of the instance, or an operator by email. */
export type UpgradeRequester = Id<"users"> | { operator: string };

export type UpgradeRequestOutcome = "started" | "already_running" | "already_current" | "not_started";

export type RetryKind = "provisioning" | "registration" | "upgrade";

export function stepsOf(run: MaintenanceRun) {
  return (run.steps ?? []).map((step) => ({
    key: step.key,
    label: step.label,
    status: step.status,
    error: step.error ? `${step.error.code}: ${step.error.message}` : undefined,
  }));
}

/** The message a user should see when a maintenance call fails. */
export function userFacingError(error: unknown): string {
  if (error instanceof MaintenanceApiError) {
    return error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

/**
 * Whether engine owners are offered upgrades. Off until the engine releases on
 * offer are known to survive a rollback, since a failed upgrade restores the
 * previous release onto a database the new one has already migrated.
 */
export function upgradesEnabled(): boolean {
  return process.env.ENGINE_UPGRADES_ENABLED === "true" && isMaintenanceConfigured();
}

/**
 * Moves the engine to the release the maintenance API offers. The caller
 * picks when, never which release. A request the maintenance API declines is
 * an outcome, not an error: the reason is on the row, and the engine was
 * never touched.
 */
export async function upgradeManagedEngineRow(
  ctx: ActionCtx,
  row: Doc<"engineProvisioning">,
  requestedBy: UpgradeRequester
): Promise<{ outcome: UpgradeRequestOutcome }> {
  if (!upgradesEnabled()) {
    throw new Error("Engine upgrades are not available");
  }
  if (row.status === "upgrading") {
    return { outcome: "already_running" };
  }
  if (row.status !== "registered" || !row.maintenanceEngineId) {
    throw new Error("Only a running engine can be upgraded");
  }

  const engineId = row.maintenanceEngineId;
  const { version: toVersion } = await currentRelease();
  const fromVersion = row.reportedVersion ?? (await getEngine(engineId)).engine.image?.version;
  if (!fromVersion) {
    throw new Error("The engine's current release is unknown");
  }
  // The owner chooses when, never what, and never a step backwards from a
  // release an operator put the engine on.
  if (!isUpgrade(toVersion, fromVersion)) {
    return { outcome: "already_current" };
  }

  const begun = await ctx.runMutation(internal.provisioningInternal.beginUpgrade, {
    provisioningId: row._id,
    requestedBy,
    fromVersion,
    toVersion,
  });
  if (!begun.begun) {
    if (begun.status === "upgrading") {
      return { outcome: "already_running" };
    }
    throw new Error("Only a running engine can be upgraded");
  }

  let run: MaintenanceRun;
  try {
    ({ run } = await redeployEngine(engineId, `${row._id}:upgrade:${toVersion}:${begun.attempt}`));
  } catch (error) {
    const refusal = redeployRefusal(error);
    const alreadyCurrent = refusal === "already_current";
    await ctx.runMutation(internal.provisioningInternal.recordUpgradeNotStarted, {
      provisioningId: row._id,
      attempt: begun.attempt,
      alreadyCurrent,
      error:
        refusal === "run_in_progress" ? "Another operation is already running on this engine." : userFacingError(error),
    });
    return { outcome: alreadyCurrent ? "already_current" : "not_started" };
  }
  await ctx.runMutation(internal.provisioningInternal.recordUpgradeRun, {
    provisioningId: row._id,
    runId: run.id,
    steps: stepsOf(run),
  });
  return { outcome: "started" };
}

/** Resumes a failed run, or re-runs a registration that failed after the engine came up. */
export async function retryManagedEngineRow(
  ctx: ActionCtx,
  row: Doc<"engineProvisioning">
): Promise<{ retried: RetryKind }> {
  if (row.status === "deprovisioning") {
    throw new Error("This engine is being deleted");
  }

  const redeploy = redeployRunFailed(row);
  if (row.publicUrl && !redeploy) {
    await ctx.runMutation(internal.provisioningInternal.restartRegistration, { provisioningId: row._id });
    return { retried: "registration" };
  }
  if (!row.maintenanceEngineId || !row.runId) {
    throw new Error("This engine was never created — start it again instead");
  }

  try {
    // A resumed run keeps its id, so the key carries the row's last change
    // too: two clicks on one failure are the same request, but a second
    // failure of the same run can be retried again rather than answered from
    // the maintenance API's stored response.
    const idempotencyKey = `${row._id}:retry:${row.runId}:${row.updatedAt}`;
    const { run } = await retryRun(row.maintenanceEngineId, row.runId, idempotencyKey);
    await ctx.runMutation(internal.provisioningInternal.recordRetryStarted, {
      provisioningId: row._id,
      runId: run.id,
      steps: stepsOf(run),
      redeploy,
    });
    return { retried: redeploy ? "upgrade" : "provisioning" };
  } catch (error) {
    await ctx.runMutation(internal.provisioningInternal.recordProvisioningError, {
      provisioningId: row._id,
      error: userFacingError(error),
    });
    throw error;
  }
}

/** Starts tearing the engine down. The instance row stays; deleting it is a separate act. */
export async function deleteManagedEngineRow(
  ctx: ActionCtx,
  row: Doc<"engineProvisioning">
): Promise<{ deprovisioning: boolean }> {
  if (!row.maintenanceEngineId) {
    throw new Error("This workspace has no managed engine to delete");
  }

  await deleteEngine(row.maintenanceEngineId, `${row._id}:delete`);
  await ctx.runMutation(internal.provisioningInternal.recordDeprovisionStarted, { provisioningId: row._id });
  return { deprovisioning: true };
}
