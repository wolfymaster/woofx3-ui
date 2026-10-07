import { describe, expect, test } from "bun:test";
import {
  isEndpointHost,
  isEndpointPort,
  localEndpointOwningSetting,
  localSettingKeys,
  planCompanionWrites,
  readLocalEndpoints,
  unapprovedLocalEndpointIds,
} from "./localEndpoints";

describe("isEndpointHost and isEndpointPort", () => {
  test("accept IP literals and DNS names", () => {
    for (const host of ["127.0.0.1", "192.168.1.20", "::1", "fe80::1", "obs-pc", "obs.local", "studio.example.com"]) {
      expect(isEndpointHost(host)).toBe(true);
    }
  });

  test("refuse anything carrying more than a host", () => {
    const refused = [
      "",
      "ws://127.0.0.1",
      "127.0.0.1:4455",
      "[::1]",
      "obs/path",
      "user@obs",
      "-obs",
      "a..b",
      "300.1.1.1",
    ];
    for (const host of refused) {
      expect(isEndpointHost(host)).toBe(false);
    }
  });

  test("ports are integers from 1 to 65535", () => {
    expect(isEndpointPort(4455)).toBe(true);
    expect(isEndpointPort(0)).toBe(false);
    expect(isEndpointPort(65536)).toBe(false);
    expect(isEndpointPort(44.5)).toBe(false);
  });
});

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

describe("planCompanionWrites", () => {
  const [endpoint] = readLocalEndpoints(obsManifest());

  test("writes only the keys local[] names", () => {
    expect(planCompanionWrites(endpoint, { host: "127.0.0.1", port: 4455 }, [], true)).toEqual([
      { key: "host", value: "127.0.0.1", secret: false },
      { key: "port", value: "4455", secret: false },
    ]);
  });

  test("leaves a key the streamer set by hand", () => {
    const provenance = [{ key: "port", source: "manual" as const }];
    expect(planCompanionWrites(endpoint, { port: 4455, password: "pw" }, provenance, true)).toEqual([
      { key: "password", value: "pw", secret: true },
    ]);
  });

  test("skips a value the companion already wrote, but never compares a secret", () => {
    const provenance = [
      { key: "port", source: "companion" as const, companionValue: "4455" },
      { key: "password", source: "companion" as const },
    ];
    expect(planCompanionWrites(endpoint, { port: 4455, password: "pw" }, provenance, true)).toEqual([
      { key: "password", value: "pw", secret: true },
    ]);
    expect(planCompanionWrites(endpoint, { port: 4456 }, provenance, true)).toEqual([
      { key: "port", value: "4456", secret: false },
    ]);
  });

  test("includes the password only when the report carries one", () => {
    expect(planCompanionWrites(endpoint, { port: 4455 }, [], true).map((w) => w.key)).toEqual(["port"]);
    const { passwordSetting: _p, ...withoutPassword } = endpoint;
    expect(planCompanionWrites(withoutPassword, { password: "pw" }, [], true)).toEqual([]);
  });

  test("refuses a password the companion may not provide", () => {
    expect(() => planCompanionWrites(endpoint, { port: 4455, password: "pw" }, [], false)).toThrow();
    expect(planCompanionWrites(endpoint, { port: 4455 }, [], false)).toEqual([
      { key: "port", value: "4455", secret: false },
    ]);
  });

  test("refuses a report that is not an address", () => {
    expect(() => planCompanionWrites(endpoint, { port: 0 }, [], true)).toThrow();
    expect(() => planCompanionWrites(endpoint, { port: 65536 }, [], true)).toThrow();
    expect(() => planCompanionWrites(endpoint, { port: 1.5 }, [], true)).toThrow();
    expect(() => planCompanionWrites(endpoint, { host: "http://obs" }, [], true)).toThrow();
  });
});

describe("unapprovedLocalEndpointIds", () => {
  test("lists declared endpoints outside the approval", () => {
    expect(unapprovedLocalEndpointIds(obsManifest(), [])).toEqual(["obs"]);
    expect(unapprovedLocalEndpointIds(obsManifest(), ["obs"])).toEqual([]);
    expect(unapprovedLocalEndpointIds({ id: "x" }, [])).toEqual([]);
  });
});
