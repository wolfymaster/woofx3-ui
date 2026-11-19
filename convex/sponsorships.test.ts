import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { ConvexError } from "convex/values";
import { api } from "./_generated/api";
import { ACTION_LIMITS } from "./lib/actionRateLimits";
import { newBackend } from "./lib/convexTest.testing";

type Backend = ReturnType<typeof newBackend>;

const realFetch = globalThis.fetch;
const saved = {
  url: process.env.MAINTENANCE_API_URL,
  key: process.env.MAINTENANCE_API_KEY,
  site: process.env.SITE_URL,
};

interface Seen {
  path: string;
  search: string;
  method: string;
  idempotencyKey: string | null;
  body: unknown;
}

let seen: Seen[] = [];
let answers: Record<string, { status: number; body: unknown }> = {};

beforeEach(() => {
  seen = [];
  answers = {};
  process.env.MAINTENANCE_API_URL = "https://plane.test";
  process.env.MAINTENANCE_API_KEY = "key";
  process.env.SITE_URL = "https://app.test/ignored/path";
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const { pathname: path, search } = new URL(String(input));
    seen.push({
      path,
      search,
      method: init?.method ?? "GET",
      idempotencyKey: new Headers(init?.headers).get("idempotency-key"),
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    });
    const answer = Object.entries(answers).find(([suffix]) => path.endsWith(suffix))?.[1];
    return new Response(JSON.stringify(answer?.body ?? {}), { status: answer?.status ?? 404 });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  process.env.MAINTENANCE_API_URL = saved.url;
  process.env.MAINTENANCE_API_KEY = saved.key;
  process.env.SITE_URL = saved.site;
});

async function seedUsers(t: Backend) {
  return t.run(async (ctx) => ({
    viewerId: await ctx.db.insert("users", { name: "Viewer" }),
    otherId: await ctx.db.insert("users", { name: "Other" }),
  }));
}

const as = (t: Backend, userId: string) => t.withIdentity({ subject: `${userId}|s` });
const errorData = (promise: Promise<unknown>) =>
  promise.then(
    () => null,
    (error: unknown) => (error instanceof ConvexError ? error.data : error)
  );

const wireSponsorship = {
  id: "sp1",
  interval: "month",
  amountCents: 25_000,
  currency: "usd",
  state: "active",
  cancelAtPeriodEnd: false,
  currentPeriodEnd: "2026-12-01T00:00:00.000Z",
  createdAt: "2026-11-01T00:00:00.000Z",
  payments: [{ id: "pay1", amountCents: 25_000, status: "paid", paidAt: "2026-11-01T00:00:00.000Z", receiptUrl: null }],
};

type Args = Record<string, unknown>;

// Every action runs for the viewer alone, whatever the caller adds to its arguments.
const ACTIONS: Array<{
  name: string;
  args: Args;
  call: (t: Backend, args: Args) => Promise<unknown>;
  answerAt: string;
  body: unknown;
}> = [
  {
    name: "terms",
    args: {},
    call: (t, args) => t.action(api.sponsorships.terms, args as Record<string, never>),
    answerAt: "/sponsorship-terms",
    body: { minCents: 10_000, maxCents: 100_000_000, currency: "usd" },
  },
  {
    name: "mine",
    args: {},
    call: (t, args) => t.action(api.sponsorships.mine, args as Record<string, never>),
    answerAt: "/sponsorships",
    body: { sponsorships: [wireSponsorship] },
  },
  {
    name: "start",
    args: { amountCents: 25_000, interval: "month" },
    call: (t, args) => t.action(api.sponsorships.start, args as { amountCents: number; interval: "month" }),
    answerAt: "/sponsorship-checkouts",
    body: { url: "https://pay.example/1", checkoutId: "c1" },
  },
  {
    name: "changeAmount",
    args: { sponsorshipId: "sp1", amountCents: 30_000 },
    call: (t, args) => t.action(api.sponsorships.changeAmount, args as { sponsorshipId: string; amountCents: number }),
    answerAt: "/sponsorships/sp1",
    body: wireSponsorship,
  },
  {
    name: "cancel",
    args: { sponsorshipId: "sp1" },
    call: (t, args) => t.action(api.sponsorships.cancel, args as { sponsorshipId: string }),
    answerAt: "/sponsorships/sp1/cancel",
    body: wireSponsorship,
  },
  {
    name: "paymentMethodSession",
    args: { sponsorshipId: "sp1" },
    call: (t, args) => t.action(api.sponsorships.paymentMethodSession, args as { sponsorshipId: string }),
    answerAt: "/payment-method-sessions",
    body: { url: "https://pay.example/pm" },
  },
  {
    name: "checkoutState",
    args: { checkoutId: "c1" },
    call: (t, args) => t.action(api.sponsorships.checkoutState, args as { checkoutId: string }),
    answerAt: "/checkouts/c1",
    body: { id: "c1", state: "complete" },
  },
];

describe.each(ACTIONS)("sponsorships.$name", ({ args, call, answerAt, body }) => {
  test("refuses a signed-out viewer before the plane is asked", async () => {
    const t = newBackend();
    expect(await errorData(call(t, args))).toMatchObject({ code: "not_authenticated" });
    expect(seen).toEqual([]);
  });

  test("never lets the caller name the user", async () => {
    const t = newBackend();
    const { viewerId, otherId } = await seedUsers(t);
    answers[answerAt] = { status: 200, body };
    await call(as(t, viewerId), { ...args, userId: otherId }).catch(() => null);
    for (const request of seen) {
      expect(request.path + request.search).not.toContain(otherId);
      expect(JSON.stringify(request.body ?? null)).not.toContain(otherId);
    }
  });
});

describe("start", () => {
  test("asks for the viewer's checkout with a derived key and a return url from the configured origin", async () => {
    const t = newBackend();
    const { viewerId } = await seedUsers(t);
    answers["/sponsorship-checkouts"] = { status: 200, body: { url: "https://pay.example/1", checkoutId: "c1" } };
    const args = { amountCents: 25_000, interval: "month" } as const;
    expect(await as(t, viewerId).action(api.sponsorships.start, args)).toEqual({
      url: "https://pay.example/1",
      checkoutId: "c1",
    });
    await as(t, viewerId).action(api.sponsorships.start, args);
    expect(seen[0]?.path).toBe(`/v1/billing/users/${viewerId}/sponsorship-checkouts`);
    expect(seen[0]?.body).toEqual({
      amountCents: 25_000,
      interval: "month",
      returnUrl: "https://app.test/account/sponsorship",
    });
    expect(seen[0]?.idempotencyKey).toMatch(new RegExp(`^sponsorship-checkout:${viewerId}:month:25000:\\d+$`));
    expect(seen[1]?.idempotencyKey).toBe(seen[0]?.idempotencyKey ?? "");
  });

  test.each([[0], [-1], [10.5], [Number.NaN]])(
    "refuses the amount %p without asking the plane",
    async (amountCents) => {
      const t = newBackend();
      const { viewerId } = await seedUsers(t);
      expect(
        await errorData(as(t, viewerId).action(api.sponsorships.start, { amountCents, interval: "once" }))
      ).toMatchObject({ code: "invalid_sponsorship_amount" });
      expect(seen).toEqual([]);
    }
  );

  test("an unset origin is a configuration error", async () => {
    process.env.SITE_URL = "";
    const t = newBackend();
    const { viewerId } = await seedUsers(t);
    expect(
      await errorData(as(t, viewerId).action(api.sponsorships.start, { amountCents: 10_000, interval: "once" }))
    ).toMatchObject({ code: "not_configured" });
    expect(seen).toEqual([]);
  });

  test("a plane refusal reaches the page with its code", async () => {
    const t = newBackend();
    const { viewerId } = await seedUsers(t);
    answers["/sponsorship-checkouts"] = {
      status: 422,
      body: { error: { code: "invalid_sponsorship_amount", message: "plane words" } },
    };
    expect(
      await errorData(as(t, viewerId).action(api.sponsorships.start, { amountCents: 100, interval: "once" }))
    ).toEqual({
      code: "invalid_sponsorship_amount",
      message: "That amount isn't one we can accept for a sponsorship.",
    });
  });
});

describe("start rate limit", () => {
  test("refuses the call after the burst, per viewer", async () => {
    const t = newBackend();
    const { viewerId, otherId } = await seedUsers(t);
    answers["/sponsorship-checkouts"] = { status: 200, body: { url: "https://pay.example/1", checkoutId: "c1" } };
    const args = { amountCents: 25_000, interval: "month" } as const;
    for (let n = 0; n < ACTION_LIMITS.sponsorshipStart.capacity; n++) {
      await as(t, viewerId).action(api.sponsorships.start, args);
    }
    const asked = seen.length;
    expect(await errorData(as(t, viewerId).action(api.sponsorships.start, args))).toMatchObject({
      code: "rate_limited",
      retryAfter: expect.any(Number),
    });
    expect(seen.length).toBe(asked);
    await as(t, otherId).action(api.sponsorships.start, args);
  });
});

describe("paymentMethodSession", () => {
  test("returns the sponsor to their account with the card-update marker", async () => {
    const t = newBackend();
    const { viewerId } = await seedUsers(t);
    answers["/payment-method-sessions"] = { status: 200, body: { url: "https://pay.example/pm" } };
    await as(t, viewerId).action(api.sponsorships.paymentMethodSession, { sponsorshipId: "sp1" });
    expect(seen[0]?.body).toEqual({
      returnUrl: "https://app.test/account/sponsorship?sponsorshipPaymentMethod=returned",
    });
  });
});

describe("mine", () => {
  test("lists the viewer's sponsorships with dates as epoch milliseconds", async () => {
    const t = newBackend();
    const { viewerId } = await seedUsers(t);
    answers["/sponsorships"] = { status: 200, body: { sponsorships: [wireSponsorship] } };
    const [sponsorship] = await as(t, viewerId).action(api.sponsorships.mine, {});
    expect(seen[0]?.path).toBe(`/v1/billing/users/${viewerId}/sponsorships`);
    expect(sponsorship).toMatchObject({
      id: "sp1",
      currentPeriodEnd: Date.parse("2026-12-01T00:00:00.000Z"),
      payments: [{ paidAt: Date.parse("2026-11-01T00:00:00.000Z") }],
    });
  });
});

describe("changeAmount and cancel", () => {
  test("send the change under the viewer's id", async () => {
    const t = newBackend();
    const { viewerId } = await seedUsers(t);
    answers["/sponsorships/sp1"] = { status: 200, body: wireSponsorship };
    answers["/sponsorships/sp1/cancel"] = { status: 200, body: wireSponsorship };
    await as(t, viewerId).action(api.sponsorships.changeAmount, { sponsorshipId: "sp1", amountCents: 30_000 });
    await as(t, viewerId).action(api.sponsorships.cancel, { sponsorshipId: "sp1" });
    expect(seen.map(({ method, path, body }) => [method, path, body])).toEqual([
      ["PATCH", `/v1/billing/users/${viewerId}/sponsorships/sp1`, { amountCents: 30_000 }],
      ["POST", `/v1/billing/users/${viewerId}/sponsorships/sp1/cancel`, { atPeriodEnd: true }],
    ]);
  });

  test("a client cannot ask for an immediate cancel", async () => {
    const t = newBackend();
    const { viewerId } = await seedUsers(t);
    answers["/sponsorships/sp1/cancel"] = { status: 200, body: wireSponsorship };
    const args = { sponsorshipId: "sp1", atPeriodEnd: false } as { sponsorshipId: string };
    await as(t, viewerId)
      .action(api.sponsorships.cancel, args)
      .catch(() => null);
    expect(seen.map(({ body }) => body).filter((body) => body !== undefined)).toEqual(
      seen.length === 0 ? [] : [{ atPeriodEnd: true }]
    );
  });

  test("a one-time sponsorship's refusal keeps its code", async () => {
    const t = newBackend();
    const { viewerId } = await seedUsers(t);
    answers["/sponsorships/sp1/cancel"] = {
      status: 409,
      body: { error: { code: "sponsorship_not_recurring", message: "plane words" } },
    };
    expect(await errorData(as(t, viewerId).action(api.sponsorships.cancel, { sponsorshipId: "sp1" }))).toMatchObject({
      code: "sponsorship_not_recurring",
    });
  });
});
