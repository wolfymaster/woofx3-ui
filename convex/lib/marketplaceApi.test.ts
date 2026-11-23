import { describe, expect, spyOn, test } from "bun:test";
import { ConvexError } from "convex/values";
import { MarketplaceError, marketplaceServiceToken, toClientError } from "./marketplaceApi";

function sentence(err: unknown): unknown {
  return err instanceof ConvexError ? err.data : err;
}

describe("toClientError", () => {
  test("a refusal keeps the marketplace's message, which is written for people", () => {
    const err = toClientError(new MarketplaceError(409, "listing_unavailable", "this listing is not published yet"));
    expect(err).toBeInstanceOf(ConvexError);
    expect(sentence(err)).toBe("this listing is not published yet");
  });

  test("an outage or a timeout says to try again", () => {
    for (const failure of [
      new MarketplaceError(503, "unknown", "Service Unavailable"),
      new MarketplaceError(500, "internal_error", "failed to search the catalog"),
      new Error("Marketplace request to /catalog timed out after 10000ms"),
    ]) {
      expect(sentence(toClientError(failure))).toContain("Try again");
    }
  });

  test("a ConvexError passes through, and anything else is left to be logged", () => {
    const already = new ConvexError("Cozy Alerts hasn't been bought in this account.");
    expect(toClientError(already)).toBe(already);
    const bug = new TypeError("x is undefined");
    expect(toClientError(bug)).toBe(bug);
  });
});

describe("marketplaceServiceToken", () => {
  test.each([
    ["neither set", {}, undefined],
    ["blank values", { MARKETPLACE_CONVEX_TOKEN: " ", MARKETPLACE_API_TOKEN: " " }, undefined],
    ["the convex token", { MARKETPLACE_CONVEX_TOKEN: " own " }, "own"],
    ["only the shared token", { MARKETPLACE_API_TOKEN: "shared" }, "shared"],
    ["both set: the convex token wins", { MARKETPLACE_CONVEX_TOKEN: "own", MARKETPLACE_API_TOKEN: "shared" }, "own"],
  ])("%s", (_name, env, expected) => {
    const warn = spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      expect(marketplaceServiceToken(env)).toBe(expected);
    } finally {
      warn.mockRestore();
    }
  });

  test("the shared-token fallback says so at most once and never prints the token", () => {
    const warn = spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      marketplaceServiceToken({ MARKETPLACE_API_TOKEN: "secret-shared" });
      marketplaceServiceToken({ MARKETPLACE_API_TOKEN: "secret-shared" });
      expect(warn.mock.calls.length).toBeLessThanOrEqual(1);
      expect(JSON.stringify(warn.mock.calls)).not.toContain("secret-shared");
    } finally {
      warn.mockRestore();
    }
  });
});
