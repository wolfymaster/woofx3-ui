import { describe, expect, test } from "bun:test";
import { toCapabilityReport } from "./capabilities";

describe("toCapabilityReport", () => {
  test("keeps the ids the contract gates on, sorted and unique, and is never legacy", () => {
    expect(toCapabilityReport(["obs.status", "engine.eventStream", "events.log", "obs.status"])).toEqual({
      legacy: false,
      capabilities: ["events.log", "obs.status"],
    });
  });

  test("an engine listing nothing the contract gates on supports none of it", () => {
    expect(toCapabilityReport(["engine.eventStream"])).toEqual({ legacy: false, capabilities: [] });
  });
});
