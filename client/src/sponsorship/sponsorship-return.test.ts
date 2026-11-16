import { describe, expect, test } from "bun:test";
import { parseCheckoutReturn } from "@/lib/checkout-return";
import { parseSponsorshipReturn } from "./sponsorship-return";

describe("parseSponsorshipReturn", () => {
  test.each([
    ["", { kind: "none" }],
    ["?sponsorship=done&sponsorshipCheckout=c1", { kind: "done", checkoutId: "c1" }],
    ["sponsorship=done", { kind: "done", checkoutId: null }],
    ["?sponsorship=done&sponsorshipCheckout=", { kind: "done", checkoutId: null }],
    ["?sponsorship=cancelled&sponsorshipCheckout=c1", { kind: "cancelled" }],
    ["?sponsorship=weird", { kind: "none" }],
    ["?checkout=done&checkoutId=c1", { kind: "none" }],
  ])("%p", (search, expected) => {
    expect(parseSponsorshipReturn(search)).toEqual(expected);
  });

  test("the organization checkout return ignores a sponsorship return", () => {
    expect(parseCheckoutReturn("?sponsorship=done&sponsorshipCheckout=c1")).toEqual({ kind: "none" });
  });
});
