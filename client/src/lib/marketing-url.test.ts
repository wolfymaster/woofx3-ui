import { describe, expect, test } from "bun:test";
import { DEFAULT_MARKETING_URL, marketingUrl } from "./marketing-url";

describe("marketingUrl", () => {
  test("defaults when unset or blank", () => {
    expect(marketingUrl(undefined)).toBe(DEFAULT_MARKETING_URL);
    expect(marketingUrl("  ")).toBe(DEFAULT_MARKETING_URL);
  });
  test("drops trailing slashes", () => {
    expect(marketingUrl("https://staging.woofx3.com//")).toBe("https://staging.woofx3.com");
  });
  test("rejects a value that is not an http(s) URL", () => {
    expect(() => marketingUrl("nope")).toThrow();
    expect(() => marketingUrl("ftp://x.test")).toThrow();
  });
});
