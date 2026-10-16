import { describe, expect, test } from "bun:test";
import { catalogListingIsFree, grantFromEntitlement, grantQuery } from "./marketplaceEntitlement";

const BUYER = "account:j57abc";

describe("grantFromEntitlement", () => {
  test("a free listing is fetched like any other", () => {
    expect(grantFromEntitlement({ entitled: true, free: true }, BUYER)).toEqual({ kind: "free" });
  });

  test("a bought listing is fetched for its buyer", () => {
    expect(grantFromEntitlement({ entitled: true, free: false, source: "purchase" }, BUYER)).toEqual({
      kind: "paid",
      buyerRef: BUYER,
    });
  });

  test("refuses anything it does not recognise, rather than installing", () => {
    for (const answer of [
      { entitled: false, free: false },
      { entitled: "true", free: true },
      { entitled: true },
      { entitled: true, free: "no" },
      {},
      null,
      "entitled",
    ]) {
      expect(grantFromEntitlement(answer, BUYER)).toBeNull();
    }
  });
});

describe("catalogListingIsFree", () => {
  test("is free only when the listing is readable and carries no price", () => {
    expect(catalogListingIsFree({ listing: { id: "counter" } })).toBe(true);
    expect(catalogListingIsFree({ listing: { id: "counter", price: null } })).toBe(true);
  });

  test("treats any price, however shaped, as paid", () => {
    for (const price of [{ amountCents: 500, currency: "usd" }, { amount: "5.00" }, 500, "free", 0]) {
      expect(catalogListingIsFree({ listing: { id: "counter", price } })).toBe(false);
    }
  });

  test("treats a listing it cannot read as paid", () => {
    for (const payload of [{}, { item: { id: "counter" } }, { listing: "counter" }, null, []]) {
      expect(catalogListingIsFree(payload)).toBe(false);
    }
  });
});

describe("grantQuery", () => {
  test("names the buyer only for paid content", () => {
    expect(grantQuery({ kind: "free" })).toBe("");
    expect(grantQuery({ kind: "paid", buyerRef: BUYER })).toBe("?buyerRef=account%3Aj57abc");
  });
});
