import { describe, expect, test } from "bun:test";
import { makeFunctionReference } from "convex/server";
import { newBackend } from "./lib/convexTest.testing";

describe("accounts", () => {
  // Deleting an org must also cancel its subscription, so no public function
  // deletes an org until one exists that does both.
  test("an owner cannot delete their org and leave its subscription billing", async () => {
    const t = newBackend();
    const { ownerId, accountId } = await t.run(async (ctx) => {
      const ownerId = await ctx.db.insert("users", { name: "Owner" });
      const accountId = await ctx.db.insert("accounts", { name: "Org", ownerId, createdAt: 1 });
      await ctx.db.insert("accountMembers", { accountId, userId: ownerId, role: "owner", createdAt: 1 });
      await ctx.db.insert("subscriptions", {
        accountId,
        plan: "starter",
        state: "active",
        stateSince: 1,
        addOns: [],
        origin: "operator",
        updatedAt: 1,
        updatedBy: "test",
      });
      return { ownerId, accountId };
    });
    const deleteMyAccount = makeFunctionReference<"action">("accounts:deleteMyAccount");
    await expect(t.withIdentity({ subject: `${ownerId}|s` }).action(deleteMyAccount, {})).rejects.toThrow(
      "no such export"
    );
    expect(await t.run((ctx) => ctx.db.get(accountId))).not.toBeNull();
  });
});
