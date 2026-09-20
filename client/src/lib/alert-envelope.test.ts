import { describe, expect, test } from "bun:test";
import { alertEventType, alertTarget } from "./alert-envelope";

const envelope = JSON.stringify({
  id: "env-1",
  parameters: { target: "default", layout: { width: 1920, height: 1080, widgets: [] } },
  event: { id: "evt-1", type: "channel.follow", platform: "twitch" },
});

describe("alertTarget", () => {
  test("reads the alert widget the dispatch was aimed at", () => {
    expect(alertTarget(envelope)).toBe("default");
  });

  test("is null when the envelope names no target", () => {
    expect(alertTarget(JSON.stringify({ parameters: { layout: {} } }))).toBeNull();
  });

  // The payload is engine-authored JSON nothing here has validated, and it
  // reaches the UI precisely when something has gone wrong with it.
  test("survives a payload that is not an envelope", () => {
    expect(alertTarget("not json")).toBeNull();
    expect(alertTarget("[]")).toBeNull();
    expect(alertTarget(JSON.stringify({ parameters: "default" }))).toBeNull();
    expect(alertTarget(undefined)).toBeNull();
  });
});

describe("alertEventType", () => {
  test("reads the CloudEvent type that led to the alert", () => {
    expect(alertEventType(envelope)).toBe("channel.follow");
  });

  // The engine stamps `"event": null` for a manual, scheduled or chat-command
  // dispatch, which has no originating event to name.
  test("is null for a dispatch with no originating event", () => {
    expect(alertEventType(JSON.stringify({ parameters: {}, event: null }))).toBeNull();
  });

  test("survives a payload that is not an envelope", () => {
    expect(alertEventType("{")).toBeNull();
    expect(alertEventType(JSON.stringify({ event: { type: "" } }))).toBeNull();
  });
});
