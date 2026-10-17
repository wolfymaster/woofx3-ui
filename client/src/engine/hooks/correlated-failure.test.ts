import { describe, expect, test } from "bun:test";
import { failureForCurrentRequest } from "./correlated-failure";

describe("failureForCurrentRequest", () => {
  const failure = { correlationKey: "a", error: new Error("unreachable") };

  test("returns the failure of the current request", () => {
    expect(failureForCurrentRequest(failure, "a")).toBe(failure);
  });

  test("ignores the failure of a replaced request", () => {
    expect(failureForCurrentRequest(failure, "b")).toBeNull();
  });

  test("ignores a failure once the request is cleared", () => {
    expect(failureForCurrentRequest(failure, null)).toBeNull();
  });

  test("is null when nothing failed", () => {
    expect(failureForCurrentRequest(null, "a")).toBeNull();
  });
});
