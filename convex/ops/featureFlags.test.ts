import { describe, expect, test } from "bun:test";
import { internal } from "../_generated/api";
import { newBackend } from "../lib/convexTest.testing";
import { isFlagOn } from "../lib/featureFlags";

type Backend = ReturnType<typeof newBackend>;

const operator = { caller: "backoffice", actor: "ops@woofx3.tv", reason: "rollout" };

const flag = {
  key: "scenes.newToolbar",
  description: "The new scene toolbar",
  owner: "ops@woofx3.tv",
  removeBy: "2026-12-31",
  state: "rules" as const,
  rules: { percent: 10 },
};

async function create(t: Backend, overrides: Partial<typeof flag> = {}) {
  return t.mutation(internal.ops.featureFlags.create, { ...operator, flag: { ...flag, ...overrides } });
}

async function rows(t: Backend) {
  return t.run((ctx) => ctx.db.query("featureFlags").collect());
}

async function audit(t: Backend) {
  return t.run((ctx) => ctx.db.query("opsAuditLog").collect());
}

describe("featureFlags.create", () => {
  test("stores a flag and audits it", async () => {
    const t = newBackend();
    const created = await create(t);
    expect(created).toMatchObject({ ok: true, result: { ...flag, overdue: false, updatedBy: operator.actor } });
    const [row] = await rows(t);
    expect(row).toMatchObject({ ...flag, updatedBy: operator.actor });
    expect((await audit(t))[0]).toMatchObject({
      caller: "backoffice",
      actor: operator.actor,
      action: "featureFlags.create",
      target: flag.key,
      reason: "rollout",
      result: "ok",
    });
  });

  test("refuses a key that already exists", async () => {
    const t = newBackend();
    await create(t);
    expect(await create(t)).toMatchObject({ ok: false, status: 409, code: "already_exists" });
    expect(await rows(t)).toHaveLength(1);
    expect((await audit(t)).map((entry) => entry.result).sort()).toEqual(["already_exists", "ok"]);
  });

  test("resolves an allowlist and refuses an id that names nothing", async () => {
    const t = newBackend();
    const accountId = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", { name: "Owner" });
      return ctx.db.insert("accounts", { name: "Org", ownerId: userId, createdAt: 1 });
    });
    const created = await create(t, { rules: { accounts: [accountId], percent: 25 } });
    expect(created.ok).toBe(true);
    const [row] = await rows(t);
    expect(row?.rules?.accounts).toEqual([accountId]);
    expect(isFlagOn(row ?? null, { accountId, hosting: "managed", entitlements: [] })).toBe(true);

    expect(await create(t, { key: "chat.pins", rules: { accounts: ["nobody"] } })).toMatchObject({
      ok: false,
      status: 400,
      code: "unknown_target",
    });
    expect(await rows(t)).toHaveLength(1);
  });
});

describe("featureFlags.update", () => {
  test("retargets a flag, clearing rules when it is turned on", async () => {
    const t = newBackend();
    await create(t);
    const updated = await t.mutation(internal.ops.featureFlags.update, {
      ...operator,
      flag: { ...flag, state: "on", rules: undefined },
    });
    expect(updated).toMatchObject({ ok: true, result: { state: "on", rules: { percent: null } } });
    const [row] = await rows(t);
    expect(row?.state).toBe("on");
    expect(row?.rules).toBeUndefined();
  });

  test("is not found for a key that does not exist", async () => {
    const t = newBackend();
    expect(
      await t.mutation(internal.ops.featureFlags.update, { ...operator, flag: { ...flag, key: "nope" } })
    ).toMatchObject({ ok: false, status: 404, code: "not_found" });
    expect(await rows(t)).toEqual([]);
  });
});

describe("featureFlags.remove", () => {
  test("deletes the row, and a second removal is not found", async () => {
    const t = newBackend();
    await create(t);
    expect(await t.mutation(internal.ops.featureFlags.remove, { ...operator, key: flag.key })).toEqual({
      ok: true,
      result: { key: flag.key },
    });
    expect(await rows(t)).toEqual([]);
    expect(await t.mutation(internal.ops.featureFlags.remove, { ...operator, key: flag.key })).toMatchObject({
      ok: false,
      status: 404,
    });
  });
});

describe("featureFlags.list", () => {
  test("answers every flag sorted, the entitlement catalog, and which are overdue", async () => {
    const t = newBackend();
    await create(t, { removeBy: "2020-01-01" });
    await create(t, { key: "chat.pins", state: "on", rules: undefined });
    const listed = await t.query(internal.ops.featureFlags.list, { today: "2026-11-17" });
    expect(listed.flags.map((row) => row.key)).toEqual(["chat.pins", "scenes.newToolbar"]);
    expect(listed.flags.map((row) => row.overdue)).toEqual([false, true]);
    expect(listed.entitlements.map((feature) => feature.key)).toContain("business");
  });

  test("answers nothing before the first flag is made", async () => {
    expect(await newBackend().query(internal.ops.featureFlags.list, { today: "2026-11-17" })).toMatchObject({
      flags: [],
    });
  });
});
