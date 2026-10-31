import { describe, expect, test } from "bun:test";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { newBackend } from "./lib/convexTest.testing";

const THIS_PC = "8f6c0b4e-1111-4111-8111-11111111aaaa";
const OTHER_PC = "22222222-2222-4222-8222-222222222222";
const HASH = "a".repeat(64);
const NEW_HASH = "b".repeat(64);
const OTHER_HASH = "c".repeat(64);

type Backend = ReturnType<typeof newBackend>;

interface Fixture {
  t: Backend;
  instanceId: Id<"instances">;
  ownerId: Id<"users">;
  /** The account owner, an admin of the instance. */
  owner: ReturnType<Backend["withIdentity"]>;
  /** A member, below admin. */
  member: ReturnType<Backend["withIdentity"]>;
  /** Signed in, with no access to the instance. */
  stranger: ReturnType<Backend["withIdentity"]>;
}

async function fixture(): Promise<Fixture> {
  const t = newBackend();
  const ids = await t.run(async (ctx) => {
    const ownerId = await ctx.db.insert("users", { name: "Owner" });
    const memberId = await ctx.db.insert("users", { name: "Member" });
    const strangerId = await ctx.db.insert("users", { name: "Stranger" });
    const accountId = await ctx.db.insert("accounts", { name: "Acct", ownerId, createdAt: 1 });
    const instanceId = await ctx.db.insert("instances", {
      accountId,
      name: "Main",
      url: "https://engine.example",
      hosting: "managed",
      createdAt: 1,
    });
    await ctx.db.insert("instanceMembers", { instanceId, userId: ownerId, role: "owner" });
    await ctx.db.insert("instanceMembers", { instanceId, userId: memberId, role: "member" });
    return { ownerId, memberId, strangerId, instanceId };
  });
  const as = (userId: Id<"users">) => t.withIdentity({ subject: `${userId}|session` });
  return {
    t,
    instanceId: ids.instanceId,
    ownerId: ids.ownerId,
    owner: as(ids.ownerId),
    member: as(ids.memberId),
    stranger: as(ids.strangerId),
  };
}

function linkArgs(
  f: Fixture,
  overrides: Partial<{ tokenHash: string; installationId: string; deviceName: string }> = {}
) {
  return {
    instanceId: f.instanceId,
    tokenHash: HASH,
    installationId: THIS_PC,
    deviceName: "STREAM-PC",
    companionVersion: "0.1.0",
    ...overrides,
  };
}

async function companionRows(f: Fixture) {
  return f.t.run((ctx) =>
    ctx.db
      .query("companions")
      .withIndex("by_instance", (q) => q.eq("instanceId", f.instanceId))
      .collect()
  );
}

/** Another computer, already the instance's confirmed companion and seen at `lastSeenAt`. */
async function otherComputerPaired(f: Fixture, lastSeenAt: number): Promise<Id<"companions">> {
  return f.t.run(async (ctx) => {
    const companionId = await ctx.db.insert("companions", {
      instanceId: f.instanceId,
      installationId: OTHER_PC,
      tokenHash: OTHER_HASH,
      deviceName: "LAPTOP",
      companionVersion: "0.0.9",
      pairedBy: f.ownerId,
      pairedAt: 5,
      confirmedAt: 6,
    });
    await ctx.db.insert("companionPresence", { companionId, lastSeenAt, companionVersion: "0.0.9" });
    return companionId;
  });
}

describe("linkSignedInApp", () => {
  test("makes this computer the instance's confirmed companion, approved by the signed-in admin", async () => {
    const f = await fixture();
    expect(await f.owner.mutation(api.companionPairing.linkSignedInApp, linkArgs(f))).toEqual({
      kind: "linked",
      instanceId: f.instanceId,
      instanceName: "Main",
    });
    const [row, ...rest] = await companionRows(f);
    expect(rest).toEqual([]);
    expect(row).toMatchObject({
      installationId: THIS_PC,
      tokenHash: HASH,
      deviceName: "STREAM-PC",
      companionVersion: "0.1.0",
      pairedBy: f.ownerId,
    });
    expect(row?.confirmedAt).toBe(row?.pairedAt);
  });

  test("refuses anyone below admin on the instance, and a signed-out caller", async () => {
    const f = await fixture();
    for (const caller of [f.member, f.stranger]) {
      await expect(caller.mutation(api.companionPairing.linkSignedInApp, linkArgs(f))).rejects.toThrow(
        "Not authorized for this instance"
      );
    }
    await expect(f.t.mutation(api.companionPairing.linkSignedInApp, linkArgs(f))).rejects.toThrow("Not authenticated");
    expect(await companionRows(f)).toEqual([]);
  });

  for (const [field, value] of [
    ["tokenHash", "A".repeat(64)],
    ["tokenHash", "a".repeat(63)],
    ["tokenHash", `${"a".repeat(63)}g`],
    ["installationId", "not-a-uuid"],
    ["installationId", THIS_PC.toUpperCase()],
    ["deviceName", "   "],
    ["deviceName", "x".repeat(65)],
  ] as const) {
    test(`refuses ${field} ${JSON.stringify(value.slice(0, 12))}…`, async () => {
      const f = await fixture();
      await expect(
        f.owner.mutation(api.companionPairing.linkSignedInApp, linkArgs(f, { [field]: value }))
      ).rejects.toThrow(field);
      expect(await companionRows(f)).toEqual([]);
    });
  }

  test("is idempotent for the same installation and token hash", async () => {
    const f = await fixture();
    await f.owner.mutation(api.companionPairing.linkSignedInApp, linkArgs(f));
    const [first] = await companionRows(f);
    expect(await f.owner.mutation(api.companionPairing.linkSignedInApp, linkArgs(f))).toMatchObject({
      kind: "linked",
    });
    expect(await companionRows(f)).toEqual(first ? [first] : []);
  });

  test("gives this computer's existing companion row the new token, keeping its id", async () => {
    const f = await fixture();
    await f.owner.mutation(api.companionPairing.linkSignedInApp, linkArgs(f));
    const [before] = await companionRows(f);
    await f.owner.mutation(api.companionPairing.linkSignedInApp, linkArgs(f, { tokenHash: NEW_HASH }));
    const rows = await companionRows(f);
    expect(rows.map((row) => [row._id, row.tokenHash])).toEqual([[before?._id, NEW_HASH]]);
    expect(rows[0]?.confirmedAt).toBeDefined();
  });

  test("names another computer that is the companion instead of replacing it", async () => {
    const f = await fixture();
    const otherId = await otherComputerPaired(f, 42);
    expect(await f.owner.mutation(api.companionPairing.linkSignedInApp, linkArgs(f))).toEqual({
      kind: "otherCompanion",
      companion: { deviceName: "LAPTOP", pairedAt: 5, lastSeenAt: 42 },
    });
    expect((await companionRows(f)).map((row) => row._id)).toEqual([otherId]);
  });

  test("replaces the other computer when asked to", async () => {
    const f = await fixture();
    const otherId = await otherComputerPaired(f, 42);
    expect(
      await f.owner.mutation(api.companionPairing.linkSignedInApp, { ...linkArgs(f), replaceOtherComputer: true })
    ).toMatchObject({ kind: "linked" });
    const rows = await companionRows(f);
    expect(rows.map((row) => row.installationId)).toEqual([THIS_PC]);
    expect(await f.t.run((ctx) => ctx.db.get(otherId))).toBeNull();
    const presence = await f.t.run((ctx) =>
      ctx.db
        .query("companionPresence")
        .withIndex("by_companion", (q) => q.eq("companionId", otherId))
        .collect()
    );
    expect(presence).toEqual([]);
  });

  test("refuses a token hash another companion already holds", async () => {
    const f = await fixture();
    await otherComputerPaired(f, 42);
    await expect(
      f.owner.mutation(api.companionPairing.linkSignedInApp, {
        ...linkArgs(f, { tokenHash: OTHER_HASH }),
        replaceOtherComputer: true,
      })
    ).rejects.toThrow("already in use");
  });

  test("is rate limited per user", async () => {
    const f = await fixture();
    for (let attempt = 0; attempt < 5; attempt++) {
      await f.owner.mutation(api.companionPairing.linkSignedInApp, linkArgs(f));
    }
    await expect(f.owner.mutation(api.companionPairing.linkSignedInApp, linkArgs(f))).rejects.toThrow(
      "Too many pairing attempts"
    );
  });
});

describe("approve", () => {
  test("still writes the device-code companion unconfirmed and replaces another computer", async () => {
    const f = await fixture();
    const otherId = await otherComputerPaired(f, 42);
    await f.t.mutation(internal.companionPairing.insertPairing, {
      deviceCodeHash: "d".repeat(64),
      tokenHash: HASH,
      installationId: THIS_PC,
      userCode: "BCDFGHJK",
      deviceName: "STREAM-PC",
      companionVersion: "0.1.0",
    });
    await f.owner.mutation(api.companionPairing.approve, { userCode: "BCDF-GHJK", instanceId: f.instanceId });
    const rows = await companionRows(f);
    expect(rows.map((row) => [row.installationId, row.tokenHash, row.confirmedAt])).toEqual([
      [THIS_PC, HASH, undefined],
    ]);
    expect(await f.t.run((ctx) => ctx.db.get(otherId))).toBeNull();
  });
});
