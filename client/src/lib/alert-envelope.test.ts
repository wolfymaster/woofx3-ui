import { describe, expect, test } from "bun:test";
import { alertEvent, alertEventData, alertEventType, alertOfTestEvent, alertTarget } from "./alert-envelope";

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

describe("alertEventData", () => {
  test("reads the originating event's data", () => {
    const payload = JSON.stringify({
      parameters: {},
      event: { type: "channel.follow", data: { userName: "wolfy_fan" } },
    });
    expect(alertEventData(payload)).toEqual({ userName: "wolfy_fan" });
  });

  test("is null without an event, or with data that is not an object", () => {
    expect(alertEventData(envelope)).toBeNull();
    expect(alertEventData(JSON.stringify({ parameters: {}, event: null }))).toBeNull();
    expect(alertEventData(JSON.stringify({ event: { data: ["a"] } }))).toBeNull();
    expect(alertEventData("not json")).toBeNull();
  });
});

describe("alertEvent", () => {
  test("reads the originating CloudEvent's id, type, source, time and data", () => {
    const payload = JSON.stringify({
      parameters: {},
      event: {
        id: "evt-1",
        type: "channel.cheer",
        source: "twitch",
        time: "2026-05-02T12:00:00Z",
        data: { userName: "alice" },
      },
    });
    expect(alertEvent(payload)).toEqual({
      id: "evt-1",
      type: "channel.cheer",
      source: "twitch",
      time: "2026-05-02T12:00:00Z",
      data: { userName: "alice" },
    });
  });

  test("is null without an event, and nulls each field that is missing", () => {
    expect(alertEvent(JSON.stringify({ parameters: {}, event: null }))).toBeNull();
    expect(alertEvent(JSON.stringify({ event: { type: "channel.follow", id: 7 } }))).toEqual({
      id: null,
      type: "channel.follow",
      source: null,
      time: null,
      data: null,
    });
  });
});

describe("alertOfTestEvent", () => {
  const envelope = (triggerId?: string) => JSON.stringify({ id: "e", event: { type: "channel.follow", triggerId } });

  test("finds the alert whose event carries the test's trigger id", () => {
    const real = { id: "real", payload: envelope() };
    const other = { id: "other", payload: envelope("not-this-one") };
    const mine = { id: "mine", payload: envelope("test-1") };
    expect(alertOfTestEvent([real, other, mine], "test-1")).toBe(mine);
  });

  test("finds nothing among alerts with no payload or no event", () => {
    expect(alertOfTestEvent([{}, { payload: "{}" }, { payload: "not json" }], "test-1")).toBeUndefined();
  });
});
