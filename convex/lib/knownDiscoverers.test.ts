import { describe, expect, test } from "bun:test";
import { companionMayProvideSecret, KNOWN_DISCOVERER_SECRET_MODULES } from "./knownDiscoverers";
import type { LocalEndpoint } from "./localEndpoints";

const OBS: LocalEndpoint = {
  id: "obs",
  name: "OBS WebSocket",
  protocol: "websocket",
  hostSetting: "host",
  portSetting: "port",
  passwordSetting: "password",
  discover: { known: "obs-websocket" },
};

describe("companionMayProvideSecret", () => {
  test("lets obs-websocket hand the OBS module its password", () => {
    expect(KNOWN_DISCOVERER_SECRET_MODULES.get("obs-websocket")).toEqual(["woofx3_obs"]);
    expect(companionMayProvideSecret("woofx3_obs", OBS)).toBe(true);
  });

  test("refuses another module that declares the same discoverer", () => {
    expect(companionMayProvideSecret("someone_else", OBS)).toBe(false);
  });

  test("refuses an endpoint found by mDNS, by an unknown discoverer, or not discovered", () => {
    expect(companionMayProvideSecret("woofx3_obs", { ...OBS, discover: { mdns: "_obs._tcp" } })).toBe(false);
    expect(companionMayProvideSecret("woofx3_obs", { ...OBS, discover: { known: "toString" } })).toBe(false);
    const { discover: _discover, ...undiscovered } = OBS;
    expect(companionMayProvideSecret("woofx3_obs", undiscovered)).toBe(false);
  });
});
