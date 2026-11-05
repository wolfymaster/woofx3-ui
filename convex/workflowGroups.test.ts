import { describe, expect, test } from "bun:test";
import { internal } from "./_generated/api";
import { fixture } from "./lib/userPages.fixtures";

const holiday = { engineGroupId: "g-1", name: "Holiday", description: "", enabled: false, memberIds: ["wf-1"] };

async function groups(t: Awaited<ReturnType<typeof fixture>>["t"]) {
  return t.run(async (ctx) => ctx.db.query("workflowGroups").collect());
}

describe("workflow group webhooks", () => {
  test("upsert by engine id and delete", async () => {
    const { t, instanceId } = await fixture();
    await t.mutation(internal.workflowGroups.upsertFromWebhook, { instanceId, ...holiday });
    await t.mutation(internal.workflowGroups.upsertFromWebhook, {
      instanceId,
      ...holiday,
      enabled: true,
      memberIds: ["wf-1", "wf-2"],
    });
    const stored = await groups(t);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ enabled: true, memberIds: ["wf-1", "wf-2"] });

    await t.mutation(internal.workflowGroups.deleteFromWebhook, { instanceId, engineGroupId: "g-1" });
    await t.mutation(internal.workflowGroups.deleteFromWebhook, { instanceId, engineGroupId: "g-1" });
    expect(await groups(t)).toHaveLength(0);
  });
});

describe("reconcileWorkflowGroups", () => {
  test("mirrors the snapshot and drops groups the engine no longer has", async () => {
    const { t, instanceId } = await fixture();
    await t.mutation(internal.workflowGroups.upsertFromWebhook, { instanceId, ...holiday, engineGroupId: "gone" });

    await t.mutation(internal.engineSyncInternal.reconcileWorkflowGroups, {
      instanceId,
      snapshotStartedAt: Date.now() + 1,
      snapshots: [holiday],
    });

    const stored = await groups(t);
    expect(stored.map((g) => g.engineGroupId)).toEqual(["g-1"]);
  });

  test("leaves a group written after the snapshot started", async () => {
    const { t, instanceId } = await fixture();
    const snapshotStartedAt = Date.now() - 60_000;
    await t.mutation(internal.workflowGroups.upsertFromWebhook, { instanceId, ...holiday, enabled: true });

    await t.mutation(internal.engineSyncInternal.reconcileWorkflowGroups, {
      instanceId,
      snapshotStartedAt,
      snapshots: [],
    });

    const stored = await groups(t);
    expect(stored).toHaveLength(1);
    expect(stored[0]?.enabled).toBe(true);
  });
});
