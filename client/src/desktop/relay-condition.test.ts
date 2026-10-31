import { describe, expect, test } from "bun:test";
import type { RelayView } from "@desktop-host/window";
import { RELAY_GRACE_MS, relayCondition, relayDownSince } from "./relay-condition";

const RETRYING: RelayView = { kind: "retrying", retryAt: 0, error: "socket closed" };

describe("relayCondition", () => {
  test.each<[string, RelayView]>([
    ["connected", { kind: "connected" }],
    ["not needed", { kind: "notNeeded" }],
  ])("%s is healthy", (_name, view) => {
    expect(relayCondition(view, null, 0)).toEqual({ kind: "healthy" });
  });

  test.each<[string, RelayView, boolean]>([
    ["displaced", { kind: "displaced" }, true],
    ["refused", { kind: "refused" }, true],
    ["unavailable", { kind: "unavailable" }, false],
  ])("%s is limited at once", (_name, view, canReconnect) => {
    expect(relayCondition(view, null, 0)).toMatchObject({ kind: "limited", canReconnect });
  });

  test.each<[string, RelayView]>([
    ["connecting", { kind: "connecting" }],
    ["retrying", RETRYING],
  ])("%s is healthy within the grace period and limited after it", (_name, view) => {
    expect(relayCondition(view, 1000, 1000 + RELAY_GRACE_MS - 1)).toEqual({ kind: "healthy" });
    expect(relayCondition(view, 1000, 1000 + RELAY_GRACE_MS)).toMatchObject({ kind: "limited", canReconnect: false });
  });
});

describe("relayDownSince", () => {
  test("starts when the relay starts trying", () => {
    expect(relayDownSince({ kind: "connecting" }, null, 5)).toBe(5);
  });

  test("keeps its start across retries, so repeated failures can't reset the grace period", () => {
    expect(relayDownSince(RETRYING, 5, 9)).toBe(5);
    expect(relayDownSince({ kind: "connecting" }, 5, 12)).toBe(5);
  });

  test("clears once the relay stops trying", () => {
    expect(relayDownSince({ kind: "connected" }, 5, 12)).toBeNull();
    expect(relayDownSince({ kind: "displaced" }, 5, 12)).toBeNull();
  });
});
