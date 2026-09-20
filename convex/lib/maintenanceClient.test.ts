import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  checkSlugAvailability,
  createEngine,
  deleteEngine,
  isMaintenanceConfigured,
  MaintenanceApiError,
  retryRun,
} from "./maintenanceClient";

const realFetch = globalThis.fetch;
const env = process.env;

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

let calls: Call[] = [];

/** Answers every request with `response`, recording what was sent. */
function stubFetch(response: { status: number; body: unknown }) {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      headers: Object.fromEntries(headers.entries()),
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    });
    return new Response(JSON.stringify(response.body), { status: response.status });
  }) as typeof fetch;
}

beforeEach(() => {
  calls = [];
  env.MAINTENANCE_API_URL = "https://maintenance.woofx3.tv/";
  env.MAINTENANCE_API_KEY = "wx3m_0123456789abcdef_key";
});

afterEach(() => {
  globalThis.fetch = realFetch;
  env.MAINTENANCE_API_URL = undefined;
  env.MAINTENANCE_API_KEY = undefined;
});

const engine = { id: "eng_1", slug: "wolfymaster", publicUrl: null };
const run = { id: "run_1", kind: "provision", status: "pending", currentStep: "reserve", error: null, steps: [] };

describe("createEngine", () => {
  it("sends the customer-engine request the maintenance API expects", async () => {
    stubFetch({ status: 202, body: { engine, run } });

    await createEngine(
      {
        slug: "wolfymaster",
        owner: { type: "woofx3-ui", ref: "acc_1" },
        externalRef: "inst_1",
        registrationToken: "token-value",
        callbackUrl: "https://example.convex.site/api/webhooks/maintenance",
        twitchChannel: "wolfymaster",
      },
      "prov_1"
    );

    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call.url).toBe("https://maintenance.woofx3.tv/v1/engines");
    expect(call.method).toBe("POST");
    expect(call.headers.authorization).toBe("Bearer wx3m_0123456789abcdef_key");
    // Stable per engine, so a retried action returns the original run instead
    // of provisioning a second engine.
    expect(call.headers["idempotency-key"]).toBe("prov_1");
    expect(call.body).toEqual({
      kind: "customer",
      version: "latest",
      slug: "wolfymaster",
      owner: { type: "woofx3-ui", ref: "acc_1" },
      externalRef: "inst_1",
      registrationToken: "token-value",
      callbackUrl: "https://example.convex.site/api/webhooks/maintenance",
      twitchChannel: "wolfymaster",
    });
  });

  it("surfaces the API's error code, which callers branch on", async () => {
    stubFetch({ status: 409, body: { error: { code: "slug_taken", message: "that slug is in use" } } });

    const failure = createEngine(
      {
        slug: "taken",
        owner: { type: "woofx3-ui", ref: "acc_1" },
        externalRef: "inst_1",
        registrationToken: "token-value",
        callbackUrl: "https://example.convex.site/api/webhooks/maintenance",
      },
      "prov_1"
    );

    await expect(failure).rejects.toBeInstanceOf(MaintenanceApiError);
    const error = await failure.catch((err: MaintenanceApiError) => err);
    expect(error.code).toBe("slug_taken");
    expect(error.status).toBe(409);
    expect(error.message).toBe("that slug is in use");
  });

  it("still produces an error when the body is not the API's error shape", async () => {
    stubFetch({ status: 502, body: "<html>bad gateway</html>" });

    const error = await createEngine(
      {
        slug: "wolfymaster",
        owner: { type: "woofx3-ui", ref: "acc_1" },
        externalRef: "inst_1",
        registrationToken: "token-value",
        callbackUrl: "https://example.convex.site/api/webhooks/maintenance",
      },
      "prov_1"
    ).catch((err: MaintenanceApiError) => err);

    expect(error.code).toBe("http_error");
    expect(error.status).toBe(502);
  });
});

describe("other routes", () => {
  it("asks about a slug as a customer slug", async () => {
    stubFetch({ status: 200, body: { available: true } });
    expect(await checkSlugAvailability("wolfymaster")).toEqual({ available: true });
    expect(calls[0].url).toBe("https://maintenance.woofx3.tv/v1/slugs/wolfymaster?kind=customer");
  });

  it("resumes a run by engine and run id", async () => {
    stubFetch({ status: 202, body: { engine, run } });
    await retryRun("eng_1", "run_1", "prov_1:retry:run_1");
    expect(calls[0].url).toBe("https://maintenance.woofx3.tv/v1/engines/eng_1/runs/run_1/retry");
    expect(calls[0].method).toBe("POST");
    expect(calls[0].headers["idempotency-key"]).toBe("prov_1:retry:run_1");
  });

  it("deprovisions with DELETE", async () => {
    stubFetch({ status: 202, body: { engine, run } });
    await deleteEngine("eng_1", "prov_1:delete");
    expect(calls[0].url).toBe("https://maintenance.woofx3.tv/v1/engines/eng_1");
    expect(calls[0].method).toBe("DELETE");
  });
});

describe("configuration", () => {
  it("is unconfigured until both variables are set", async () => {
    env.MAINTENANCE_API_KEY = undefined;
    expect(isMaintenanceConfigured()).toBe(false);
    await expect(checkSlugAvailability("wolfymaster")).rejects.toThrow(/not configured/);
  });

  it("is configured when both are present", () => {
    expect(isMaintenanceConfigured()).toBe(true);
  });
});
