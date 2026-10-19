import { describe, expect, test } from "bun:test";
import { ConvexError } from "convex/values";
import { MarketplaceError, toClientError } from "./marketplaceApi";

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
    const already = new ConvexError("Cozy Alerts hasn't been bought on this account.");
    expect(toClientError(already)).toBe(already);
    const bug = new TypeError("x is undefined");
    expect(toClientError(bug)).toBe(bug);
  });
});
