import { describe, expect, test } from "bun:test";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { insertTwitchLink, type LinkFixture, linkFixture, readLink } from "../lib/platformLinks.fixtures";
import { PLATFORM_TOKEN_KEY } from "../lib/tokenCipher";

const migration = internal.migrations.sealPlatformLinkTokens;

/** A link holding only half a plaintext pair, which the migration cannot seal. */
async function insertBrokenLink(f: LinkFixture): Promise<Id<"platformLinks">> {
  return f.t.run((ctx) =>
    ctx.db.insert("platformLinks", {
      instanceId: f.instanceId,
      platform: "twitch",
      platformUserId: "7",
      platformUsername: "broken",
      channelId: "7",
      expiresAt: 1,
      scopes: [],
      accessToken: "orphan-access",
    })
  );
}

async function expectSealed(f: LinkFixture, linkId: Id<"platformLinks">, access: string, refresh: string) {
  const row = await readLink(f.t, linkId);
  expect(row?.accessToken).toBeUndefined();
  expect(row?.refreshToken).toBeUndefined();
  expect(JSON.stringify(row)).not.toContain(access);
  expect(await f.cipher.open(row?.sealedAccessToken ?? "")).toBe(access);
  expect(await f.cipher.open(row?.sealedRefreshToken ?? "")).toBe(refresh);
}

describe("sealPlatformLinkTokens", () => {
  test("seals plaintext links, leaves sealed ones alone, and records the row it cannot convert", async () => {
    const f = await linkFixture();
    const plainA = await insertTwitchLink(f, { plaintext: true, accessToken: "a-1", refreshToken: "r-1" });
    const plainB = await insertTwitchLink(f, { plaintext: true, accessToken: "a-2", refreshToken: "r-2" });
    const sealed = await insertTwitchLink(f, { accessToken: "a-3", refreshToken: "r-3" });
    const sealedBefore = await readLink(f.t, sealed);
    const broken = await insertBrokenLink(f);

    const report = await f.t.action(migration.default, {});

    expect(report).toMatchObject({ status: "completed", scanned: 4, converted: 2, skipped: 1, failed: 1 });
    expect(report.failures).toEqual([{ documentId: broken, reason: "link holds half a plaintext token pair" }]);
    await expectSealed(f, plainA, "a-1", "r-1");
    await expectSealed(f, plainB, "a-2", "r-2");
    expect(await readLink(f.t, sealed)).toEqual(sealedBefore);
    expect((await readLink(f.t, broken))?.accessToken).toBe("orphan-access");
  });

  test("converges: a second run converts nothing and changes no row", async () => {
    const f = await linkFixture();
    const plain = await insertTwitchLink(f, { plaintext: true });
    await insertTwitchLink(f);
    await f.t.action(migration.default, {});
    const afterFirst = await readLink(f.t, plain);

    const second = await f.t.action(migration.default, {});

    expect(second).toMatchObject({ status: "completed", scanned: 2, converted: 0, skipped: 2, failed: 0 });
    expect(await readLink(f.t, plain)).toEqual(afterFirst);
    expect(await f.t.query(migration.status, {})).toEqual(second);
    expect(await f.t.run((ctx) => ctx.db.query("migrationRuns").take(10))).toHaveLength(2);
  });

  test("reads every page of a table larger than one batch", async () => {
    const f = await linkFixture();
    const ids: Id<"platformLinks">[] = [];
    for (let i = 0; i < 120; i++) {
      ids.push(await insertTwitchLink(f, { plaintext: true, accessToken: `a-${i}`, refreshToken: `r-${i}` }));
    }
    const report = await f.t.action(migration.default, {});
    expect(report).toMatchObject({ scanned: 120, converted: 120, failed: 0 });
    await expectSealed(f, ids[119], "a-119", "r-119");
  });

  test("drops leftover plaintext from a row that already holds a sealed pair", async () => {
    const f = await linkFixture();
    const linkId = await insertTwitchLink(f, { accessToken: "a-new", refreshToken: "r-new" });
    await f.t.run((ctx) => ctx.db.patch(linkId, { accessToken: "a-old", refreshToken: "r-old" }));
    const report = await f.t.action(migration.default, {});
    expect(report).toMatchObject({ converted: 1, failed: 0 });
    await expectSealed(f, linkId, "a-new", "r-new");
  });

  test("does not overwrite a link rewritten after it was read", async () => {
    const f = await linkFixture();
    const linkId = await insertTwitchLink(f, { plaintext: true, accessToken: "a-1", refreshToken: "r-1" });
    const sealed = {
      sealedAccessToken: await f.cipher.seal("stale"),
      sealedRefreshToken: await f.cipher.seal("stale"),
    };
    await f.t.run((ctx) => ctx.db.patch(linkId, { refreshToken: "r-2" }));

    const outcome = await f.t.mutation(migration.sealLink, {
      linkId,
      expectedAccessToken: "a-1",
      expectedRefreshToken: "r-1",
      sealed,
    });

    expect(outcome).toBe("changed");
    expect((await readLink(f.t, linkId))?.refreshToken).toBe("r-2");
    expect((await readLink(f.t, linkId))?.sealedAccessToken).toBeUndefined();
  });

  test("refuses to start without the key, and records no run", async () => {
    const f = await linkFixture();
    await insertTwitchLink(f, { plaintext: true });
    delete process.env[PLATFORM_TOKEN_KEY.envVar];
    await expect(f.t.action(migration.default, {})).rejects.toThrow("PLATFORM_TOKEN_ENCRYPTION_KEY is not set");
    expect(await f.t.query(migration.status, {})).toBeNull();
  });
});
