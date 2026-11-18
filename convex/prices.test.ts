import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { ConvexError } from "convex/values";
import { api } from "./_generated/api";
import { newBackend } from "./lib/convexTest.testing";

const realFetch = globalThis.fetch;
const saved = { url: process.env.MAINTENANCE_API_URL, key: process.env.MAINTENANCE_API_KEY };

const wirePrices = [
  { plan: "starter", interval: "month", amountCents: 7_500, currency: "usd" },
  { plan: "pro", interval: "year", amountCents: 129_900, currency: "usd" },
];

let plane: { status: number; body: unknown } | "down";
let asked: string[];

beforeEach(() => {
  asked = [];
  plane = { status: 200, body: { prices: wirePrices } };
  process.env.MAINTENANCE_API_URL = "https://plane.test";
  process.env.MAINTENANCE_API_KEY = "key";
  globalThis.fetch = (async (input: string | URL | Request) => {
    asked.push(new URL(String(input)).pathname);
    if (plane === "down") {
      throw new Error("connection refused");
    }
    return new Response(JSON.stringify(plane.body), { status: plane.status });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  process.env.MAINTENANCE_API_URL = saved.url;
  process.env.MAINTENANCE_API_KEY = saved.key;
});

async function viewer() {
  const t = newBackend();
  const userId = await t.run(async (ctx) => {
    await ctx.db.insert("plans", {
      key: "starter",
      name: "Starter",
      features: [],
      limits: [],
      updatedAt: 1,
      updatedBy: "test",
    });
    return ctx.db.insert("users", { name: "Viewer" });
  });
  return { t, as: t.withIdentity({ subject: `${userId}|s` }) };
}

describe("prices.list", () => {
  test("serves the plane's prices with the plan rows' names and keeps them", async () => {
    const { t, as } = await viewer();
    expect(await as.action(api.prices.list, {})).toEqual({
      state: "ready",
      prices: wirePrices,
      names: { starter: "Starter" },
    });
    expect(asked).toEqual(["/v1/billing/prices"]);
    const kept = await t.run((ctx) => ctx.db.query("planPriceCache").collect());
    expect(kept).toHaveLength(1);
    expect(kept[0]?.prices).toEqual(wirePrices);
  });

  test("replaces the kept prices with the newest answer instead of adding a row", async () => {
    const { t, as } = await viewer();
    await as.action(api.prices.list, {});
    plane = { status: 200, body: { prices: [{ ...wirePrices[0], amountCents: 9_000 }] } };
    await as.action(api.prices.list, {});
    const kept = await t.run((ctx) => ctx.db.query("planPriceCache").collect());
    expect(kept).toHaveLength(1);
    expect(kept[0]?.prices[0]?.amountCents).toBe(9_000);
  });

  test.each([
    ["is unreachable", "down" as const],
    ["answers an error", { status: 503, body: { error: { code: "payment_unavailable", message: "x" } } }],
    ["answers something that is not a price list", { status: 200, body: { prices: "none" } }],
  ])("serves the last good prices when the plane %s", async (_name, outage) => {
    const { as } = await viewer();
    await as.action(api.prices.list, {});
    plane = outage;
    expect(await as.action(api.prices.list, {})).toEqual({
      state: "ready",
      prices: wirePrices,
      names: { starter: "Starter" },
    });
  });

  test("is unavailable, never a guessed price, when the plane has never answered", async () => {
    const { t, as } = await viewer();
    plane = "down";
    expect(await as.action(api.prices.list, {})).toEqual({ state: "unavailable", names: { starter: "Starter" } });
    expect(await t.run((ctx) => ctx.db.query("planPriceCache").collect())).toEqual([]);
  });

  test("refuses a signed-out caller before the plane is asked", async () => {
    const { t } = await viewer();
    const error = await t.action(api.prices.list, {}).catch((caught: unknown) => caught);
    expect(error instanceof ConvexError ? error.data : error).toMatchObject({ code: "not_authenticated" });
    expect(asked).toEqual([]);
  });
});
