import { describe, expect, it } from "bun:test";
import type { Id } from "../_generated/dataModel";
import {
  decideRedeployEvent,
  mergeRunSnapshot,
  type RedeployEvent,
  type RunStep,
  redeployRunFailed,
  type UpgradeRow,
} from "./maintenanceUpgrade";

const UPGRADE_RUN = "run_upgrade";
const ROLLBACK_RUN = "run_rollback";

const upgrade = {
  fromVersion: "v0.1.0",
  toVersion: "v0.2.0",
  requestedBy: "user_1" as Id<"users">,
  startedAt: 1_000,
  attempt: 1,
  rollingBack: false,
};

function step(key: string, status: RunStep["status"], detail?: string): RunStep {
  return detail === undefined ? { key, label: key, status } : { key, label: key, status, detail };
}

function upgradingRow(overrides: Partial<UpgradeRow> = {}): UpgradeRow {
  return {
    status: "upgrading",
    runId: UPGRADE_RUN,
    steps: [step("resolve_release", "succeeded"), step("deploy", "pending")],
    reportedVersion: "v0.1.0",
    upgrade,
    ...overrides,
  };
}

function stepEvent(
  runId: string | undefined,
  reported: RunStep,
  overrides: { targetVersion?: string; rollbackOf?: string } = {}
): RedeployEvent {
  return {
    type: "engine.run.step",
    runId,
    step: reported,
    targetVersion: overrides.targetVersion,
    rollbackOf: overrides.rollbackOf,
    receivedAt: 5_000,
  };
}

function failedEvent(overrides: Partial<Extract<RedeployEvent, { type: "engine.failed" }>> = {}): RedeployEvent {
  return {
    type: "engine.failed",
    runId: UPGRADE_RUN,
    step: "await_healthy",
    error: "timeout: the engine never became ready",
    engineStatus: undefined,
    rollbackRunId: undefined,
    ...overrides,
  };
}

describe("a step report", () => {
  it("updates the row's run in place, keeping why a step is waiting", () => {
    const patch = decideRedeployEvent(
      upgradingRow(),
      stepEvent(UPGRADE_RUN, step("deploy", "running", "deployment in progress"))
    );
    expect(patch).toEqual({
      runId: UPGRADE_RUN,
      steps: [step("resolve_release", "succeeded"), step("deploy", "running", "deployment in progress")],
    });
  });

  it("drops the waiting reason once the step moves on", () => {
    const row = upgradingRow({ steps: [step("deploy", "running", "deployment in progress")] });
    const patch = decideRedeployEvent(row, stepEvent(UPGRADE_RUN, step("deploy", "succeeded")));
    expect(patch?.steps).toEqual([step("deploy", "succeeded")]);
  });

  it("from another run is ignored", () => {
    expect(decideRedeployEvent(upgradingRow(), stepEvent("run_by_operator", step("deploy", "running")))).toBeNull();
    expect(decideRedeployEvent(upgradingRow(), stepEvent(undefined, step("deploy", "running")))).toBeNull();
  });

  it("from the failed upgrade is ignored once the row follows its rollback", () => {
    const row = upgradingRow({ runId: ROLLBACK_RUN, steps: [], upgrade: { ...upgrade, rollingBack: true } });
    expect(decideRedeployEvent(row, stepEvent(UPGRADE_RUN, step("await_healthy", "failed")))).toBeNull();
  });

  it("gives its run to an upgrade still waiting to learn it", () => {
    const row = upgradingRow({ runId: undefined, steps: [] });
    expect(decideRedeployEvent(row, stepEvent(UPGRADE_RUN, step("resolve_release", "running")))).toEqual({
      runId: UPGRADE_RUN,
      steps: [step("resolve_release", "running")],
    });
  });
});

describe("a step report from a run the row did not start", () => {
  const OPERATOR_RUN = "run_by_operator";
  const registered = (overrides: Partial<UpgradeRow> = {}) =>
    upgradingRow({ status: "registered", runId: "run_provision", steps: [], upgrade: undefined, ...overrides });

  it("puts a running engine into an upgrade to the run's release", () => {
    const patch = decideRedeployEvent(
      registered(),
      stepEvent(OPERATOR_RUN, step("resolve_release", "running"), { targetVersion: "v0.3.0-rc.1" })
    );
    expect(patch).toEqual({
      status: "upgrading",
      runId: OPERATOR_RUN,
      steps: [step("resolve_release", "running")],
      error: undefined,
      upgrade: { fromVersion: "v0.1.0", toVersion: "v0.3.0-rc.1", startedAt: 5_000, attempt: 0, rollingBack: false },
    });
  });

  it("replaces the outcome of the row's last upgrade, keeping its attempt count", () => {
    const row = registered({ upgrade: { ...upgrade, outcome: "succeeded", acknowledged: true } });
    const patch = decideRedeployEvent(
      row,
      stepEvent(OPERATOR_RUN, step("resolve_release", "running"), { targetVersion: "v0.3.0" })
    );
    expect(patch?.upgrade).toEqual({
      fromVersion: "v0.1.0",
      toVersion: "v0.3.0",
      startedAt: 5_000,
      attempt: 1,
      rollingBack: false,
    });
  });

  it("is still shown as upgrading when the run does not name its release", () => {
    const row = registered({ upgrade: { ...upgrade, outcome: "succeeded" } });
    const patch = decideRedeployEvent(row, stepEvent(OPERATOR_RUN, step("resolve_release", "running")));
    expect(patch).toMatchObject({ status: "upgrading", runId: OPERATOR_RUN });
    expect(patch?.upgrade).toBeUndefined();
  });

  it("is shown as upgrading with no versions when it is a rollback", () => {
    const patch = decideRedeployEvent(
      registered(),
      stepEvent(ROLLBACK_RUN, step("resolve_release", "running"), { targetVersion: "v0.1.0", rollbackOf: "run_x" })
    );
    expect(patch).toMatchObject({ status: "upgrading", runId: ROLLBACK_RUN });
    expect(patch?.upgrade).toBeUndefined();
  });

  it("from a run that has already finished does not start one", () => {
    expect(
      decideRedeployEvent(
        registered(),
        stepEvent(OPERATOR_RUN, step("complete", "succeeded"), { targetVersion: "v0.3.0" })
      )
    ).toBeNull();
  });

  it("from the row's own run only updates its steps", () => {
    const row = registered({ runId: UPGRADE_RUN });
    expect(decideRedeployEvent(row, stepEvent(UPGRADE_RUN, step("complete", "running")))).toEqual({
      runId: UPGRADE_RUN,
      steps: [step("complete", "running")],
    });
  });

  it("ends as an upgrade once the engine reports the run's release", () => {
    const adopted = decideRedeployEvent(
      registered(),
      stepEvent(OPERATOR_RUN, step("resolve_release", "running"), { targetVersion: "v0.3.0" })
    );
    const row = registered({ ...adopted, status: "upgrading" } as Partial<UpgradeRow>);
    expect(decideRedeployEvent(row, { type: "engine.ready", version: "v0.3.0" })).toMatchObject({
      status: "registered",
      reportedVersion: "v0.3.0",
      upgrade: { toVersion: "v0.3.0", outcome: "succeeded" },
    });
  });
});

describe("engine.ready", () => {
  it("on the offered release ends the upgrade as succeeded", () => {
    expect(decideRedeployEvent(upgradingRow(), { type: "engine.ready", version: "v0.2.0" })).toEqual({
      status: "registered",
      reportedVersion: "v0.2.0",
      error: undefined,
      upgrade: { ...upgrade, outcome: "succeeded" },
    });
  });

  it("on the previous release ends it as rolled back", () => {
    const row = upgradingRow({ runId: ROLLBACK_RUN, upgrade: { ...upgrade, rollingBack: true, error: "deploy: x" } });
    expect(decideRedeployEvent(row, { type: "engine.ready", version: "v0.1.0" })).toEqual({
      status: "registered",
      reportedVersion: "v0.1.0",
      error: undefined,
      upgrade: { ...upgrade, rollingBack: true, error: "deploy: x", outcome: "rolled_back" },
    });
  });

  it("after a failed rollback was resumed returns the row to registered", () => {
    const row = upgradingRow({
      status: "failed",
      runId: ROLLBACK_RUN,
      upgrade: { ...upgrade, rollingBack: true, outcome: "failed", error: "deploy: x" },
    });
    expect(decideRedeployEvent(row, { type: "engine.ready", version: "v0.1.0" })).toMatchObject({
      status: "registered",
      reportedVersion: "v0.1.0",
      upgrade: { outcome: "rolled_back" },
    });
  });

  it("on a registered row records the version and nothing else", () => {
    const row = upgradingRow({ status: "registered", upgrade: undefined });
    expect(decideRedeployEvent(row, { type: "engine.ready", version: "v0.3.0" })).toEqual({
      reportedVersion: "v0.3.0",
    });
  });
});

describe("engine.failed", () => {
  it("with a rollback queued follows the rollback and stays upgrading", () => {
    const patch = decideRedeployEvent(upgradingRow(), failedEvent({ rollbackRunId: ROLLBACK_RUN }));
    expect(patch).toEqual({
      runId: ROLLBACK_RUN,
      steps: [],
      upgrade: { ...upgrade, rollingBack: true, error: "await_healthy: timeout: the engine never became ready" },
    });
  });

  it("that left the engine ready returns the row to registered", () => {
    const patch = decideRedeployEvent(
      upgradingRow(),
      failedEvent({ step: "resolve_release", error: "release_not_found: no such tag", engineStatus: "ready" })
    );
    expect(patch).toEqual({
      status: "registered",
      upgrade: { ...upgrade, outcome: "failed", error: "resolve_release: release_not_found: no such tag" },
    });
  });

  it("of a rollback fails the row on the run a retry must resume", () => {
    const row = upgradingRow({ runId: ROLLBACK_RUN, upgrade: { ...upgrade, rollingBack: true } });
    const patch = decideRedeployEvent(
      row,
      failedEvent({ runId: ROLLBACK_RUN, step: "deploy", error: "host_error: no capacity", engineStatus: "failed" })
    );
    expect(patch).toEqual({
      status: "failed",
      error: "deploy: host_error: no capacity",
      runId: ROLLBACK_RUN,
      upgrade: { ...upgrade, rollingBack: true, outcome: "failed", error: "deploy: host_error: no capacity" },
    });
  });
});

describe("an engine being deleted", () => {
  it("is not brought back by a late report from its cancelled run", () => {
    const row = upgradingRow({ status: "deprovisioning" });
    expect(decideRedeployEvent(row, { type: "engine.ready", version: "v0.2.0" })).toBeNull();
    expect(decideRedeployEvent(row, failedEvent({ rollbackRunId: ROLLBACK_RUN }))).toBeNull();
    expect(decideRedeployEvent(row, stepEvent(UPGRADE_RUN, step("deploy", "running")))).toBeNull();
  });
});

describe("mergeRunSnapshot", () => {
  it("lists the run's steps in order, preferring what a callback already reported", () => {
    const reported = [step("resolve_release", "succeeded"), step("configure", "running")];
    const snapshot = [step("resolve_release", "pending"), step("configure", "pending"), step("pause_route", "pending")];
    expect(mergeRunSnapshot(reported, snapshot)).toEqual([
      step("resolve_release", "succeeded"),
      step("configure", "running"),
      step("pause_route", "pending"),
    ]);
  });
});

describe("redeployRunFailed", () => {
  it("is true only for a failed row whose upgrade failed", () => {
    expect(redeployRunFailed({ status: "failed", upgrade: { ...upgrade, outcome: "failed" } })).toBe(true);
    expect(redeployRunFailed({ status: "failed", upgrade: undefined })).toBe(false);
    expect(redeployRunFailed({ status: "registered", upgrade: { ...upgrade, outcome: "failed" } })).toBe(false);
  });
});
