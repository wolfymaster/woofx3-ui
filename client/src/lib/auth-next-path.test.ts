import { describe, expect, test } from "bun:test";
import { safeNextPath, withNext } from "./auth-next-path";

describe("safeNextPath", () => {
  test("keeps a path on this site", () => {
    expect(safeNextPath("/auth/accept-invite?token=abc", "/")).toBe("/auth/accept-invite?token=abc");
    expect(safeNextPath("/account?checkout=done", "/")).toBe("/account?checkout=done");
    expect(safeNextPath("/admin/engine?tab=sync", "/")).toBe("/admin/engine?tab=sync");
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

describe("safeNextPath keeps the account portal links from the marketing site", () => {
  test.each([
    ["/account/", "/account/"],
    ["/account/?start=trial", "/account/?start=trial"],
    ["/account?start=trial", "/account?start=trial"],
  ])("%s", (next, expected) => {
    expect(safeNextPath(next, "/auth/onboarding")).toBe(expected);
  });
});

describe("a next carried through the register link", () => {
  test.each([
    "/auth/accept-invite?token=abc_DEF-123",
    "/auth/accept-invite?token=a%2Bb%3D",
    "/sponsor/start?amountCents=25000&interval=month",
  ])("%s survives the round trip and is followed", (next) => {
    const link = withNext("/auth/register", next);
    const carried = new URLSearchParams(link.split("?")[1]).get("next");
    expect(safeNextPath(carried, "/auth/onboarding")).toBe(next);
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
