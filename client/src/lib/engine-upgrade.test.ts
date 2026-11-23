import { describe, expect, test } from "bun:test";
import { type EngineUpgrade, upgradeHeading, upgradeResult } from "./engine-upgrade";

const upgrade: EngineUpgrade = { fromVersion: "v0.1.0", toVersion: "v0.2.0", rollingBack: false };

describe("upgradeHeading", () => {
  test("says woofx3 is updating", () => {
    expect(upgradeHeading(upgrade)).toBe("Updating woofx3");
  });

  test("says the previous version is restored once the update is rolling back", () => {
    expect(upgradeHeading({ ...upgrade, rollingBack: true })).toBe("Restoring your previous version");
  });
});

describe("upgradeResult", () => {
  test("says nothing while the upgrade has no outcome", () => {
    expect(upgradeResult("upgrading", upgrade)).toBeNull();
    expect(upgradeResult("registered", upgrade)).toBeNull();
    expect(upgradeResult("registered", undefined)).toBeNull();
  });

  test("reports a finished upgrade", () => {
    expect(upgradeResult("registered", { ...upgrade, outcome: "succeeded" })).toEqual({
      tone: "success",
      message: "woofx3 is up to date.",
    });
  });

  test("reports a rollback with the reason the release did not start", () => {
    const rolledBack = {
      ...upgrade,
      rollingBack: true,
      outcome: "rolled_back" as const,
      error: "await_healthy: timeout",
    };
    expect(upgradeResult("registered", rolledBack)).toEqual({
      tone: "warning",
      message: "The update didn't work, so we restored your previous version. Nothing was lost.",
      detail: "await_healthy: timeout",
    });
  });

  test("reports an upgrade that never touched the engine", () => {
    const failed = { ...upgrade, outcome: "failed" as const, error: "resolve_release: no such tag" };
    expect(upgradeResult("registered", failed)).toEqual({
      tone: "warning",
      message: "The update couldn't start. Nothing changed.",
      detail: "resolve_release: no such tag",
    });
  });

  test("leaves a failed engine to its error and Retry", () => {
    expect(upgradeResult("failed", { ...upgrade, outcome: "failed" })).toBeNull();
  });

  test("stays quiet once dismissed", () => {
    expect(upgradeResult("registered", { ...upgrade, outcome: "succeeded", acknowledged: true })).toBeNull();
  });
});
