import { describe, expect, test } from "bun:test";
import { DEFAULT_USER_PAGE_BASE_URL, userPageBaseUrl, userPageUrl } from "@/lib/user-page-url";

describe("userPageBaseUrl", () => {
  test("defaults to the production page origin when unset or blank", () => {
    expect(userPageBaseUrl("")).toBe(DEFAULT_USER_PAGE_BASE_URL);
    expect(userPageBaseUrl("  ")).toBe(DEFAULT_USER_PAGE_BASE_URL);
  });

  test("uses a configured origin, without a trailing slash", () => {
    expect(userPageBaseUrl("http://localhost:5174/")).toBe("http://localhost:5174");
  });

  test("refuses a value that is not an http(s) URL", () => {
    expect(() => userPageBaseUrl("woofx3.tv")).toThrow();
    expect(() => userPageBaseUrl("ftp://woofx3.tv")).toThrow();
  });
});

describe("userPageUrl", () => {
  test("puts the slug under /u/", () => {
    expect(userPageUrl("https://woofx3.tv", "wolfymaster")).toBe("https://woofx3.tv/u/wolfymaster");
  });

  test("encodes a slug that needs it", () => {
    expect(userPageUrl("https://woofx3.tv", "a b")).toBe("https://woofx3.tv/u/a%20b");
  });
});
