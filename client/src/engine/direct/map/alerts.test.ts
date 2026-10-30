import { describe, expect, test } from "bun:test";
import type { AlertSnapshot } from "@woofx3/api";
import { ALERT_UNCONFIRMED_AFTER_MS, toEngineAlert } from "./alerts";

const UPDATED_AT = "2026-10-28T12:00:00.000Z";
const UPDATED_MS = Date.parse(UPDATED_AT);

function snapshot(overrides: Partial<AlertSnapshot> = {}): AlertSnapshot {
  return {
    id: "alert-1",
    payload: '{"text":"hi"}',
    workflowId: "run-1",
    sourceEventId: "event-1",
    status: "completed",
    createdAt: "2026-10-28T11:59:59.000Z",
    updatedAt: UPDATED_AT,
    ...overrides,
  };
}

describe("toEngineAlert", () => {
  test("maps the engine's snapshot, with its id as the record's", () => {
    expect(toEngineAlert(snapshot({ version: 3, envelopeId: "env-1" }), UPDATED_MS)).toEqual({
      id: "alert-1",
      engineAlertId: "alert-1",
      status: "completed",
      payload: '{"text":"hi"}',
      workflowId: "run-1",
      sourceEventId: "event-1",
      engineStatus: undefined,
      envelopeId: "env-1",
      dispatchedAt: undefined,
      playedAt: undefined,
      completedAt: undefined,
      error: undefined,
      engineCreatedAt: "2026-10-28T11:59:59.000Z",
      engineUpdatedAt: UPDATED_AT,
      engineVersion: 3,
      createdAt: Date.parse("2026-10-28T11:59:59.000Z"),
      progressedAt: UPDATED_MS,
      unconfirmedAt: undefined,
    });
  });

  test("reads the engine's empty strings as absent", () => {
    const alert = toEngineAlert(snapshot({ payload: "", workflowId: "", sourceEventId: "", error: "" }), UPDATED_MS);
    expect([alert.payload, alert.workflowId, alert.sourceEventId, alert.error]).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });

  test("keeps a status this build does not know as unknown, with the engine's value beside it", () => {
    const alert = toEngineAlert(snapshot({ status: "cancelled" }), UPDATED_MS);
    expect([alert.status, alert.engineStatus]).toEqual(["unknown", "cancelled"]);
  });

  test.each([
    ["an alert on its way that went quiet long enough", "playing", ALERT_UNCONFIRMED_AFTER_MS, true],
    ["an alert on its way that has not yet", "sent", ALERT_UNCONFIRMED_AFTER_MS - 1, false],
    ["an unknown status that went quiet", "cancelled", ALERT_UNCONFIRMED_AFTER_MS, true],
    ["a settled alert however long ago", "failed", ALERT_UNCONFIRMED_AFTER_MS * 10, false],
  ] as const)("unconfirmed: %s", (_case, status, quietMs, unconfirmed) => {
    const alert = toEngineAlert(snapshot({ status }), UPDATED_MS + quietMs);
    expect(alert.unconfirmedAt).toEqual(unconfirmed ? UPDATED_MS + ALERT_UNCONFIRMED_AFTER_MS : undefined);
  });

  test("refuses a time the engine never writes", () => {
    expect(() => toEngineAlert(snapshot({ createdAt: "yesterday" }), UPDATED_MS)).toThrow(/createdAt/);
  });
});
