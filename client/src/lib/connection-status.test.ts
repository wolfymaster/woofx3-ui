import { describe, expect, test } from "bun:test";
import type { ObsStatus } from "@convex/lib/engineObsStatus";
import {
  type Connection,
  type ConnectionState,
  fitConnections,
  localModules,
  obsConnection,
  sortConnections,
  twitchConnection,
  unreportedConnection,
  worstState,
} from "./connection-status";

function connection(id: string, state: ConnectionState): Connection {
  return { id, label: id, state, detail: "" };
}

const OBS = { id: "woofx3_obs", label: "OBS" };

describe("localModules", () => {
  const manifest = {
    settings: [
      { id: "host", type: "text" },
      { id: "port", type: "number" },
    ],
    local: [{ id: "lights", name: "Lights", protocol: "websocket", hostSetting: "host", portSetting: "port" }],
  };
  const module = { name: "Lights", moduleKey: "lights_mod:1.0.0", status: "installed", manifest };

  test("reports any installed module declaring a local endpoint, by its manifest id", () => {
    expect(localModules([module])).toEqual([{ id: "lights_mod", label: "Lights" }]);
  });

  test.each([
    ["not installed", { ...module, status: "pending" }],
    ["without a local endpoint", { ...module, manifest: { settings: [] } }],
    ["with an unreadable manifest", { ...module, manifest: null }],
    ["without a module key", { ...module, moduleKey: undefined }],
  ])("leaves out a module %s", (_name, excluded) => {
    expect(localModules([excluded])).toEqual([]);
  });
});

test("a module nothing reports on makes no claim", () => {
  expect(unreportedConnection({ id: "lights_mod", label: "Lights" })).toMatchObject({
    id: "lights_mod",
    label: "Lights",
    state: "pending",
  });
});

describe("twitchConnection", () => {
  test("an instance with no link is disconnected", () => {
    expect(twitchConnection({ state: "unlinked" }, undefined).state).toBe("disconnected");
  });

  test("a link Twitch has revoked is disconnected", () => {
    expect(twitchConnection({ state: "revoked" }, "wolfy").state).toBe("disconnected");
  });

  test("a link missing required scopes is degraded and names what is missing", () => {
    const connection = twitchConnection(
      {
        state: "missing",
        missing: [{ label: "Clips", optional: false, missingScopes: ["clips:edit"] }],
        optionalMissing: [],
      },
      "wolfy"
    );
    expect(connection).toMatchObject({ state: "degraded", detail: "Missing permission for: Clips" });
  });

  test("a healthy link is connected and names the account", () => {
    const connection = twitchConnection({ state: "ok", optionalMissing: [] }, "wolfy");
    expect(connection).toMatchObject({ state: "connected", detail: "Connected as @wolfy" });
  });
});

describe("obsConnection", () => {
  const retrying = (failure: ObsStatus["failure"]): ObsStatus => ({ state: "retrying", failure, address: null });

  test.each<[string, ObsStatus | null, boolean, ConnectionState]>([
    ["no answer yet", null, false, "pending"],
    ["connected", { state: "connected", failure: null, address: "pc:4455" }, false, "connected"],
    ["connected even with the relay down", { state: "connected", failure: null, address: null }, true, "connected"],
    ["still connecting", { state: "connecting", failure: null, address: null }, false, "pending"],
    [
      "an engine that didn't answer is no verdict on OBS",
      { state: "unanswered", failure: null, address: null },
      false,
      "pending",
    ],
    ["unreachable", retrying("unreachable"), false, "disconnected"],
    ["wrong password", retrying("authentication"), false, "disconnected"],
    ["a relay failure waits on the app", retrying("relay"), false, "degraded"],
    ["a limited relay is the one problem to fix", retrying("unreachable"), true, "degraded"],
  ])("%s", (_name, status, relayLimited, state) => {
    expect(obsConnection(OBS, status, relayLimited).state).toBe(state);
  });
});

describe("sortConnections", () => {
  test("moves problems forward, worst first, and leaves the rest in order", () => {
    const sorted = sortConnections([
      connection("a", "connected"),
      connection("b", "degraded"),
      connection("c", "pending"),
      connection("d", "disconnected"),
      connection("e", "connected"),
    ]);
    expect(sorted.map(({ id }) => id)).toEqual(["d", "b", "a", "c", "e"]);
  });
});

describe("worstState", () => {
  test.each<[ConnectionState[], ConnectionState]>([
    [["connected", "connected"], "connected"],
    [["connected", "pending"], "pending"],
    [["pending", "degraded", "connected"], "degraded"],
    [["degraded", "disconnected"], "disconnected"],
  ])("%j is %s", (states, worst) => {
    expect(worstState(states.map((state, index) => connection(String(index), state)))).toBe(worst);
  });
});

describe("fitConnections", () => {
  const fit = { widths: [40, 40, 40], chipWidth: 20, gap: 10 };

  test.each<[string, number, number]>([
    ["everything fits exactly, with no chip", 140, 3],
    ["one short of fitting makes room for the chip", 139, 2],
    ["two names and the chip, exactly", 120, 2],
    ["one name and the chip", 119, 1],
    ["only the chip", 69, 0],
    ["no room at all still reports zero", 0, 0],
  ])("%s", (_name, available, count) => {
    expect(fitConnections({ ...fit, available })).toBe(count);
  });

  test("nothing to fit", () => {
    expect(fitConnections({ widths: [], chipWidth: 20, gap: 10, available: 0 })).toBe(0);
  });
});
