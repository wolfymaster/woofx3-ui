import { describe, expect, it } from "bun:test";
import {
  buildElapsedLabel,
  engineBuildElapsedMinutes,
  engineBuildIsSlow,
  engineBuildNote,
  engineBuildPercent,
  engineBuildPhaseDetail,
  engineBuildPhaseIndex,
  engineBuildPhaseLabel,
  engineBuildPhases,
  SLOW_BUILD_AFTER_MINUTES,
} from "@/lib/engine-build";

function step(label: string, status: string, detail?: string) {
  return detail === undefined ? { label, status } : { label, status, detail };
}

const DONE = [
  step("Pull engine image", "succeeded"),
  step("Create database", "succeeded"),
  step("Install alert modules", "succeeded"),
  step("Register engine", "succeeded"),
];

describe("engineBuildPhaseIndex", () => {
  it("follows the running step's label", () => {
    expect(engineBuildPhaseIndex("provisioning", [step("Start container", "running")])).toBe(0);
    expect(engineBuildPhaseIndex("provisioning", [step("Apply database schema", "running")])).toBe(1);
    expect(engineBuildPhaseIndex("provisioning", [step("Seed default alerts", "running")])).toBe(2);
    expect(engineBuildPhaseIndex("provisioning", [step("Register engine", "running")])).toBe(3);
  });

  it("falls back to completed progress for a label it does not know", () => {
    const noProgress = [
      step("Something new", "running"),
      step("Install alert modules", "todo"),
      step("Register engine", "todo"),
      step("Finish up", "todo"),
    ];
    const halfway = [
      step("Pull engine image", "succeeded"),
      step("Create database", "succeeded"),
      step("Something new", "running"),
      step("Register engine", "todo"),
    ];
    expect(engineBuildPhaseIndex("provisioning", noProgress)).toBe(0);
    expect(engineBuildPhaseIndex("provisioning", halfway)).toBe(2);
  });

  it("puts a registering or ready run on the dashboard stage", () => {
    expect(engineBuildPhaseIndex("registering", [])).toBe(3);
    expect(engineBuildPhaseIndex("ready", [])).toBe(3);
  });

  it("puts a run with every step finished on the dashboard stage", () => {
    expect(engineBuildPhaseIndex("provisioning", DONE)).toBe(3);
  });

  it("starts at the first stage before any step reports", () => {
    expect(engineBuildPhaseIndex("requested", [])).toBe(0);
  });
});

describe("engineBuildPhases", () => {
  it("marks earlier stages done, the current one current, and the rest todo", () => {
    const phases = engineBuildPhases("provisioning", [
      step("Pull engine image", "succeeded"),
      step("Create database", "succeeded"),
      step("Install alert modules", "running"),
    ]);
    expect(phases.map((phase) => phase.state)).toEqual(["done", "done", "current", "todo"]);
    expect(phases[2].label).toBe(engineBuildPhaseLabel("provisioning", [step("Install alert modules", "running")]));
    expect(phases[2].detail).toBe(engineBuildPhaseDetail("provisioning", [step("Install alert modules", "running")]));
  });
});

describe("engineBuildPercent", () => {
  it("shows a started bar before any step reports", () => {
    expect(engineBuildPercent([])).toBe(5);
  });

  it("counts succeeded and skipped steps", () => {
    expect(engineBuildPercent([{ status: "succeeded" }, { status: "skipped" }, { status: "running" }])).toBe(67);
  });

  it("never drops below a started bar", () => {
    expect(engineBuildPercent([{ status: "pending" }, { status: "pending" }])).toBe(5);
  });

  it("reaches 100 when the run is finished", () => {
    expect(engineBuildPercent([{ status: "succeeded" }, { status: "succeeded" }])).toBe(100);
  });
});

describe("slowness", () => {
  it("changes tone only at the slow threshold", () => {
    expect(engineBuildIsSlow(SLOW_BUILD_AFTER_MINUTES - 1)).toBe(false);
    expect(engineBuildIsSlow(SLOW_BUILD_AFTER_MINUTES)).toBe(true);
  });

  it("counts whole minutes without going negative", () => {
    const createdAt = 1_000;
    expect(engineBuildElapsedMinutes(createdAt, createdAt + 59_999)).toBe(0);
    expect(engineBuildElapsedMinutes(createdAt, createdAt + 60_000)).toBe(1);
    expect(engineBuildElapsedMinutes(createdAt, createdAt - 60_000)).toBe(0);
    expect(engineBuildElapsedMinutes(undefined, createdAt)).toBe(0);
  });

  it("reads naturally at every minute", () => {
    expect(buildElapsedLabel(0)).toBe("Just started");
    expect(buildElapsedLabel(1)).toBe("About a minute in");
    expect(buildElapsedLabel(4)).toBe("About 4 minutes in");
  });
});

describe("engineBuildNote", () => {
  it("returns the running step's own detail", () => {
    expect(engineBuildNote([step("Create database", "running", " Waiting for a database slot. ")])).toBe(
      "Waiting for a database slot."
    );
  });

  it("has nothing to say without a running step or detail", () => {
    expect(engineBuildNote([step("Create database", "running")])).toBeNull();
    expect(engineBuildNote([step("Create database", "succeeded", "Done")])).toBeNull();
    expect(engineBuildNote([])).toBeNull();
  });
});
