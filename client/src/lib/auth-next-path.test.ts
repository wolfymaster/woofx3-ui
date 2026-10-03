import { describe, expect, test } from "bun:test";
import { safeNextPath, withNext } from "./auth-next-path";

describe("safeNextPath", () => {
  test("keeps a path on this site", () => {
    expect(safeNextPath("/auth/accept-invite?token=abc", "/")).toBe("/auth/accept-invite?token=abc");
  });

  test("refuses another site and anything that is not a path", () => {
    expect(safeNextPath("//evil.example", "/")).toBe("/");
    expect(safeNextPath("https://evil.example", "/")).toBe("/");
    expect(safeNextPath(null, "/auth/onboarding")).toBe("/auth/onboarding");
  });
});

describe("withNext", () => {
  test("carries the next path, encoded", () => {
    expect(withNext("/auth/register", "/auth/accept-invite?token=a&b")).toBe(
      "/auth/register?next=%2Fauth%2Faccept-invite%3Ftoken%3Da%26b"
    );
  });

  test("leaves the link alone without one", () => {
    expect(withNext("/auth/register", null)).toBe("/auth/register");
  });
});
