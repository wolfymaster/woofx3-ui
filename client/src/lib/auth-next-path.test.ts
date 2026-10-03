import { describe, expect, test } from "bun:test";
import { safeNextPath, withNext } from "./auth-next-path";

describe("safeNextPath", () => {
  test("keeps a path on this site", () => {
    expect(safeNextPath("/auth/accept-invite?token=abc", "/")).toBe("/auth/accept-invite?token=abc");
    expect(safeNextPath("/companion/pair?code=BCDF-GHJK", "/")).toBe("/companion/pair?code=BCDF-GHJK");
    expect(safeNextPath("/", "/auth/onboarding")).toBe("/");
  });

  test("refuses another site and anything that is not a path", () => {
    expect(safeNextPath("//evil.example", "/")).toBe("/");
    expect(safeNextPath("https://evil.example", "/")).toBe("/");
    expect(safeNextPath(null, "/auth/onboarding")).toBe("/auth/onboarding");
    expect(safeNextPath("/\\evil.example", "/")).toBe("/");
    expect(safeNextPath("/%2F%2Fevil.example", "/auth/onboarding")).toBe("/auth/onboarding");
    expect(safeNextPath("javascript:alert(1)", "/")).toBe("/");
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
