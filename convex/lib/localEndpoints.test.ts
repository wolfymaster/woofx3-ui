import { describe, expect, test } from "bun:test";
import { localEndpointOwningSetting, localSettingKeys, readLocalEndpoints } from "./localEndpoints";

const OBS_ENDPOINT = {
  id: "obs",
  name: "OBS WebSocket",
  protocol: "websocket",
  hostSetting: "host",
  portSetting: "port",
  passwordSetting: "password",
  discover: { known: "obs-websocket" },
};

/** The OBS module's manifest as woofx3-modules modules/platform/obs/manifest.json 0.3.0 declares it. */
function obsManifest(local: unknown[] = [OBS_ENDPOINT]) {
  return {
    id: "woofx3_obs",
    name: "OBS",
    settings: [
      { id: "host", label: "Host", type: "text", defaultValue: "127.0.0.1" },
      { id: "port", label: "Port", type: "number" },
      { id: "password", label: "Password", type: "secret" },
      { id: "label", label: "Label", type: "text" },
    ],
    local,
  };
}

describe("readLocalEndpoints", () => {
  test("reads the OBS module's endpoint", () => {
    expect(readLocalEndpoints(obsManifest())).toEqual([OBS_ENDPOINT as never]);
  });

  test("is empty for a manifest without local[], or no manifest", () => {
    const { local: _local, ...withoutLocal } = obsManifest();
    expect(readLocalEndpoints(withoutLocal)).toEqual([]);
    expect(readLocalEndpoints(null)).toEqual([]);
    expect(readLocalEndpoints({ local: "obs" })).toEqual([]);
  });

  test("drops entries the engine would not have installed", () => {
    const malformed = [
      { ...OBS_ENDPOINT, id: "OBS" },
      { ...OBS_ENDPOINT, protocol: "udp" },
      { ...OBS_ENDPOINT, hostSetting: "missing" },
      { ...OBS_ENDPOINT, hostSetting: "port", portSetting: "host" },
      { ...OBS_ENDPOINT, passwordSetting: "label" },
      { ...OBS_ENDPOINT, name: "  " },
      { ...OBS_ENDPOINT, discover: {} },
      { ...OBS_ENDPOINT, discover: { mdns: "elg.tcp" } },
      { ...OBS_ENDPOINT, discover: { mdns: "_elg._tcp", known: "obs-websocket" } },
      "obs",
    ];
    for (const entry of malformed) {
      expect(readLocalEndpoints(obsManifest([entry]))).toEqual([]);
    }
  });

  test("keeps the first of two endpoints sharing an id or a setting", () => {
    const second = { ...OBS_ENDPOINT, id: "obs2", hostSetting: "label" };
    expect(readLocalEndpoints(obsManifest([OBS_ENDPOINT, OBS_ENDPOINT])).map((e) => e.id)).toEqual(["obs"]);
    expect(readLocalEndpoints(obsManifest([OBS_ENDPOINT, second])).map((e) => e.id)).toEqual(["obs"]);
  });

  test("accepts an endpoint without a password or discovery", () => {
    const { passwordSetting: _p, discover: _d, ...bare } = OBS_ENDPOINT;
    expect(readLocalEndpoints(obsManifest([{ ...bare, protocol: "http" }]))).toEqual([
      { ...bare, protocol: "http" } as never,
    ]);
  });

  test("reads an explicit null optional field as absent", () => {
    const withNulls = { ...OBS_ENDPOINT, passwordSetting: null, discover: null };
    const { passwordSetting: _p, discover: _d, ...expected } = OBS_ENDPOINT;
    expect(readLocalEndpoints(obsManifest([withNulls]))).toEqual([expected as never]);
    const nullKnown = { ...OBS_ENDPOINT, discover: { mdns: "_elg._tcp", known: null } };
    expect(readLocalEndpoints(obsManifest([nullKnown]))[0]?.discover).toEqual({ mdns: "_elg._tcp" });
  });

  test("accepts an mdns service type", () => {
    const endpoint = { ...OBS_ENDPOINT, discover: { mdns: "_elg._tcp" } };
    expect(readLocalEndpoints(obsManifest([endpoint]))[0]?.discover).toEqual({ mdns: "_elg._tcp" });
  });
});

describe("localSettingKeys and localEndpointOwningSetting", () => {
  test("name the endpoint's settings and their roles", () => {
    const [endpoint] = readLocalEndpoints(obsManifest());
    expect(localSettingKeys(endpoint)).toEqual(["host", "port", "password"]);
    expect(localEndpointOwningSetting(obsManifest(), "port")).toEqual({ endpoint, role: "port" });
    expect(localEndpointOwningSetting(obsManifest(), "password")?.role).toBe("password");
    expect(localEndpointOwningSetting(obsManifest(), "label")).toBeNull();
  });
});
