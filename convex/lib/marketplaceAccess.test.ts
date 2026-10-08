import { describe, expect, it } from "bun:test";
import { marketplaceAccessFor, marketplaceRequestHeaders } from "./marketplaceAccess";

describe("marketplaceAccessFor", () => {
  it("grants dev access only to instances flagged true", () => {
    expect(marketplaceAccessFor({ marketplaceDevAccess: true })).toBe("dev");
    expect(marketplaceAccessFor({ marketplaceDevAccess: false })).toBe("public");
    expect(marketplaceAccessFor({})).toBe("public");
    expect(marketplaceAccessFor(null)).toBe("public");
  });
});

describe("marketplaceRequestHeaders", () => {
  it("sends no credential for public requests, even when a token is configured", () => {
    expect(marketplaceRequestHeaders("public", "secret")).toEqual({ Accept: "application/json" });
  });

  it("sends the dev token as a bearer credential for dev requests", () => {
    expect(marketplaceRequestHeaders("dev", "secret")).toEqual({
      Accept: "application/json",
      Authorization: "Bearer secret",
    });
  });

  it("refuses a dev request when no token is configured", () => {
    expect(() => marketplaceRequestHeaders("dev", undefined)).toThrow("MARKETPLACE_DEV_TOKEN");
    expect(() => marketplaceRequestHeaders("dev", "  ")).toThrow("MARKETPLACE_DEV_TOKEN");
  });
});
