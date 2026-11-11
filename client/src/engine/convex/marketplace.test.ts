import { beforeEach, describe, expect, mock, test } from "bun:test";
import { getFunctionName } from "convex/server";
import { ConvexError } from "convex/values";
import { renderInScope, TEST_INSTANCE_ID } from "./render-in-scope";

// The module mock below is installed once, before the gateway is imported, so
// what it records and answers lives here and is reset before every test.
// stylegate:ignore ANY-LAY-005 reason="bun module mocks are file-scoped; this fixture is reset in beforeEach"
const calls: Array<{ name: string; args: unknown }> = [];
// stylegate:ignore ANY-LAY-005 reason="bun module mocks are file-scoped; this fixture is reset in beforeEach"
let result: unknown = null;

// Bun runs every test file in one process and a module mock is not undone,
// so the rest of convex/react stays real for the files loaded after this one.
const convexReact = await import("convex/react");

mock.module("convex/react", () => ({
  ...convexReact,
  useAction: (action: Parameters<typeof getFunctionName>[0]) => (args: unknown) => {
    calls.push({ name: getFunctionName(action), args });
    return Promise.resolve(result);
  },
}));

const { checkoutReadOfError, convexMarketplaceGateway } = await import("./marketplace");

beforeEach(() => {
  calls.length = 0;
  result = null;
});

describe("marketplace.useAcquireForInstallRequest", () => {
  const intent = { id: "pi_1", amountCents: 900, currency: "usd", kind: "full", expiresAt: "2026-11-11T12:00:00Z" };
  const cases: { name: string; answer: unknown; expected: unknown }[] = [
    {
      name: "a license answers with its key",
      answer: { status: "licensed", license: { key: "W3X-AAAA", listingId: "listing-1", edition: 1 } },
      expected: { status: "licensed", licenseKey: "W3X-AAAA" },
    },
    {
      name: "a price answers with the purchase to pay",
      answer: { status: "payment_required", intent },
      expected: { status: "payment_required", intent },
    },
    {
      name: "a refusal keeps its reason and sentence",
      answer: { status: "refused", reason: "downloads_blocked", message: "pulled" },
      expected: { status: "refused", reason: "downloads_blocked", message: "pulled" },
    },
  ];
  for (const { name, answer, expected } of cases) {
    test(name, async () => {
      result = answer;
      const acquire = renderInScope(() => convexMarketplaceGateway.useAcquireForInstallRequest());
      expect(await acquire("listing-1")).toEqual(expected as Awaited<ReturnType<typeof acquire>>);
      expect(calls).toEqual([
        {
          name: "marketplaceCatalog:acquireForInstall",
          args: { instanceId: TEST_INSTANCE_ID, listingId: "listing-1" },
        },
      ]);
    });
  }
});

describe("marketplace purchase checkouts", () => {
  test("paying an intent asks billing for the scope's engine", async () => {
    result = { url: "https://pay.example/m", checkoutId: "c9" };
    const start = renderInScope(() => convexMarketplaceGateway.usePurchaseCheckoutRequest());
    expect(await start("pi_1")).toEqual({ url: "https://pay.example/m", checkoutId: "c9" });
    expect(calls).toEqual([
      { name: "billingCommands:startMarketplaceCheckout", args: { instanceId: TEST_INSTANCE_ID, intentId: "pi_1" } },
    ]);
  });

  test("a returned checkout's state is read for the scope's engine", async () => {
    result = { state: "needs_review" };
    const read = renderInScope(() => convexMarketplaceGateway.usePurchaseCheckoutStateRequest());
    expect(await read("c9")).toEqual({ kind: "state", state: "needs_review" });
    expect(calls).toEqual([
      { name: "billingCommands:marketplaceCheckoutState", args: { instanceId: TEST_INSTANCE_ID, checkoutId: "c9" } },
    ]);
  });
});

describe("checkoutReadOfError", () => {
  test.each(["checkout_not_found", "bad_request", "not_authorized", "organization_not_found"])(
    "%s is decided: the checkout is not this engine's",
    (code) => {
      expect(checkoutReadOfError(new ConvexError({ code, message: "x" }))).toEqual({ kind: "not_found" });
    }
  );

  test.each([
    ["an outage", new ConvexError({ code: "payment_unavailable", message: "x" })],
    ["an unreachable plane", new ConvexError({ code: "unreachable", message: "x" })],
    ["a plain error", new Error("network")],
    ["a string ConvexError", new ConvexError("x")],
  ])("%s is retried", (_name, error) => {
    expect(checkoutReadOfError(error)).toBeNull();
  });
});
