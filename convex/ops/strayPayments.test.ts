import { describe, expect, test } from "bun:test";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { newBackend } from "../lib/convexTest.testing";

type Backend = ReturnType<typeof newBackend>;

async function seed(t: Backend) {
  return t.run(async (ctx) => {
    const ownerId = await ctx.db.insert("users", { name: "Owner" });
    const accountId = await ctx.db.insert("accounts", { name: "Pawsome Org", ownerId, createdAt: 1 });
    const gone = await ctx.db.insert("accounts", { name: "Gone", ownerId, createdAt: 1 });
    await ctx.db.delete(gone);
    const event = (eventId: string, receivedAt: number, outcome: "applied" | "stray", account: Id<"accounts">) =>
      ctx.db.insert("paymentEvents", {
        provider: "stripe",
        eventId,
        type: "invoice.paid",
        schemaVersion: 1,
        rawPayload: "{}",
        accountId: account,
        outcome,
        error: outcome === "stray" ? "live beside the org's current sub_1" : undefined,
        stray:
          outcome === "stray"
            ? { subscriptionRef: `sub_${eventId}`, customerRef: "cus_1", amountCents: receivedAt === 3 ? 1500 : null }
            : undefined,
        receivedAt,
      });
    await event("e1", 1, "stray", accountId);
    await event("e2", 2, "applied", accountId);
    await event("e3", 3, "stray", gone);
    await event("e4", 4, "stray", accountId);
    return { accountId };
  });
}

describe("ops stray payments", () => {
  test("lists only strays, newest first, a page at a time, with the org when it still exists", async () => {
    const t = newBackend();
    const { accountId } = await seed(t);
    const first = await t.query(internal.ops.reads.listStrayPayments, { cursor: null, limit: 2 });
    expect(first.page).toEqual([
      {
        eventId: "e4",
        type: "invoice.paid",
        account: { id: accountId, name: "Pawsome Org" },
        subscriptionRef: "sub_e4",
        customerRef: "cus_1",
        amountCents: null,
        detail: "live beside the org's current sub_1",
        at: 4,
      },
      expect.objectContaining({ eventId: "e3", account: null, amountCents: 1500 }),
    ]);
    expect(first.cursor).not.toBeNull();
    const second = await t.query(internal.ops.reads.listStrayPayments, { cursor: first.cursor, limit: 2 });
    expect(second.page.map((item) => item.eventId)).toEqual(["e1"]);
    expect(second.cursor).toBeNull();
  });

  test("no strays is an empty page", async () => {
    const t = newBackend();
    expect(await t.query(internal.ops.reads.listStrayPayments, { cursor: null, limit: 25 })).toEqual({
      page: [],
      cursor: null,
    });
  });
});
