import { describe, expect, it } from "bun:test";
import { ACTOR_HEADER, authenticateOps, type ConfiguredCaller, MIN_OPS_SECRET_LENGTH, REASON_HEADER } from "./auth";
import { callerSecretEnv, nextSecretEnv, OPS_CALLERS } from "./callers";

const BILLING = "b".repeat(43);
const BILLING_NEXT = "n".repeat(43);
const BACKOFFICE = "o".repeat(43);
const LEGACY = "l".repeat(43);

function caller(name: string) {
  const found = OPS_CALLERS.find((entry) => entry.name === name);
  if (found === undefined) {
    throw new Error(`no caller ${name}`);
  }
  return found;
}

const configured: ConfiguredCaller[] = [
  { caller: caller("billing"), secrets: [BILLING, BILLING_NEXT] },
  { caller: caller("backoffice"), secrets: [BACKOFFICE, undefined] },
  { caller: caller("legacy"), secrets: [LEGACY, undefined] },
];

function headers(values: Record<string, string>): Headers {
  return new Headers(values);
}

const read = { requireReason: false };
const write = { requireReason: true };
const operator = { [ACTOR_HEADER]: "ops@example.com" };

describe("authenticateOps", () => {
  it("keeps the minimum secret length at 43, as the maintenance API requires", () => {
    expect(MIN_OPS_SECRET_LENGTH).toBe(43);
  });

  it("refuses everything when no secret is configured", async () => {
    const none = configured.map((entry) => ({ ...entry, secrets: [undefined, undefined] }));
    const result = await authenticateOps(headers({ Authorization: `Bearer ${BILLING}`, ...operator }), none, read);
    expect(result).toMatchObject({ ok: false, status: 401 });
  });

  it("refuses a configured secret shorter than the minimum, even when presented", async () => {
    const short = "s".repeat(MIN_OPS_SECRET_LENGTH - 1);
    const result = await authenticateOps(
      headers({ Authorization: `Bearer ${short}`, ...operator }),
      [{ caller: caller("billing"), secrets: [short, undefined] }],
      read
    );
    expect(result).toMatchObject({ ok: false, status: 401 });
  });

  it.each([
    ["no header", {}],
    ["an unknown secret", { Authorization: `Bearer ${"x".repeat(43)}` }],
    ["a header without the Bearer scheme", { Authorization: BILLING }],
  ])("refuses %s", async (_name, auth) => {
    expect(await authenticateOps(headers({ ...auth, ...operator }), configured, read)).toMatchObject({
      ok: false,
      status: 401,
      code: "unauthorized",
    });
  });

  it.each([
    ["billing current", BILLING, "billing"],
    ["billing next", BILLING_NEXT, "billing"],
    ["backoffice", BACKOFFICE, "backoffice"],
    ["legacy", LEGACY, "legacy"],
  ])("identifies the caller by the secret that matched: %s", async (_name, presented, expected) => {
    const result = await authenticateOps(
      headers({ Authorization: `Bearer ${presented}`, [ACTOR_HEADER]: " ops@example.com " }),
      configured,
      read
    );
    expect(result).toMatchObject({ ok: true, actor: "ops@example.com", reason: null });
    expect(result.ok && result.caller.name).toBe(expected);
  });

  it("derives each caller's env names from its name", () => {
    expect(callerSecretEnv("billing")).toBe("OPS_API_SECRET_BILLING");
    expect(nextSecretEnv(callerSecretEnv("backoffice"))).toBe("OPS_API_SECRET_BACKOFFICE_NEXT");
    expect(caller("legacy").envPrefix).toBe("OPS_API_SECRET");
  });

  it("needs an actor, and a reason for writes", async () => {
    const auth = { Authorization: `Bearer ${BACKOFFICE}` };
    expect(await authenticateOps(headers(auth), configured, read)).toMatchObject({
      status: 400,
      code: "actor_required",
    });
    expect(await authenticateOps(headers({ ...auth, ...operator }), configured, write)).toMatchObject({
      status: 400,
      code: "reason_required",
    });
    expect(
      await authenticateOps(
        headers({ ...auth, ...operator, [REASON_HEADER]: encodeURIComponent("ticket 12 — ü") }),
        configured,
        write
      )
    ).toMatchObject({ ok: true, actor: "ops@example.com", reason: "ticket 12 — ü" });
    expect(
      await authenticateOps(headers({ ...auth, ...operator, [REASON_HEADER]: "%E0%A4%A" }), configured, write)
    ).toMatchObject({ status: 400, code: "invalid_reason" });
  });
});
