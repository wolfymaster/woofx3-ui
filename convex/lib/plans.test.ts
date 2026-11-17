import { describe, expect, test } from "bun:test";
import { newBackend } from "./convexTest.testing";
import { deletePlan, planByKey } from "./plans";

const fields = { name: "Old", features: [], limits: [], updatedAt: 1, updatedBy: "test" };

describe("deletePlan", () => {
  test.each(["starter", "pro"])("refuses the %s tier plan and keeps its row", async (key) => {
    const t = newBackend();
    await t.run((ctx) => ctx.db.insert("plans", { key, ...fields }));
    await t.run(async (ctx) => {
      await expect(deletePlan(ctx, key)).rejects.toThrow("tier plan");
      expect(await planByKey(ctx, key)).not.toBeNull();
    });
  });

  test("deletes a stray plan that is not a tier", async () => {
    const t = newBackend();
    await t.run((ctx) => ctx.db.insert("plans", { key: "legacy", ...fields }));
    await t.run(async (ctx) => {
      await deletePlan(ctx, "legacy");
      expect(await planByKey(ctx, "legacy")).toBeNull();
    });
  });
});
