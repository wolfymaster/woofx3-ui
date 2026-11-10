import { describe, expect, test } from "bun:test";
import { type EngineSwitchMove, type ProvisioningStatus, switchedStatus } from "./engineSwitch";

describe("switchedStatus", () => {
  const cases: Array<[ProvisioningStatus, EngineSwitchMove, ProvisioningStatus | null]> = [
    ["registered", "stopRequested", "stopping"],
    ["failed", "stopRequested", "stopping"],
    ["stopping", "stopRequested", "stopping"],
    ["stopped", "stopRequested", null],
    ["deleted", "stopRequested", null],
    ["stopping", "stopped", "stopped"],
    ["registered", "stopped", "stopped"],
    ["deleted", "stopped", null],
    ["stopped", "startRequested", "starting"],
    ["starting", "startRequested", "starting"],
    ["registered", "startRequested", null],
    ["starting", "started", "registered"],
    ["deprovisioning", "started", null],
    ["starting", "foundRunning", "registered"],
    ["stopped", "foundRunning", null],
    ["starting", "foundFailed", "failed"],
    ["stopping", "foundFailed", null],
    ["stopping", "refused", "failed"],
    ["starting", "refused", "failed"],
    ["registered", "refused", null],
    ["deleted", "refused", null],
  ];
  for (const [from, move, to] of cases) {
    test(`${from} + ${move} -> ${to ?? "refused"}`, () => {
      expect(switchedStatus(from, move)).toBe(to);
    });
  }
});
