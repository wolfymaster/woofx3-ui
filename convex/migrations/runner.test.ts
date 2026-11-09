import { describe, expect, test } from "bun:test";
import { internal } from "../_generated/api";
import { newBackend } from "../lib/convexTest.testing";

// Goes through the operator entry point in docs/ops/deploy.md rather than the
// migration function, so a component that the installed `convex` cannot run
// fails here instead of on the production CLI.
describe("migrations/index:run", () => {
  test("runs a migration by name without reset, then reports it done", async () => {
    const t = newBackend();
    const { accountId, ownerId } = await t.run(async (ctx) => {
      const ownerId = await ctx.db.insert("users", { name: "Owner" });
      const accountId = await ctx.db.insert("accounts", { name: "Org", ownerId, createdAt: 1 });
      return { accountId, ownerId };
    });
    const args = { fn: "migrations/organizations:orgOwnerRows" };

    await t.mutation(internal.migrations.index.run, args);
    const rows = await t.run((ctx) =>
      ctx.db
        .query("accountMembers")
        .withIndex("by_account", (q) => q.eq("accountId", accountId))
        .collect()
    );
    expect(rows.map((row) => [row.userId, row.role])).toEqual([[ownerId, "owner"]]);

    expect(await t.mutation(internal.migrations.index.run, args)).toMatchObject({
      Status: "Migration already done.",
      processed: 1,
    });
  });
});
