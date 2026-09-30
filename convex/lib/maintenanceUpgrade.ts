import type { Doc } from "../_generated/dataModel";

/**
 * What a maintenance-API callback about a redeploy run does to a provisioning
 * row. Kept free of `ctx` so every row of the decision table can be tested
 * without a database; the mutation that calls it only applies the patch.
 *
 * A redeploy is how a managed engine changes release. One the user asked for
 * is an upgrade; the run the maintenance API queues when an upgrade fails
 * after stopping the engine is a rollback to the release it had.
 */

type ProvisioningRow = Doc<"engineProvisioning">;

export type UpgradeRow = Pick<ProvisioningRow, "status" | "runId" | "steps" | "reportedVersion" | "upgrade">;
export type RunStep = ProvisioningRow["steps"][number];
export type RedeployPatch = Partial<
  Pick<ProvisioningRow, "status" | "runId" | "steps" | "reportedVersion" | "upgrade" | "error">
>;

export type RedeployEvent =
  | { type: "engine.run.step"; runId: string | undefined; step: RunStep }
  | { type: "engine.ready"; version: string }
  | {
      type: "engine.failed";
      runId: string | undefined;
      step: string;
      error: string | undefined;
      /** The engine's status after the failure, as the maintenance API reports it. */
      engineStatus: string | undefined;
      /** The rollback the maintenance API queued, when the failed run had already stopped the engine. */
      rollbackRunId: string | undefined;
    };

/** A known step is updated in place and an unknown one appended, so the list keeps run order. */
export function mergeStep(steps: readonly RunStep[], step: RunStep): RunStep[] {
  const merged = [...steps];
  const index = merged.findIndex((existing) => existing.key === step.key);
  if (index === -1) {
    merged.push(step);
  } else {
    merged[index] = step;
  }
  return merged;
}

/**
 * The run's steps as the maintenance API listed them when it accepted the run,
 * except where a callback has already reported one: the run starts before its
 * listing is stored, so what the row holds for a step is the newer of the two.
 */
export function mergeRunSnapshot(reported: readonly RunStep[], snapshot: readonly RunStep[]): RunStep[] {
  return snapshot.map((step) => reported.find((existing) => existing.key === step.key) ?? step);
}

/**
 * Whether a failed row failed in a redeploy run rather than while being built
 * or registered. The repairs differ: a redeploy is resumed, and its engine is
 * already registered.
 */
export function redeployRunFailed(row: Pick<ProvisioningRow, "status" | "upgrade">): boolean {
  return row.status === "failed" && row.upgrade?.outcome === "failed";
}

/** The patch a redeploy event calls for, or null when the event does not concern the row as it stands. */
export function decideRedeployEvent(row: UpgradeRow, event: RedeployEvent): RedeployPatch | null {
  // Deleting an engine cancels its run, and a report from that run arriving
  // afterwards must not bring the row back.
  if (row.status === "deprovisioning" || row.status === "deleted") {
    return null;
  }

  switch (event.type) {
    case "engine.run.step": {
      if (event.runId === undefined) {
        return null;
      }
      // An upgrade is recorded before the maintenance API is asked for it, so
      // its first reports can arrive before the row has been told the run's id.
      const awaitingRunId = row.status === "upgrading" && row.runId === undefined;
      if (!awaitingRunId && event.runId !== row.runId) {
        return null;
      }
      return { runId: event.runId, steps: mergeStep(row.steps, event.step) };
    }

    case "engine.ready": {
      // A failed redeploy that someone resumed ends here too: its engine was
      // registered before the upgrade and still is.
      if (row.status === "upgrading" || redeployRunFailed(row)) {
        const patch: RedeployPatch = { status: "registered", reportedVersion: event.version, error: undefined };
        if (row.upgrade) {
          // A rollback ends in the same event as an upgrade; the version the
          // engine came back on says which one this was.
          const outcome = event.version === row.upgrade.toVersion ? "succeeded" : "rolled_back";
          patch.upgrade = { ...row.upgrade, outcome };
        }
        return patch;
      }
      if (row.status === "registered") {
        return { reportedVersion: event.version };
      }
      return null;
    }

    case "engine.failed": {
      const error = `${event.step}: ${event.error ?? "the maintenance API reported a failure"}`;
      if (event.rollbackRunId !== undefined) {
        const patch: RedeployPatch = { runId: event.rollbackRunId, steps: [] };
        if (row.upgrade) {
          patch.upgrade = { ...row.upgrade, rollingBack: true, error };
        }
        return patch;
      }

      const upgrade = row.upgrade ? { ...row.upgrade, outcome: "failed" as const, error } : undefined;
      if (event.engineStatus === "ready") {
        // The run failed before it stopped anything, so the engine is still
        // serving the release it had.
        return upgrade ? { status: "registered", upgrade } : { status: "registered" };
      }
      // Retry resumes the row's run, so the row names the run that failed.
      const failed: RedeployPatch = { status: "failed", error, runId: event.runId ?? row.runId };
      if (upgrade) {
        failed.upgrade = upgrade;
      }
      return failed;
    }
  }
}
