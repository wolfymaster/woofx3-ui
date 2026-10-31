import { describe, expect, test } from "bun:test";
import { internal } from "./_generated/api";
import { fixture } from "./lib/userPages.fixtures";

describe("deleteFromWebhook", () => {
  async function seed() {
    const { t, instanceId } = await fixture();
    const ids = await t.run(async (ctx) => {
      const macro = (workflowId: string, sortOrder: number) =>
        ctx.db.insert("macros", {
          instanceId,
          label: "m",
          type: "trigger-workflow",
          config: { workflowId },
          sortOrder,
          updatedAt: 0,
        });
      const gone = await macro("gone", 0);
      const other = await macro("other", 1);
      const pack = await ctx.db.insert("starterPackItems", {
        instanceId,
        packId: "p",
        itemId: "i",
        kind: "workflow",
        status: "installed",
        engineId: "gone",
        claimedAt: 0,
      });
      return { gone, other, pack };
    });
    return { t, instanceId, ...ids };
  }

  test("a merge points macros and starter pack rows at the workflow kept", async () => {
    const { t, instanceId, gone, other, pack } = await seed();
    await t.mutation(internal.workflowInternal.deleteFromWebhook, {
      instanceId,
      engineWorkflowId: "gone",
      mergedInto: "kept",
    });
    await t.run(async (ctx) => {
      expect((await ctx.db.get(gone))?.config.workflowId).toBe("kept");
      expect((await ctx.db.get(other))?.config.workflowId).toBe("other");
      expect((await ctx.db.get(pack))?.engineId).toBe("kept");
    });
  });

  test("a plain delete leaves them alone", async () => {
    const { t, instanceId, gone } = await seed();
    await t.mutation(internal.workflowInternal.deleteFromWebhook, { instanceId, engineWorkflowId: "gone" });
    await t.run(async (ctx) => {
      expect((await ctx.db.get(gone))?.config.workflowId).toBe("gone");
    });
  });
});

describe("upsertFromWebhook", () => {
  test("keeps the newer copy when callbacks arrive out of order", async () => {
    const { t, instanceId } = await fixture();
    const deliver = (revision: number | undefined, name: string) =>
      t.mutation(internal.workflowInternal.upsertFromWebhook, {
        instanceId,
        engineWorkflowId: "wf",
        definition: { name },
        isEnabled: true,
        revision,
      });
    const id = await deliver(5, "merged");
    await deliver(4, "before the merge");
    await t.run(async (ctx) => {
      const row = await ctx.db.get(id);
      expect(row?.definition.name).toBe("merged");
      expect(row?.revision).toBe(5);
    });
    await deliver(undefined, "from an engine that doesn't count");
    await t.run(async (ctx) => {
      expect((await ctx.db.get(id))?.definition.name).toBe("from an engine that doesn't count");
    });
  });
});
