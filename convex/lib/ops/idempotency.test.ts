import { describe, expect, test } from "bun:test";
import { parseIdempotencyKey, requestFingerprint } from "./idempotency";

describe("parseIdempotencyKey", () => {
  const cases: Array<[string, string | null, boolean]> = [
    ["a UUID", "3f1c2b9e-8d4a-4c1e-9a7b-2e5d6f8a0b1c", true],
    ["the shortest key", "abcdefgh", true],
    ["the longest key", "k".repeat(100), true],
    ["dots, colons and underscores", "ops:plan_1.retry", true],
    ["no header", null, false],
    ["an empty header", "", false],
    ["too short", "abcdefg", false],
    ["too long", "k".repeat(101), false],
    ["a space", "key with space", false],
    ["a slash", "key/with/slash", false],
    ["non-ASCII", "schlüssel-123", false],
  ];
  for (const [name, value, valid] of cases) {
    test(`${name} is ${valid ? "accepted" : "refused"}`, () => {
      const headers = new Headers(value === null ? {} : { "Idempotency-Key": value });
      const parsed = parseIdempotencyKey(headers);
      expect(parsed.ok).toBe(valid);
      if (parsed.ok) {
        expect(parsed.value).toBe(value ?? "");
      }
    });
  }
});

describe("requestFingerprint", () => {
  test("key order does not matter, at any depth", () => {
    expect(requestFingerprint({ spec: { percent: 5, kind: "percent_off" }, key: "a" })).toBe(
      requestFingerprint({ key: "a", spec: { kind: "percent_off", percent: 5 } })
    );
  });

  test("different values differ", () => {
    expect(requestFingerprint({ plan: "pro" })).not.toBe(requestFingerprint({ plan: "starter" }));
    expect(requestFingerprint({ until: null })).not.toBe(requestFingerprint({}));
  });
});
