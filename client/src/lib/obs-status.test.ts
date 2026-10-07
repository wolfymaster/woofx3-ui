import { describe, expect, test } from "bun:test";
import { describeObsStatus } from "./obs-status";

describe("describeObsStatus", () => {
  test("says where it is connected", () => {
    expect(describeObsStatus({ state: "connected", failure: null, address: "obs.lan:4455" })).toEqual({
      tone: "ok",
      text: "Connected to OBS at obs.lan:4455",
    });
  });

  test("tells a refused password from an unreachable OBS", () => {
    expect(describeObsStatus({ state: "retrying", failure: "authentication", address: "obs.lan:4455" }).tone).toBe(
      "problem"
    );
    expect(describeObsStatus({ state: "retrying", failure: "authentication", address: null }).text).toContain(
      "refused the password"
    );
    expect(describeObsStatus({ state: "retrying", failure: "unreachable", address: "obs.lan:4455" }).text).toBe(
      "Can't reach OBS at obs.lan:4455. Check that OBS is open and its WebSocket server is on."
    );
  });

  test("does not blame OBS when the engine did not answer", () => {
    expect(describeObsStatus({ state: "unanswered", failure: null, address: null }).tone).toBe("unknown");
  });

  test("is pending while the first attempt runs", () => {
    expect(describeObsStatus({ state: "connecting", failure: null, address: "127.0.0.1:4455" })).toEqual({
      tone: "pending",
      text: "Connecting to OBS at 127.0.0.1:4455…",
    });
  });

  test("says the connection goes through the companion, without the relay's hostname", () => {
    expect(
      describeObsStatus({ state: "connected", failure: null, address: "c-abcdefghijkl.woofx3.tv", route: "companion" })
    ).toEqual({ tone: "ok", text: "Connected to OBS through the companion" });
  });

  test("tells a disconnected companion apart from a closed OBS", () => {
    const relay = describeObsStatus({ state: "retrying", failure: "relay", address: null, route: "companion" });
    expect(relay).toEqual({
      tone: "problem",
      text: "Your companion isn't connected, so the engine can't reach OBS. Open the woofx3 companion on your PC.",
    });
  });
});
