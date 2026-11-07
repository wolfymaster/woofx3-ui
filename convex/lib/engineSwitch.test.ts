import { describe, expect, test } from "bun:test";
import { type EngineSwitchMove, type ProvisioningStatus, switchedStatus } from "./engineSwitch";

describe("switchedStatus", () => {
  const cases: Array<[ProvisioningStatus, EngineSwitchMove, ProvisioningStatus | null]> = [
    ["registered", "stopRequested", "stopping"],
    ["failed", "stopRequested", "stopping"],
    ["stopping", "stopRequested", null],
    ["stopped", "stopRequested", null],
    ["deleted", "stopRequested", null],
    ["stopping", "stopped", "stopped"],
    ["registered", "stopped", "stopped"],
    ["deleted", "stopped", null],
    ["stopped", "startRequested", "starting"],
    ["registered", "startRequested", null],
    ["starting", "started", "registered"],
    ["deprovisioning", "started", null],
    ["stopped", "foundRunning", "registered"],
    ["starting", "foundRunning", null],
    ["stopped", "foundFailed", "failed"],
    ["stopping", "foundFailed", null],
  ];
  for (const [from, move, to] of cases) {
    test(`${from} + ${move} -> ${to ?? "refused"}`, () => {
      expect(switchedStatus(from, move)).toBe(to);
    });
  }
});
