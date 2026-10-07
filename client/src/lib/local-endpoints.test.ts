import { describe, expect, test } from "bun:test";
import {
  COMPANION_ONLINE_WINDOW_MS,
  formatEndpointAddress,
  type LocalEndpointSituationInput,
  localEndpointSituation,
} from "./local-endpoints";

const NOW = 1_700_000_000_000;

function input(overrides: Partial<LocalEndpointSituationInput> = {}): LocalEndpointSituationInput {
  return {
    capability: "supported",
    bridgeAvailable: true,
    companion: { deviceName: "STREAM-PC", lastSeenAt: NOW - 30_000, confirmed: true },
    state: { enabled: true, address: { host: "127.0.0.1", port: 4455 } },
    now: NOW,
    ...overrides,
  };
}

describe("localEndpointSituation", () => {
  test("is unsupported without the engine capability or the deployment's bridge", () => {
    expect(localEndpointSituation(input({ capability: "unsupported" }))).toEqual({ kind: "unsupported" });
    expect(localEndpointSituation(input({ capability: "checking" }))).toEqual({ kind: "unsupported" });
    expect(localEndpointSituation(input({ bridgeAvailable: false }))).toEqual({ kind: "unsupported" });
  });

  test("goes through the companion when it has the endpoint turned on", () => {
    expect(localEndpointSituation(input())).toEqual({
      kind: "viaCompanion",
      deviceName: "STREAM-PC",
      online: true,
      address: "127.0.0.1:4455",
    });
  });

  test("reports a companion that has not been seen for three minutes as offline", () => {
    const stale = input({
      companion: { deviceName: "STREAM-PC", lastSeenAt: NOW - COMPANION_ONLINE_WINDOW_MS, confirmed: true },
    });
    expect(localEndpointSituation(stale)).toMatchObject({ kind: "viaCompanion", online: false });
  });

  test("found nothing when the endpoint is off or has no row", () => {
    expect(localEndpointSituation(input({ state: null }))).toEqual({
      kind: "companionNothingFound",
      deviceName: "STREAM-PC",
      online: true,
    });
    expect(localEndpointSituation(input({ state: { enabled: false, address: null } })).kind).toBe(
      "companionNothingFound"
    );
  });

  test("an unconfirmed companion counts as none", () => {
    expect(localEndpointSituation(input({ companion: null }))).toEqual({ kind: "noCompanion" });
    const unconfirmed = input({ companion: { deviceName: "STREAM-PC", lastSeenAt: NOW, confirmed: false } });
    expect(localEndpointSituation(unconfirmed)).toEqual({ kind: "noCompanion" });
  });
});

describe("formatEndpointAddress", () => {
  test("brackets an IPv6 literal", () => {
    expect(formatEndpointAddress({ host: "::1", port: 4455 })).toBe("[::1]:4455");
    expect(formatEndpointAddress({ host: "obs.local", port: 4455 })).toBe("obs.local:4455");
  });
});
