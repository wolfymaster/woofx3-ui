import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { newBackend } from "../lib/convexTest.testing";
import { callerSecretEnv, nextSecretEnv } from "../lib/ops/callers";

const SECRETS = {
  billing: "b".repeat(43),
  billingNext: "n".repeat(43),
  backoffice: "o".repeat(43),
  legacy: "l".repeat(43),
};
const ENV_NAMES = [
  callerSecretEnv("billing"),
  nextSecretEnv(callerSecretEnv("billing")),
  callerSecretEnv("backoffice"),
  "OPS_API_SECRET",
];

const BILLING_ROUTES: [string, string][] = [
  ["GET", "/api/ops/users/u1"],
  ["GET", "/api/ops/accounts/a1"],
  ["POST", "/api/ops/accounts/a1/billing-projection"],
  ["POST", "/api/ops/notifications"],
];
const BACKOFFICE_ONLY_ROUTES: [string, string][] = [
  ["GET", "/api/ops/users"],
  ["GET", "/api/ops/accounts"],
  ["GET", "/api/ops/engines"],
  ["GET", "/api/ops/audit"],
  ["GET", "/api/ops/notifications"],
  ["POST", "/api/ops/engines/i1/delete"],
  ["POST", "/api/ops/instances/i1/storage-limits"],
  ["POST", "/api/ops/notifications/n1/delete"],
  ["POST", "/api/ops/accounts/a1/billing-projection-reset"],
];

let saved: Record<string, string | undefined> = {};
beforeEach(() => {
  saved = Object.fromEntries(ENV_NAMES.map((name) => [name, process.env[name]]));
  process.env[callerSecretEnv("billing")] = SECRETS.billing;
  process.env[nextSecretEnv(callerSecretEnv("billing"))] = SECRETS.billingNext;
  process.env[callerSecretEnv("backoffice")] = SECRETS.backoffice;
  process.env.OPS_API_SECRET = SECRETS.legacy;
});
afterEach(() => {
  for (const name of ENV_NAMES) {
    if (saved[name] === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = saved[name];
    }
  }
});

function call(t: ReturnType<typeof newBackend>, method: string, path: string, secret: string) {
  return t.fetch(path, {
    method,
    headers: {
      Authorization: `Bearer ${secret}`,
      "X-Woofx3-Actor": "ops@example.com",
      "X-Woofx3-Reason": "test",
      "Content-Type": "application/json",
    },
    body: method === "POST" ? "{}" : undefined,
  });
}

async function forbiddenCode(response: Response): Promise<string | null> {
  if (response.status !== 403) {
    return null;
  }
  return ((await response.json()) as { error: { code: string } }).error.code;
}

describe("ops caller scopes", () => {
  test.each(BILLING_ROUTES)("billing may %s %s", async (method, path) => {
    for (const secret of [SECRETS.billing, SECRETS.billingNext]) {
      const response = await call(newBackend(), method, path, secret);
      expect([401, 403]).not.toContain(response.status);
    }
  });

  test.each(BACKOFFICE_ONLY_ROUTES)("billing may not %s %s", async (method, path) => {
    const response = await call(newBackend(), method, path, SECRETS.billing);
    expect(await forbiddenCode(response)).toBe("forbidden_route");
  });

  test.each(BACKOFFICE_ONLY_ROUTES)("backoffice may %s %s", async (method, path) => {
    const response = await call(newBackend(), method, path, SECRETS.backoffice);
    expect([401, 403]).not.toContain(response.status);
  });

  test("backoffice may not push a billing projection", async () => {
    const response = await call(newBackend(), "POST", "/api/ops/accounts/a1/billing-projection", SECRETS.backoffice);
    expect(await forbiddenCode(response)).toBe("forbidden_route");
  });

  test.each([...BILLING_ROUTES, ...BACKOFFICE_ONLY_ROUTES])("the legacy secret may %s %s", async (method, path) => {
    const response = await call(newBackend(), method, path, SECRETS.legacy);
    expect([401, 403]).not.toContain(response.status);
  });

  test("a wrong secret is 401", async () => {
    const response = await call(newBackend(), "GET", "/api/ops/users", "x".repeat(43));
    expect(response.status).toBe(401);
  });

  test("a caller secret shorter than the minimum is refused", async () => {
    const short = "s".repeat(42);
    process.env[callerSecretEnv("backoffice")] = short;
    const response = await call(newBackend(), "GET", "/api/ops/users", short);
    expect(response.status).toBe(401);
  });

  test("audit rows record the caller", async () => {
    const t = newBackend();
    const accountId = await t.run(async (ctx) => {
      const ownerId = await ctx.db.insert("users", { name: "Owner" });
      return ctx.db.insert("accounts", { name: "Org", ownerId, createdAt: 1 });
    });
    for (const secret of [SECRETS.billing, SECRETS.backoffice]) {
      expect((await call(t, "GET", `/api/ops/accounts/${accountId}`, secret)).status).toBe(200);
    }
    const rows = await t.run((ctx) => ctx.db.query("opsAuditLog").collect());
    expect(rows.map((row) => row.caller).sort()).toEqual(["backoffice", "billing"]);
  });
});
