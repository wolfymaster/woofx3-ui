import { describe, expect, test } from "bun:test";
import { type EngineUpgrade, upgradeHeading, upgradeResult } from "./engine-upgrade";

const upgrade: EngineUpgrade = { fromVersion: "v0.1.0", toVersion: "v0.2.0", rollingBack: false };

describe("upgradeHeading", () => {
  test("names the release the engine is moving to", () => {
    expect(upgradeHeading(upgrade)).toBe("Upgrading to v0.2.0");
  });

  test("names the release being restored once the upgrade is rolling back", () => {
    expect(upgradeHeading({ ...upgrade, rollingBack: true })).toBe("Restoring v0.1.0");
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
      message: "Upgraded to v0.2.0.",
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
      message: "v0.2.0 didn't start, so we restored v0.1.0. Nothing was lost.",
      detail: "await_healthy: timeout",
    });
  });

  test("reports an upgrade that never touched the engine", () => {
    const failed = { ...upgrade, outcome: "failed" as const, error: "resolve_release: no such tag" };
    expect(upgradeResult("registered", failed)).toEqual({
      tone: "warning",
      message: "The upgrade couldn't start; your engine wasn't touched.",
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
