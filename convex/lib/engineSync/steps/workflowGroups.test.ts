import { describe, expect, test } from "bun:test";
import { getFunctionName } from "convex/server";
import type { Id } from "../../../_generated/dataModel";
import type { ActionCtx } from "../../../_generated/server";
import type { EngineApi } from "../../engineInstanceUrl";
import { workflowGroupsStep } from "./workflowGroups";

function run(capabilities: string[] | null) {
  const sent: { name: string; args: Record<string, unknown> }[] = [];
  let listed = false;
  const ctx = {
    runQuery: async (ref: Parameters<typeof getFunctionName>[0]) => {
      expect(getFunctionName(ref)).toBe("engineCapabilities:forInstance");
      return capabilities;
    },
    runMutation: async (ref: Parameters<typeof getFunctionName>[0], args: Record<string, unknown>) => {
      sent.push({ name: getFunctionName(ref), args });
      return { itemsProcessed: 1 };
    },
  } as unknown as ActionCtx;
  const newApi = () =>
    ({
      listWorkflowGroups: async () => {
        listed = true;
        return [{ id: "g-1", name: "Holiday", description: "", enabled: true, memberIds: ["wf-1"] }];
      },
    }) as unknown as EngineApi;
  const done = workflowGroupsStep.run({ ctx, newApi, instanceId: "instance1" as Id<"instances"> });
  return { sent, done, wasListed: () => listed };
}

describe("workflowGroupsStep", () => {
  test("mirrors the groups of an engine that has them", async () => {
    const t = run(["workflows.groups"]);
    await t.done;
    expect(t.sent[0]?.name).toBe("engineSyncInternal:reconcileWorkflowGroups");
    expect(t.sent[0]?.args.snapshots).toEqual([
      { engineGroupId: "g-1", name: "Holiday", description: "", enabled: true, memberIds: ["wf-1"] },
    ]);
  });

  test("leaves the mirror alone for an engine without groups", async () => {
    const t = run([]);
    expect(await t.done).toEqual({ itemsProcessed: 0 });
    expect(t.wasListed()).toBe(false);
    expect(t.sent).toHaveLength(0);
  });

  test("leaves the mirror alone while the engine has not reported its capabilities", async () => {
    const t = run(null);
    expect(await t.done).toEqual({ itemsProcessed: 0 });
    expect(t.wasListed()).toBe(false);
  });
});
