import { describe, expect, test } from "bun:test";
import type { CompanionLinkStatus } from "@desktop-host/window";
import { type AppLinkGate, type AppLinkViewer, appLinkGate, needsAppLink } from "./app-link";

const NONE: ReadonlySet<string> = new Set();

describe("appLinkGate", () => {
  const cases: [string, AppLinkViewer<string>, ReadonlySet<string>, AppLinkGate<string>][] = [
    ["waits for the instance", { instanceId: undefined, isAdmin: true }, NONE, { kind: "wait" }],
    ["waits for the role", { instanceId: "i1", isAdmin: undefined }, NONE, { kind: "wait" }],
    ["skips without an instance", { instanceId: null, isAdmin: false }, NONE, { kind: "skip" }],
    ["skips a viewer below admin", { instanceId: "i1", isAdmin: false }, NONE, { kind: "skip" }],
    ["skips an instance already tried", { instanceId: "i1", isAdmin: true }, new Set(["i1"]), { kind: "skip" }],
    [
      "checks an admin's instance",
      { instanceId: "i1", isAdmin: true },
      new Set(["i2"]),
      { kind: "check", instanceId: "i1" },
    ],
  ];
  for (const [name, viewer, attempted, expected] of cases) {
    test(name, () => {
      expect(appLinkGate(viewer, attempted)).toEqual(expected);
    });
  }
});

describe("needsAppLink", () => {
  function status(linked: CompanionLinkStatus["linked"]): CompanionLinkStatus {
    return { linked, installationId: "id", deviceName: "STREAM-PC", companionVersion: "0.1.0" };
  }

  const cases: [string, CompanionLinkStatus, boolean][] = [
    ["links a computer that is no one's companion", status(null), true],
    ["leaves the instance's companion alone", status({ instanceId: "i1", instanceName: "Main" }), false],
    ["moves a companion of another instance", status({ instanceId: "i2", instanceName: "Other" }), true],
    ["leaves a pairing that names no instance id alone", status({ instanceId: null, instanceName: "Main" }), false],
  ];
  for (const [name, read, expected] of cases) {
    test(name, () => {
      expect(needsAppLink(read, "i1")).toBe(expected);
    });
  }
});
