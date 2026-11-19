import { describe, expect, test } from "bun:test";
import { engineHealth } from "./engine-health";

const hosted = { hosting: "managed", status: "registered" } as const;

describe("engineHealth", () => {
  test("a registered engine with nothing wrong is healthy", () => {
    expect(engineHealth({ engine: hosted, linkNeedsReconnect: false, lastEngineActivityAt: 1 }).label).toBe("Healthy");
  });

  test("a failed build needs attention", () => {
    const health = engineHealth({
      engine: { ...hosted, status: "failed" },
      linkNeedsReconnect: false,
      lastEngineActivityAt: null,
    });
    expect([health.label, health.tone]).toEqual(["Needs attention", "bad"]);
  });

  test.each(["provisioning", "registering", "upgrading"] as const)("%s reads as setting up", (status) => {
    expect(
      engineHealth({ engine: { ...hosted, status }, linkNeedsReconnect: false, lastEngineActivityAt: null }).label
    ).toBe("Setting up");
  });

  test("a paused engine is neutral", () => {
    const health = engineHealth({
      engine: { ...hosted, status: "stopped" },
      linkNeedsReconnect: false,
      lastEngineActivityAt: null,
    });
    expect([health.label, health.tone]).toEqual(["Paused", "neutral"]);
  });

  test("a self-hosted engine that never reported is not connected", () => {
    const health = engineHealth({
      engine: { hosting: "external", status: null },
      linkNeedsReconnect: false,
      lastEngineActivityAt: null,
    });
    expect(health.label).toBe("Not connected yet");
  });

  test("a self-hosted engine that has reported is healthy", () => {
    const health = engineHealth({
      engine: { hosting: "external", status: null },
      linkNeedsReconnect: false,
      lastEngineActivityAt: 5,
    });
    expect(health.label).toBe("Healthy");
  });

  test("a link the platform refused needs attention", () => {
    const health = engineHealth({ engine: hosted, linkNeedsReconnect: true, lastEngineActivityAt: 1 });
    expect([health.label, health.tone]).toEqual(["Needs attention", "warning"]);
  });
});
