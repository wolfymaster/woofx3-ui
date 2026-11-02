import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { api, internal } from "./_generated/api";
import { fixture } from "./lib/userPages.fixtures";

describe("renaming a managed engine", () => {
  const realFetch = globalThis.fetch;
  const { MAINTENANCE_API_URL, MAINTENANCE_API_KEY } = process.env;
  let requests: { url: string; slug: string; key: string | null }[] = [];
  let refusal: string | null = null;

  beforeEach(() => {
    process.env.MAINTENANCE_API_URL = "https://maintenance.test";
    process.env.MAINTENANCE_API_KEY = "key";
    requests = [];
    refusal = null;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      requests.push({ url: String(input), slug: body.slug, key: new Headers(init?.headers).get("Idempotency-Key") });
      if (refusal) {
        return Response.json({ error: { code: refusal, message: "no" } }, { status: 409 });
      }
      return Response.json({ engine: { id: "eng_1", slug: body.slug, publicUrl: "https://wolfy.woofx3.test" } });
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    process.env.MAINTENANCE_API_URL = MAINTENANCE_API_URL;
    process.env.MAINTENANCE_API_KEY = MAINTENANCE_API_KEY;
  });

  async function provisioningOf(f: Awaited<ReturnType<typeof fixture>>) {
    return f.t.run((ctx) =>
      ctx.db
        .query("engineProvisioning")
        .withIndex("by_instance", (q) => q.eq("instanceId", f.instanceId))
        .first()
    );
  }

  test("moves the name, and the page answers at both names", async () => {
    const f = await fixture();

    const result = await f.owner.action(api.provisioning.renameManagedEngine, {
      instanceId: f.instanceId,
      slug: " New-Name ",
    });

    expect(result).toEqual({ ok: true, slug: "new-name" });
    expect(requests).toEqual([
      {
        url: "https://maintenance.test/v1/engines/eng_1/rename",
        slug: "new-name",
        key: expect.any(String),
      },
    ]);
    expect((await provisioningOf(f))?.slug).toBe("new-name");
    for (const slug of ["new-name", "wolfy"]) {
      expect((await f.t.query(api.userPagesPublic.bySlug, { slug })).kind).not.toBe("unclaimed");
    }
  });

  test("a name taken back is not held twice", async () => {
    const f = await fixture();
    for (const slug of ["new-name", "wolfy"]) {
      await f.owner.action(api.provisioning.renameManagedEngine, { instanceId: f.instanceId, slug });
    }

    const held = await f.t.run((ctx) => ctx.db.query("engineHeldSlugs").collect());
    expect(held.map((row) => row.slug)).toEqual(["new-name"]);
  });

  test("an old name stops answering once the engine is torn down", async () => {
    const f = await fixture();
    await f.owner.action(api.provisioning.renameManagedEngine, { instanceId: f.instanceId, slug: "new-name" });
    const row = await provisioningOf(f);
    await f.t.run((ctx) => ctx.db.patch(row?._id as NonNullable<typeof row>["_id"], { status: "deleted" }));

    expect((await f.t.query(api.userPagesPublic.bySlug, { slug: "wolfy" })).kind).toBe("unclaimed");
  });

  test.each([
    { code: "slug_taken", reason: "That name is taken. Try another." },
    { code: "rename_too_soon", reason: "You can change your name once every 30 days." },
  ])("reports $code plainly and changes nothing", async ({ code, reason }) => {
    const f = await fixture();
    refusal = code;

    expect(
      await f.owner.action(api.provisioning.renameManagedEngine, { instanceId: f.instanceId, slug: "x-y-z" })
    ).toEqual({
      ok: false,
      reason,
    });
    expect((await provisioningOf(f))?.slug).toBe("wolfy");
  });

  test("an old name is released with the engine, so the next engine does not answer to it", async () => {
    const f = await fixture();
    await f.owner.action(api.provisioning.renameManagedEngine, { instanceId: f.instanceId, slug: "new-name" });
    await f.t.mutation(internal.provisioningInternal.applyCallbackEvent, {
      eventId: "deleted-1",
      eventType: "engine.deleted",
      maintenanceEngineId: "eng_1",
    });
    expect(await f.t.run((ctx) => ctx.db.query("engineHeldSlugs").collect())).toEqual([]);

    const row = await provisioningOf(f);
    await f.t.run((ctx) =>
      ctx.db.patch(row?._id as NonNullable<typeof row>["_id"], { status: "registered", slug: "next" })
    );

    expect((await f.t.query(api.userPagesPublic.bySlug, { slug: "wolfy" })).kind).toBe("unclaimed");
  });

  test("a new engine requested for the instance clears names an old one left", async () => {
    const f = await fixture();
    await f.owner.action(api.provisioning.renameManagedEngine, { instanceId: f.instanceId, slug: "new-name" });
    const row = await provisioningOf(f);
    const { accountId, ownerId } = await f.t.run(async (ctx) => {
      await ctx.db.patch(row?._id as NonNullable<typeof row>["_id"], { status: "deleted" });
      await ctx.db.patch(f.instanceId, { clientId: undefined, hosting: "managed" });
      const instance = await ctx.db.get(f.instanceId);
      const account = await ctx.db.get(instance?.accountId as NonNullable<typeof instance>["accountId"]);
      return {
        accountId: account?._id as NonNullable<typeof account>["_id"],
        ownerId: account?.ownerId as NonNullable<typeof account>["ownerId"],
      };
    });

    await f.t.mutation(internal.provisioningInternal.reserveManagedInstance, {
      accountId,
      userId: ownerId,
      slug: "next",
      newRegistrationToken: "token",
      newCreateRequestId: "request",
    });

    expect(await f.t.run((ctx) => ctx.db.query("engineHeldSlugs").collect())).toEqual([]);
  });

  test("a refused name can be asked for again, since each attempt has its own key", async () => {
    const f = await fixture();
    refusal = "rename_too_soon";
    const args = { instanceId: f.instanceId, slug: "new-name" };
    await f.owner.action(api.provisioning.renameManagedEngine, args);
    refusal = null;

    expect(await f.owner.action(api.provisioning.renameManagedEngine, args)).toEqual({ ok: true, slug: "new-name" });

    expect(requests[0].key).not.toBe(requests[1].key);
  });

  test("is refused for anyone but the owner, and offered only to the owner", async () => {
    const f = await fixture();
    await expect(
      f.member.action(api.provisioning.renameManagedEngine, { instanceId: f.instanceId, slug: "new-name" })
    ).rejects.toThrow("Not authorized");
    expect(requests).toEqual([]);
    expect((await f.owner.query(api.provisioning.forInstance, { instanceId: f.instanceId }))?.canRename).toBe(true);
    expect((await f.member.query(api.provisioning.forInstance, { instanceId: f.instanceId }))?.canRename).toBe(false);
  });

  test("waits for a running engine", async () => {
    const f = await fixture();
    const row = await provisioningOf(f);
    await f.t.run((ctx) => ctx.db.patch(row?._id as NonNullable<typeof row>["_id"], { status: "upgrading" }));

    const result = await f.owner.action(api.provisioning.renameManagedEngine, {
      instanceId: f.instanceId,
      slug: "new-name",
    });

    expect(result.ok).toBe(false);
    expect(requests).toEqual([]);
    expect((await f.owner.query(api.provisioning.forInstance, { instanceId: f.instanceId }))?.canRename).toBe(false);
  });
});
