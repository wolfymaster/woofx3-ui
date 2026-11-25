import { describe, expect, test } from "bun:test";
import { parseLogRecord, reconnectDelay } from "./log-tail";

const config = { reconnectBaseMs: 1000, reconnectMaxMs: 30000 };
const record = { cursor: "api_1.log:42", timestamp: "t", service: "api", level: "info", message: "hi", metadata: {} };

describe("reconnectDelay", () => {
  test("doubles with each failure", () => {
    expect([0, 1, 2].map((n) => reconnectDelay(n, config, () => 1))).toEqual([1000, 2000, 4000]);
  });

  test("stays at the cap", () => {
    expect(reconnectDelay(20, config, () => 1)).toBe(30000);
  });

  test("jitter only shortens the wait, by at most half", () => {
    expect(reconnectDelay(0, config, () => 0)).toBe(500);
  });
});

describe("parseLogRecord", () => {
  test("a well-formed frame is a record", () => {
    expect(parseLogRecord(JSON.stringify(record))?.cursor).toBe("api_1.log:42");
  });

  test.each([
    ["not json", "{"],
    ["not an object", "3"],
    ["null", "null"],
    ["no cursor", JSON.stringify({ ...record, cursor: undefined })],
    ["a non-string message", JSON.stringify({ ...record, message: 7 })],
  ])("%s is dropped", (_name, data) => {
    expect(parseLogRecord(data)).toBeNull();
  });
});
